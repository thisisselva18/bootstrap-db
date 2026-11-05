-- =====================================================================
--  CAMPUS BOOTSTRAP : application extensions
-- =====================================================================
--  Run AFTER Campus_Bootstrap_Mini_Project.sql. Adds what the web app needs
--  (accounts and roles) and closes gaps found while verifying the base script.
--  Every statement is re-runnable.
--
--    A. AppUser table + role/link integrity triggers
--    B. Room clash check on UPDATE (the base trigger only covers INSERT)
--    C. Audit log records the application user, not the trigger definer
--    D. Excused students cannot rate an activity they did not attend
--    E. Login usernames follow Student/Mentor email changes
--    F. sp_register_student : enrolment + login account in one transaction
--    G. Views used by the dashboards
-- =====================================================================

USE bootstrap_db;

-- ------------------------------------------------------------------ A
-- One row per person who can sign in. Passwords are stored only as bcrypt
-- hashes (the CHECK rejects anything that is not in bcrypt format).
DROP TABLE IF EXISTS AppUser;
CREATE TABLE AppUser (
    user_id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username       VARCHAR(120)  NOT NULL UNIQUE,
    password_hash  CHAR(60)      NOT NULL,
    role           ENUM('admin','mentor','student') NOT NULL,
    s_id           INT UNSIGNED      NULL UNIQUE,
    m_id           SMALLINT UNSIGNED NULL UNIQUE,
    is_active      BOOLEAN       NOT NULL DEFAULT TRUE,
    last_login     DATETIME      NULL,
    created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (s_id) REFERENCES Student(s_id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (m_id) REFERENCES Mentor(m_id)  ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_appuser_hash     CHECK (password_hash REGEXP '^\\$2[aby]\\$[0-9]{2}\\$.{53}$'),
    CONSTRAINT chk_appuser_username CHECK (username REGEXP '^[^@[:space:]]+@[^@[:space:]]+$'),
    INDEX ix_appuser_role (role)
);

DELIMITER //

-- MySQL forbids CHECK constraints on columns that carry FK referential
-- actions, so "role matches the linked record" is enforced by triggers.
DROP PROCEDURE IF EXISTS sp_assert_account_link//
CREATE PROCEDURE sp_assert_account_link(IN p_role VARCHAR(10),
                                        IN p_s_id INT UNSIGNED,
                                        IN p_m_id SMALLINT UNSIGNED)
BEGIN
    IF p_role = 'student' AND (p_s_id IS NULL OR p_m_id IS NOT NULL) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A student account must link to exactly one student';
    END IF;
    IF p_role = 'mentor' AND (p_m_id IS NULL OR p_s_id IS NOT NULL) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A mentor account must link to exactly one mentor';
    END IF;
    IF p_role = 'admin' AND (p_s_id IS NOT NULL OR p_m_id IS NOT NULL) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'An admin account cannot link to a student or mentor';
    END IF;
END//

DROP TRIGGER IF EXISTS trg_appuser_link_ins//
CREATE TRIGGER trg_appuser_link_ins
BEFORE INSERT ON AppUser
FOR EACH ROW
BEGIN
    CALL sp_assert_account_link(NEW.role, NEW.s_id, NEW.m_id);
END//

DROP TRIGGER IF EXISTS trg_appuser_link_upd//
CREATE TRIGGER trg_appuser_link_upd
BEFORE UPDATE ON AppUser
FOR EACH ROW
BEGIN
    CALL sp_assert_account_link(NEW.role, NEW.s_id, NEW.m_id);
END//

-- ------------------------------------------------------------------ B
DROP TRIGGER IF EXISTS trg_schedule_room_clash_upd//
CREATE TRIGGER trg_schedule_room_clash_upd
BEFORE UPDATE ON Schedule
FOR EACH ROW
BEGIN
    DECLARE v_clash INT DEFAULT 0;
    IF NEW.room IS NOT NULL THEN
        SELECT COUNT(*) INTO v_clash FROM Schedule
        WHERE `day` = NEW.`day` AND room = NEW.room AND schedule_id <> NEW.schedule_id;
        IF v_clash > 0 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'That room is already booked on that day';
        END IF;
    END IF;
END//

-- ------------------------------------------------------------------ C
-- Inside a trigger CURRENT_USER() is the trigger's DEFINER, so the original
-- log always said root@localhost. The web app sets @app_user per request.
DROP TRIGGER IF EXISTS trg_part_audit//
CREATE TRIGGER trg_part_audit
AFTER UPDATE ON Participates
FOR EACH ROW
BEGIN
    IF NEW.status <> OLD.status THEN
        INSERT INTO attendance_log (p_id, s_id, a_id, old_status, new_status, changed_by)
        VALUES (NEW.p_id, NEW.s_id, NEW.a_id, OLD.status, NEW.status,
                COALESCE(@app_user, USER()));
    END IF;
END//

-- ------------------------------------------------------------------ D
DROP TRIGGER IF EXISTS trg_feedback_validate//
CREATE TRIGGER trg_feedback_validate
BEFORE INSERT ON Feedback
FOR EACH ROW
BEGIN
    DECLARE v_status VARCHAR(10) DEFAULT NULL;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_status = NULL;

    SELECT status INTO v_status FROM Participates
    WHERE s_id = NEW.s_id AND a_id = NEW.a_id;

    IF v_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Student did not participate in this activity';
    END IF;
    IF v_status IN ('absent', 'excused') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only students who attended can rate the activity';
    END IF;
END//

-- ------------------------------------------------------------------ E
DROP TRIGGER IF EXISTS trg_student_email_sync//
CREATE TRIGGER trg_student_email_sync
AFTER UPDATE ON Student
FOR EACH ROW
BEGIN
    IF NEW.email <> OLD.email THEN
        UPDATE AppUser SET username = NEW.email WHERE s_id = NEW.s_id;
    END IF;
END//

DROP TRIGGER IF EXISTS trg_mentor_email_sync//
CREATE TRIGGER trg_mentor_email_sync
AFTER UPDATE ON Mentor
FOR EACH ROW
BEGIN
    IF NEW.email <> OLD.email THEN
        UPDATE AppUser SET username = NEW.email WHERE m_id = NEW.m_id;
    END IF;
END//

-- ------------------------------------------------------------------ F
-- Same steps as sp_enroll_student plus the login row. sp_enroll_student
-- commits on its own, so it cannot be wrapped; this keeps all three inserts
-- in a single transaction.
DROP PROCEDURE IF EXISTS sp_register_student//
CREATE PROCEDURE sp_register_student(IN  p_usn    VARCHAR(15),
                                     IN  p_name   VARCHAR(80),
                                     IN  p_email  VARCHAR(120),
                                     IN  p_branch VARCHAR(60),
                                     IN  p_sem    TINYINT UNSIGNED,
                                     IN  p_g_id   TINYINT UNSIGNED,
                                     IN  p_hash   CHAR(60),
                                     OUT p_s_id   INT UNSIGNED)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;
    INSERT INTO Student (s_usn, s_name, email, branch, semester, g_id)
    VALUES (p_usn, p_name, p_email, p_branch, p_sem, p_g_id);
    SET p_s_id = LAST_INSERT_ID();

    INSERT INTO Participates (s_id, a_id, status)
    SELECT p_s_id, a_id, 'absent' FROM Activity;

    INSERT INTO AppUser (username, password_hash, role, s_id)
    VALUES (p_email, p_hash, 'student', p_s_id);
    COMMIT;
END//

DELIMITER ;

-- ------------------------------------------------------------------ G
-- A student's five sessions with their own status and rating.
CREATE OR REPLACE VIEW vw_student_schedule AS
SELECT s.s_id, sc.schedule_id, sc.`day`, a.a_id, a.a_name AS activity, sc.room,
       sc.start_time, sc.end_time, m.m_name AS mentor,
       p.status, p.check_in_time, p.check_out_time,
       fn_session_minutes(p.check_in_time, p.check_out_time) AS minutes,
       f.rating, f.comments
FROM   Student s
JOIN   Schedule sc     ON sc.g_id = s.g_id
JOIN   Activity a      ON a.a_id  = sc.a_id
LEFT JOIN Mentor m     ON m.m_id  = a.m_id
LEFT JOIN Participates p ON p.s_id = s.s_id AND p.a_id = a.a_id
LEFT JOIN Feedback f   ON f.s_id  = s.s_id AND f.a_id = a.a_id;

-- Attendance per colour group.
CREATE OR REPLACE VIEW vw_group_stats AS
SELECT g.g_id, g.g_name,
       COUNT(DISTINCT s.s_id)                                                   AS students,
       SUM(p.status = 'present')                                                AS present,
       SUM(p.status = 'late')                                                   AS late_arrivals,
       SUM(p.status = 'absent')                                                 AS absent,
       SUM(p.status = 'excused')                                                AS excused,
       ROUND(100 * SUM(p.status IN ('present','late')) / NULLIF(COUNT(p.p_id),0), 2) AS attendance_pct
FROM   BootstrapGroup g
LEFT JOIN Student s      ON s.g_id = g.g_id
LEFT JOIN Participates p ON p.s_id = s.s_id
GROUP  BY g.g_id, g.g_name;

-- Compatibility views used by the web application.

CREATE OR REPLACE VIEW vw_student_attendance AS
SELECT v.s_id, v.s_usn, v.s_name, v.colour_group, v.branch,
       v.sessions, v.present, v.late_arrivals, v.absent, v.excused,
       v.attendance_pct,
       CASE
           WHEN v.attendance_pct >= 80 THEN 'LOW'
           WHEN v.attendance_pct >= 60 THEN 'MEDIUM'
           ELSE 'HIGH'
       END AS risk
FROM v_student_attendance v;

CREATE OR REPLACE VIEW vw_activity_stats AS
SELECT *
FROM v_activity_stats;

CREATE OR REPLACE VIEW vw_attendance_audit AS
SELECT *
FROM v_attendance_audit;
