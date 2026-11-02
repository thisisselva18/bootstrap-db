-- =====================================================================
--  CAMPUS BOOTSTRAP : Matchmaking and Student Statistics System
-- =====================================================================
--  Five colour groups rotate through five activities over five days; every
--  group meets every activity exactly once (a 5x5 Latin square). MySQL 8.0.16+.
--  If binary logging is on: SET GLOBAL log_bin_trust_function_creators = 1;
-- =====================================================================

DROP DATABASE IF EXISTS bootstrap_db;
CREATE DATABASE IF NOT EXISTS bootstrap_db;
USE bootstrap_db;

CREATE TABLE BootstrapGroup (
    g_id    TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    g_name  VARCHAR(20) NOT NULL UNIQUE          -- Red, Blue, Green, Purple, Yellow
);

CREATE TABLE Mentor (
    m_id         SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    m_name       VARCHAR(60)  NOT NULL,
    dept         VARCHAR(60),
    designation  VARCHAR(50),
    email        VARCHAR(120) NOT NULL UNIQUE
);

CREATE TABLE Activity (
    a_id         TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    a_name       VARCHAR(60)       NOT NULL UNIQUE,
    capacity     SMALLINT UNSIGNED NOT NULL,
    description  VARCHAR(255),
    m_id         SMALLINT UNSIGNED,
    FOREIGN KEY (m_id) REFERENCES Mentor(m_id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_activity_capacity CHECK (capacity > 0)
);

CREATE TABLE Student (
    s_id    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    s_usn   VARCHAR(15)      NOT NULL UNIQUE,
    s_name  VARCHAR(80)      NOT NULL,
    email   VARCHAR(120)     NOT NULL UNIQUE,
    branch  VARCHAR(60),
    g_id    TINYINT UNSIGNED NOT NULL,
    FOREIGN KEY (g_id) REFERENCES BootstrapGroup(g_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX ix_student_group (g_id),
    INDEX ix_student_branch (branch)
);

CREATE TABLE Schedule (
    schedule_id  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `day`        TINYINT UNSIGNED NOT NULL,
    start_time   TIME             NOT NULL,
    end_time     TIME             NOT NULL,
    room         VARCHAR(20),
    a_id         TINYINT UNSIGNED NOT NULL,
    g_id         TINYINT UNSIGNED NOT NULL,
    FOREIGN KEY (a_id) REFERENCES Activity(a_id)       ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY (g_id) REFERENCES BootstrapGroup(g_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    UNIQUE (`day`, g_id),          -- one activity per group per day
    UNIQUE (`day`, a_id),          -- one group per activity per day
    CONSTRAINT chk_schedule_day   CHECK (`day` BETWEEN 1 AND 5),
    CONSTRAINT chk_schedule_times CHECK (end_time > start_time)
);

CREATE TABLE Participates (
    p_id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    s_id            INT UNSIGNED     NOT NULL,
    a_id            TINYINT UNSIGNED NOT NULL,
    check_in_time   DATETIME,
    check_out_time  DATETIME,
    status          ENUM('present','absent','late','excused') NOT NULL DEFAULT 'absent',
    FOREIGN KEY (s_id) REFERENCES Student(s_id)  ON DELETE CASCADE  ON UPDATE CASCADE,
    FOREIGN KEY (a_id) REFERENCES Activity(a_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    UNIQUE (s_id, a_id),           -- one participation row per student per activity
    CONSTRAINT chk_part_times CHECK (check_out_time IS NULL
                                     OR check_in_time IS NULL
                                     OR check_out_time >= check_in_time),
    CONSTRAINT chk_part_absent CHECK (status <> 'absent'
                                      OR (check_in_time IS NULL AND check_out_time IS NULL)),
    INDEX ix_part_activity (a_id),
    INDEX ix_part_status (status)
);

CREATE TABLE Feedback (
    f_id      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    s_id      INT UNSIGNED     NOT NULL,
    a_id      TINYINT UNSIGNED NOT NULL,
    rating    TINYINT UNSIGNED NOT NULL,
    comments  VARCHAR(500),
    `time`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (s_id) REFERENCES Student(s_id)  ON DELETE CASCADE  ON UPDATE CASCADE,
    FOREIGN KEY (a_id) REFERENCES Activity(a_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    UNIQUE (s_id, a_id),           -- one rating per student per activity
    CONSTRAINT chk_fb_rating CHECK (rating BETWEEN 1 AND 5),
    INDEX ix_fb_activity (a_id)
);

CREATE TABLE AttendanceLog (
    log_id      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    p_id        BIGINT UNSIGNED  NOT NULL,
    s_id        INT UNSIGNED     NOT NULL,
    a_id        TINYINT UNSIGNED NOT NULL,
    old_status  VARCHAR(10),
    new_status  VARCHAR(10),
    changed_by  VARCHAR(100),
    changed_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX ix_log_student (s_id),
    INDEX ix_log_activity (a_id)
);
-- No FK to Participates on purpose: the history must survive a deleted student.

-- ------------- CORE ROUTINES NEEDED BEFORE THE SEED DATA --------------
DELIMITER //

-- Build the whole 5x5 rotation:  activity = ((group-1 + day-1) MOD 5) + 1
DROP PROCEDURE IF EXISTS sp_generate_rotation//
CREATE PROCEDURE sp_generate_rotation(IN p_start TIME, IN p_end TIME)
BEGIN
    DECLARE v_day  TINYINT DEFAULT 1;
    DECLARE v_grp  TINYINT;
    DECLARE v_act  TINYINT;
    DECLARE v_rows INT DEFAULT 0;

    SELECT COUNT(*) INTO v_rows FROM Participates;
    IF v_rows > 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Cannot regenerate the rotation while attendance rows exist';
    END IF;

    DELETE FROM Schedule;

    WHILE v_day <= 5 DO
        SET v_grp = 1;
        WHILE v_grp <= 5 DO
            SET v_act = ((v_grp - 1 + v_day - 1) MOD 5) + 1;
            INSERT INTO Schedule (`day`, start_time, end_time, room, a_id, g_id)
            VALUES (v_day, p_start, p_end, CONCAT('ROOM-', LPAD(v_act, 2, '0')), v_act, v_grp);
            SET v_grp = v_grp + 1;
        END WHILE;
        SET v_day = v_day + 1;
    END WHILE;

    SELECT CONCAT(v_day - 1, ' days x 5 groups scheduled') AS result;
END//

-- Room double booking: the UNIQUE keys cover group and activity, not room.
DROP TRIGGER IF EXISTS trg_schedule_room_clash//
CREATE TRIGGER trg_schedule_room_clash
BEFORE INSERT ON Schedule
FOR EACH ROW
BEGIN
    DECLARE v_clash INT DEFAULT 0;
    IF NEW.room IS NOT NULL THEN
        SELECT COUNT(*) INTO v_clash FROM Schedule
        WHERE `day` = NEW.`day` AND room = NEW.room;
        IF v_clash > 0 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'That room is already booked on that day';
        END IF;
    END IF;
END//

-- The activity must be on the student's group rotation, and within capacity.
-- Neither rule can be expressed as a foreign key.
DROP TRIGGER IF EXISTS trg_part_validate//
CREATE TRIGGER trg_part_validate
BEFORE INSERT ON Participates
FOR EACH ROW
BEGIN
    DECLARE v_g_id      TINYINT UNSIGNED;
    DECLARE v_scheduled INT DEFAULT 0;
    DECLARE v_cap       SMALLINT UNSIGNED DEFAULT 0;
    DECLARE v_count     INT DEFAULT 0;

    SELECT g_id INTO v_g_id FROM Student WHERE s_id = NEW.s_id;

    SELECT COUNT(*) INTO v_scheduled FROM Schedule
    WHERE g_id = v_g_id AND a_id = NEW.a_id;
    IF v_scheduled = 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'That activity is not on the rotation for this student''s group';
    END IF;

    SELECT capacity INTO v_cap FROM Activity WHERE a_id = NEW.a_id;
    SELECT COUNT(*) INTO v_count
    FROM Participates p JOIN Student s ON s.s_id = p.s_id
    WHERE p.a_id = NEW.a_id AND s.g_id = v_g_id;
    IF v_count >= v_cap THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'That activity session is already at capacity for this group';
    END IF;
END//

-- Status comes from the clock, not the caller: 15+ minutes late = 'late'.
DROP TRIGGER IF EXISTS trg_part_set_status//
CREATE TRIGGER trg_part_set_status
BEFORE UPDATE ON Participates
FOR EACH ROW
BEGIN
    DECLARE v_g_id  TINYINT UNSIGNED;
    DECLARE v_start TIME;

    IF NEW.status <> 'excused'
       AND NEW.check_in_time IS NOT NULL
       AND (OLD.check_in_time IS NULL OR NEW.check_in_time <> OLD.check_in_time) THEN

        SELECT g_id INTO v_g_id FROM Student WHERE s_id = NEW.s_id;
        SELECT start_time INTO v_start FROM Schedule
        WHERE g_id = v_g_id AND a_id = NEW.a_id LIMIT 1;

        IF v_start IS NOT NULL AND TIME(NEW.check_in_time) > ADDTIME(v_start, '00:15:00') THEN
            SET NEW.status = 'late';
        ELSE
            SET NEW.status = 'present';
        END IF;
    END IF;
END//

-- Append-only audit trail of every attendance status change.
DROP TRIGGER IF EXISTS trg_part_audit//
CREATE TRIGGER trg_part_audit
AFTER UPDATE ON Participates
FOR EACH ROW
BEGIN
    IF NEW.status <> OLD.status THEN
        INSERT INTO AttendanceLog (p_id, s_id, a_id, old_status, new_status, changed_by)
        VALUES (NEW.p_id, NEW.s_id, NEW.a_id, OLD.status, NEW.status, CURRENT_USER());
    END IF;
END//

-- A student who never turned up has nothing to rate.
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
    IF v_status = 'absent' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'An absent student cannot rate the activity';
    END IF;
END//

DELIMITER ;

-- =====================================================================
-- PART 1 : DDL EXTRAS  (ALTER / CREATE / DROP / INDEX / CONSTRAINTS)
-- =====================================================================

-- 1.1 ALTER : new columns + extra constraints
ALTER TABLE Student ADD COLUMN semester TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER branch;
ALTER TABLE Student ADD CONSTRAINT chk_student_semester CHECK (semester BETWEEN 1 AND 8);
ALTER TABLE Mentor  ADD COLUMN phone VARCHAR(15) AFTER email;
ALTER TABLE Mentor  ADD CONSTRAINT chk_phone_len CHECK (phone IS NULL OR CHAR_LENGTH(phone) >= 10);
ALTER TABLE Feedback MODIFY comments VARCHAR(1000);
ALTER TABLE Activity ADD CONSTRAINT chk_capacity_max CHECK (capacity <= 500);
ALTER TABLE Participates ADD INDEX ix_part_checkin (check_in_time);

-- 1.2 CREATE / ALTER / DROP demo on a scratch table
CREATE TABLE TempScratch (id INT PRIMARY KEY, note VARCHAR(50));
ALTER TABLE TempScratch ADD COLUMN created_on DATE;
ALTER TABLE TempScratch RENAME COLUMN note TO remarks;
ALTER TABLE TempScratch DROP COLUMN remarks;
DROP TABLE TempScratch;

-- 1.3 INDEXES (composite, covering, full-text). The composite replaces the
--     two single-column ones, and must exist before they are dropped.
CREATE INDEX ix_student_group_branch ON Student (g_id, branch);
ALTER TABLE Student DROP INDEX ix_student_branch;
ALTER TABLE Student DROP INDEX ix_student_group;

CREATE INDEX ix_part_activity_status ON Participates (a_id, status);
CREATE INDEX ix_schedule_day_room    ON Schedule (`day`, room);
CREATE INDEX ix_mentor_dept          ON Mentor (dept);
CREATE FULLTEXT INDEX ft_feedback_comments ON Feedback (comments);
CREATE FULLTEXT INDEX ft_activity_text     ON Activity (a_name, description);
DROP INDEX ix_mentor_dept ON Mentor;        -- DROP INDEX demo
SHOW INDEX FROM Participates;

-- =====================================================================
-- PART 2 : DML - INSERT (seed data)
-- =====================================================================
-- Order forced by trg_part_validate: groups, mentors, activities, ROTATION,
-- students, participation, attendance, feedback. Values are modulo-derived
-- test data, not real observations.

-- 2.1 The five colour groups
INSERT INTO BootstrapGroup (g_id, g_name) VALUES
(1, 'Red'), (2, 'Blue'), (3, 'Green'), (4, 'Purple'), (5, 'Yellow');

-- 2.2 Mentors (8; three stay unassigned, which exercises the nullable FK)
INSERT INTO Mentor (m_id, m_name, dept, designation, email, phone) VALUES
(1, 'Anitha Rao',    'Mechanical Engineering',           'Associate Professor', 'anitha.rao@univ.edu',    '9845010001'),
(2, 'Priya Iyer',    'Computer Science and Engineering', 'Assistant Professor', 'priya.iyer@univ.edu',    '9845010002'),
(3, 'Suresh Pai',    'Design and Innovation',            'Professor',           'suresh.pai@univ.edu',    '9845010003'),
(4, 'Sneha Kamath',  'Biotechnology',                    'Associate Professor', 'sneha.kamath@univ.edu',  '9845010004'),
(5, 'Ramesh Naik',   'Electrical and Electronics',       'Assistant Professor', 'ramesh.naik@univ.edu',   '9845010005'),
(6, 'Vikram Shetty', 'Mechanical Engineering',           'Assistant Professor', 'vikram.shetty@univ.edu', '9845010006'),
(7, 'Meera Joshi',   'Computer Science and Engineering', 'Associate Professor', 'meera.joshi@univ.edu',   '9845010007'),
(8, 'Farhan Ahmed',  'Design and Innovation',            'Assistant Professor', 'farhan.ahmed@univ.edu',  '9845010008');

-- 2.3 The five activities (Electrical Circuits runs the smallest lab)
INSERT INTO Activity (a_id, a_name, capacity, description, m_id) VALUES
(1, 'Automobiles and Robotics', 60, 'Chassis assembly, servo wiring and line following robot build', 1),
(2, 'Prompt Engineering',       60, 'Working with large language models and structured prompting',   2),
(3, 'Design Thinking',          60, 'Empathise, ideate, paper prototyping and rapid user testing',   3),
(4, 'Biotechnology',            60, 'Wet lab safety, micropipetting technique and gel runs',         4),
(5, 'Electrical Circuits',      25, 'Breadboard layout, soldering practice and circuit analysis',    5);

-- 2.4 The rotation : 25 rows built by the stored procedure
CALL sp_generate_rotation('09:00:00', '16:30:00');

-- 2.5 Students (50, ten per colour group; g_id cycles 1..5)
INSERT INTO Student (s_usn, s_name, email, branch, semester, g_id) VALUES
('1BM26CS001', 'Aarav Sharma',     'aarav.sharma@univ.edu',     'Computer Science', 1, 1),
('1BM26EC002', 'Bhavana Nayak',    'bhavana.nayak@univ.edu',    'Electronics',      1, 2),
('1BM26ME003', 'Chirag Patel',     'chirag.patel@univ.edu',     'Mechanical',       1, 3),
('1BM26BT004', 'Divya Menon',      'divya.menon@univ.edu',      'Biotechnology',    1, 4),
('1BM26CV005', 'Eshan Kulkarni',   'eshan.kulkarni@univ.edu',   'Civil',            1, 5),
('1BM26CS006', 'Farhan Siddiqui',  'farhan.siddiqui@univ.edu',  'Computer Science', 1, 1),
('1BM26EC007', 'Gayathri Kamath',  'gayathri.kamath@univ.edu',  'Electronics',      1, 2),
('1BM26ME008', 'Harish Raghavan',  'harish.raghavan@univ.edu',  'Mechanical',       1, 3),
('1BM26BT009', 'Ishita Verma',     'ishita.verma@univ.edu',     'Biotechnology',    1, 4),
('1BM26CV010', 'Jatin Prakash',    'jatin.prakash@univ.edu',    'Civil',            1, 5),
('1BM26CS011', 'Kavya Deshpande',  'kavya.deshpande@univ.edu',  'Computer Science', 2, 1),
('1BM26EC012', 'Lohith Krishnan',  'lohith.krishnan@univ.edu',  'Electronics',      2, 2),
('1BM26ME013', 'Manav Gupta',      'manav.gupta@univ.edu',      'Mechanical',       2, 3),
('1BM26BT014', 'Nandini Shetty',   'nandini.shetty@univ.edu',   'Biotechnology',    2, 4),
('1BM26CV015', 'Omkar Joshi',      'omkar.joshi@univ.edu',      'Civil',            2, 5),
('1BM26CS016', 'Pallavi Reddy',    'pallavi.reddy@univ.edu',    'Computer Science', 2, 1),
('1BM26EC017', 'Qasim Ali',        'qasim.ali@univ.edu',        'Electronics',      2, 2),
('1BM26ME018', 'Rithika Bhat',     'rithika.bhat@univ.edu',     'Mechanical',       2, 3),
('1BM26BT019', 'Sagar Hegde',      'sagar.hegde@univ.edu',      'Biotechnology',    2, 4),
('1BM26CV020', 'Tanvi Iyer',       'tanvi.iyer@univ.edu',       'Civil',            2, 5),
('1BM26CS021', 'Uday Chandran',    'uday.chandran@univ.edu',    'Computer Science', 1, 1),
('1BM26EC022', 'Varsha Pillai',    'varsha.pillai@univ.edu',    'Electronics',      1, 2),
('1BM26ME023', 'Wasim Khan',       'wasim.khan@univ.edu',       'Mechanical',       1, 3),
('1BM26BT024', 'Yamini Rao',       'yamini.rao@univ.edu',       'Biotechnology',    1, 4),
('1BM26CV025', 'Zoya Fernandes',   'zoya.fernandes@univ.edu',   'Civil',            1, 5),
('1BM26CS026', 'Aditya Rane',      'aditya.rane@univ.edu',      'Computer Science', 2, 1),
('1BM26EC027', 'Bhoomika Jain',    'bhoomika.jain@univ.edu',    'Electronics',      2, 2),
('1BM26ME028', 'Chetan Murthy',    'chetan.murthy@univ.edu',    'Mechanical',       2, 3),
('1BM26BT029', 'Deepika Shenoy',   'deepika.shenoy@univ.edu',   'Biotechnology',    2, 4),
('1BM26CV030', 'Eknath Salian',    'eknath.salian@univ.edu',    'Civil',            2, 5),
('1BM26CS031', 'Fiza Mirza',       'fiza.mirza@univ.edu',       'Computer Science', 1, 1),
('1BM26EC032', 'Girish Acharya',   'girish.acharya@univ.edu',   'Electronics',      1, 2),
('1BM26ME033', 'Hemanth Kini',     'hemanth.kini@univ.edu',     'Mechanical',       1, 3),
('1BM26BT034', 'Indira Varma',     'indira.varma@univ.edu',     'Biotechnology',    1, 4),
('1BM26CV035', 'Jeevan Poojary',   'jeevan.poojary@univ.edu',   'Civil',            1, 5),
('1BM26CS036', 'Keerthi Suresh',   'keerthi.suresh@univ.edu',   'Computer Science', 2, 1),
('1BM26EC037', 'Lalit Bansal',     'lalit.bansal@univ.edu',     'Electronics',      2, 2),
('1BM26ME038', 'Meghana Rau',      'meghana.rau@univ.edu',      'Mechanical',       2, 3),
('1BM26BT039', 'Nikhil Dsouza',    'nikhil.dsouza@univ.edu',    'Biotechnology',    2, 4),
('1BM26CV040', 'Oviya Natarajan',  'oviya.natarajan@univ.edu',  'Civil',            2, 5),
('1BM26CS041', 'Pranav Hebbar',    'pranav.hebbar@univ.edu',    'Computer Science', 1, 1),
('1BM26EC042', 'Rakshita Udupa',   'rakshita.udupa@univ.edu',   'Electronics',      1, 2),
('1BM26ME043', 'Siddharth Menon',  'siddharth.menon@univ.edu',  'Mechanical',       1, 3),
('1BM26BT044', 'Trisha Baliga',    'trisha.baliga@univ.edu',    'Biotechnology',    1, 4),
('1BM26CV045', 'Ujwal Kadam',      'ujwal.kadam@univ.edu',      'Civil',            1, 5),
('1BM26CS046', 'Vaishnavi Prabhu', 'vaishnavi.prabhu@univ.edu', 'Computer Science', 2, 1),
('1BM26EC047', 'Yash Thakur',      'yash.thakur@univ.edu',      'Electronics',      2, 2),
('1BM26ME048', 'Zara Qureshi',     'zara.qureshi@univ.edu',     'Mechanical',       2, 3),
('1BM26BT049', 'Akhil Ramanna',    'akhil.ramanna@univ.edu',    'Biotechnology',    2, 4),
('1BM26CV050', 'Bindu Shastry',    'bindu.shastry@univ.edu',    'Civil',            2, 5);

-- 2.6 Participation : 250 rows via INSERT ... SELECT, each one trigger-checked
INSERT INTO Participates (s_id, a_id, status)
SELECT s.s_id, a.a_id, 'absent'
FROM   Student s CROSS JOIN Activity a;

-- 2.7 UPDATE : only timestamps are set; the triggers derive the status and
--     log it. Roughly one row in ten is skipped and stays 'absent'.
UPDATE Participates p
JOIN   Student  s  ON s.s_id  = p.s_id
JOIN   Schedule sc ON sc.g_id = s.g_id AND sc.a_id = p.a_id
SET    p.check_in_time  = TIMESTAMP(DATE_ADD('2026-10-05', INTERVAL sc.`day` - 1 DAY),
                              ADDTIME(sc.start_time,
                                      SEC_TO_TIME(((p.s_id * 7 + p.a_id * 13) MOD 35) * 60))),
       p.check_out_time = TIMESTAMP(DATE_ADD('2026-10-05', INTERVAL sc.`day` - 1 DAY), sc.end_time)
WHERE  (p.s_id * 11 + p.a_id * 5) MOD 10 <> 0;

-- 2.8 UPDATE : some documented absences become 'excused'
UPDATE Participates
SET    status = 'excused'
WHERE  check_in_time IS NULL AND (s_id + a_id) MOD 4 = 1;

-- 2.9 Feedback : attenders only (trg_feedback_validate). Text is varied so
--     the FULLTEXT index has something to match on.
INSERT INTO Feedback (s_id, a_id, rating, comments)
SELECT p.s_id, p.a_id,
       1 + ((p.s_id * 5 + p.a_id * 11) MOD 5),
       CASE (p.s_id + p.a_id) MOD 8
           WHEN 0 THEN 'Excellent hands on session, the soldering practice was easily the best part of the week.'
           WHEN 1 THEN 'The mentor explained the theory clearly but we ran short of time near the end.'
           WHEN 2 THEN 'Lab was too crowded, had to share equipment with three other students for most of the day.'
           WHEN 3 THEN 'Loved building the robot chassis, would happily spend a second day on this activity.'
           WHEN 4 THEN 'Good introduction overall but the prototyping tools were outdated and slow.'
           WHEN 5 THEN 'The group exercise on ideation was engaging and very well paced throughout.'
           WHEN 6 THEN 'Felt rushed, the circuit analysis needed more worked examples before the practical.'
           ELSE        'Well organised, clear instructions and the teaching assistants were genuinely helpful.'
       END
FROM   Participates p
WHERE  p.status IN ('present','late') AND (p.s_id + p.a_id) MOD 3 = 0;

-- 2.10 Load check
SELECT 'BootstrapGroup' AS table_name, COUNT(*) AS rows_loaded FROM BootstrapGroup
UNION ALL SELECT 'Mentor',         COUNT(*) FROM Mentor
UNION ALL SELECT 'Activity',       COUNT(*) FROM Activity
UNION ALL SELECT 'Schedule',       COUNT(*) FROM Schedule
UNION ALL SELECT 'Student',        COUNT(*) FROM Student
UNION ALL SELECT 'Participates',   COUNT(*) FROM Participates
UNION ALL SELECT 'Feedback',       COUNT(*) FROM Feedback
UNION ALL SELECT 'AttendanceLog',  COUNT(*) FROM AttendanceLog;

-- =====================================================================
-- PART 3 : STORED FUNCTIONS, PROCEDURES, TRIGGERS, VIEWS
-- =====================================================================
DELIMITER //

-- ---------------------------- FUNCTIONS ------------------------------
DROP FUNCTION IF EXISTS fn_session_minutes//
CREATE FUNCTION fn_session_minutes(p_in DATETIME, p_out DATETIME) RETURNS INT
DETERMINISTIC
BEGIN
    IF p_in IS NULL OR p_out IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN TIMESTAMPDIFF(MINUTE, p_in, p_out);
END//

DROP FUNCTION IF EXISTS fn_attendance_pct//
CREATE FUNCTION fn_attendance_pct(p_s_id INT UNSIGNED) RETURNS DECIMAL(5,2)
READS SQL DATA
BEGIN
    DECLARE v_total   INT DEFAULT 0;
    DECLARE v_present INT DEFAULT 0;
    -- 'late' still counts as having turned up
    SELECT COUNT(*), IFNULL(SUM(status IN ('present','late')), 0)
    INTO   v_total, v_present
    FROM   Participates WHERE s_id = p_s_id;

    IF v_total = 0 THEN RETURN 0.00; END IF;
    RETURN ROUND(v_present * 100.0 / v_total, 2);
END//

DROP FUNCTION IF EXISTS fn_activity_rating//
CREATE FUNCTION fn_activity_rating(p_a_id TINYINT UNSIGNED) RETURNS DECIMAL(3,2)
READS SQL DATA
BEGIN
    DECLARE v DECIMAL(3,2);
    SELECT ROUND(AVG(rating), 2) INTO v FROM Feedback WHERE a_id = p_a_id;
    RETURN IFNULL(v, 0.00);
END//

DROP FUNCTION IF EXISTS fn_scheduled_day//
CREATE FUNCTION fn_scheduled_day(p_g_id TINYINT UNSIGNED, p_a_id TINYINT UNSIGNED) RETURNS TINYINT
READS SQL DATA
BEGIN
    DECLARE v TINYINT;
    SELECT `day` INTO v FROM Schedule WHERE g_id = p_g_id AND a_id = p_a_id LIMIT 1;
    RETURN v;      -- NULL if that pairing is not on the rotation
END//

DROP FUNCTION IF EXISTS fn_risk_level//
CREATE FUNCTION fn_risk_level(p_s_id INT UNSIGNED) RETURNS VARCHAR(10)
READS SQL DATA
BEGIN
    DECLARE v DECIMAL(5,2);
    SET v = fn_attendance_pct(p_s_id);
    RETURN CASE WHEN v >= 80 THEN 'LOW' WHEN v >= 60 THEN 'MEDIUM' ELSE 'HIGH' END;
END//

-- ----------------------------- TRIGGERS ------------------------------
-- (above: trg_schedule_room_clash, trg_part_validate, trg_part_set_status,
--  trg_part_audit, trg_feedback_validate)

DROP TRIGGER IF EXISTS trg_student_protect//
CREATE TRIGGER trg_student_protect
BEFORE DELETE ON Student
FOR EACH ROW
BEGIN
    DECLARE v_attended INT DEFAULT 0;
    SELECT COUNT(*) INTO v_attended FROM Participates
    WHERE s_id = OLD.s_id AND status IN ('present','late');
    IF v_attended > 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Cannot delete a student with recorded attendance';
    END IF;
END//

DROP TRIGGER IF EXISTS trg_feedback_clamp//
CREATE TRIGGER trg_feedback_clamp
BEFORE UPDATE ON Feedback
FOR EACH ROW
BEGIN
    -- revising a rating always restamps the submission time
    IF NEW.rating <> OLD.rating OR NOT (NEW.comments <=> OLD.comments) THEN
        SET NEW.`time` = NOW();
    END IF;
END//

-- ---------------------------- PROCEDURES -----------------------------
DROP PROCEDURE IF EXISTS sp_enroll_student//
CREATE PROCEDURE sp_enroll_student(IN  p_usn    VARCHAR(15),
                                   IN  p_name   VARCHAR(80),
                                   IN  p_email  VARCHAR(120),
                                   IN  p_branch VARCHAR(60),
                                   IN  p_sem    TINYINT UNSIGNED,
                                   IN  p_g_id   TINYINT UNSIGNED,
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

    -- every student does every activity, so open all five rows now
    INSERT INTO Participates (s_id, a_id, status)
    SELECT p_s_id, a_id, 'absent' FROM Activity;
    COMMIT;

    SELECT CONCAT('Student ', p_usn, ' enrolled with id ', p_s_id) AS result;
END//

DROP PROCEDURE IF EXISTS sp_transfer_student//
CREATE PROCEDURE sp_transfer_student(IN p_s_id INT UNSIGNED, IN p_new_g_id TINYINT UNSIGNED)
BEGIN
    DECLARE v_old TINYINT UNSIGNED DEFAULT NULL;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;
    SELECT g_id INTO v_old FROM Student WHERE s_id = p_s_id FOR UPDATE;   -- row lock

    IF v_old IS NULL THEN
        ROLLBACK;
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No such student';
    END IF;
    IF v_old = p_new_g_id THEN
        ROLLBACK;
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Student is already in that group';
    END IF;

    UPDATE Student SET g_id = p_new_g_id WHERE s_id = p_s_id;
    SAVEPOINT group_changed;

    -- the rotation days all change, so the participation rows are rebuilt
    DELETE FROM Participates WHERE s_id = p_s_id;
    INSERT INTO Participates (s_id, a_id, status)
    SELECT p_s_id, a_id, 'absent' FROM Activity;
    COMMIT;

    SELECT CONCAT('Student ', p_s_id, ' moved from group ', v_old, ' to ', p_new_g_id) AS result;
END//

DROP PROCEDURE IF EXISTS sp_check_in//
CREATE PROCEDURE sp_check_in(IN p_s_id INT UNSIGNED, IN p_a_id TINYINT UNSIGNED)
BEGIN
    UPDATE Participates
    SET    check_in_time = NOW(), status = 'present'
    WHERE  s_id = p_s_id AND a_id = p_a_id;        -- trg_part_set_status may force 'late'

    IF ROW_COUNT() = 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'No participation row for that student and activity';
    END IF;
    SELECT 'Checked in' AS result;
END//

DROP PROCEDURE IF EXISTS sp_check_out//
CREATE PROCEDURE sp_check_out(IN p_s_id INT UNSIGNED, IN p_a_id TINYINT UNSIGNED)
BEGIN
    UPDATE Participates
    SET    check_out_time = NOW()
    WHERE  s_id = p_s_id AND a_id = p_a_id AND check_in_time IS NOT NULL;

    IF ROW_COUNT() = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Student has not checked in to that activity';
    END IF;
    SELECT 'Checked out' AS result;
END//

DROP PROCEDURE IF EXISTS sp_submit_feedback//
CREATE PROCEDURE sp_submit_feedback(IN p_s_id INT UNSIGNED, IN p_a_id TINYINT UNSIGNED,
                                    IN p_rating TINYINT UNSIGNED, IN p_comments VARCHAR(1000))
BEGIN
    DECLARE v_status VARCHAR(10) DEFAULT NULL;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_status = NULL;

    SELECT status INTO v_status FROM Participates WHERE s_id = p_s_id AND a_id = p_a_id;
    IF v_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'That student is not enrolled in that activity';
    END IF;

    INSERT INTO Feedback (s_id, a_id, rating, comments)
    VALUES (p_s_id, p_a_id, p_rating, p_comments)
    ON DUPLICATE KEY UPDATE rating = p_rating, comments = p_comments, `time` = NOW();

    SELECT 'Feedback recorded' AS result;
END//

DROP PROCEDURE IF EXISTS sp_group_report//
CREATE PROCEDURE sp_group_report(IN p_g_id TINYINT UNSIGNED)
BEGIN
    SELECT sc.`day`, a.a_name, sc.room,
           COUNT(p.p_id)                                        AS enrolled,
           SUM(p.status = 'present')                            AS present,
           SUM(p.status = 'late')                               AS late_arrivals,
           SUM(p.status = 'absent')                             AS absent,
           ROUND(100 * SUM(p.status IN ('present','late')) / COUNT(p.p_id), 2) AS attendance_pct,
           fn_activity_rating(a.a_id)                           AS avg_rating
    FROM   Schedule sc
    JOIN   Activity a  ON a.a_id  = sc.a_id
    JOIN   Student  st ON st.g_id = sc.g_id
    JOIN   Participates p ON p.s_id = st.s_id AND p.a_id = a.a_id
    WHERE  sc.g_id = p_g_id
    GROUP  BY sc.`day`, a.a_id, a.a_name, sc.room
    ORDER  BY sc.`day`;
END//

DROP PROCEDURE IF EXISTS sp_mark_absentees//
CREATE PROCEDURE sp_mark_absentees(IN p_a_id TINYINT UNSIGNED)
BEGIN
    -- cursor walk: excuse everyone still absent from one activity
    DECLARE done    INT DEFAULT 0;
    DECLARE v_s     INT UNSIGNED;
    DECLARE v_count INT DEFAULT 0;
    DECLARE cur CURSOR FOR
        SELECT s_id FROM Participates WHERE a_id = p_a_id AND status = 'absent';
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

    OPEN cur;
    read_loop: LOOP
        FETCH cur INTO v_s;
        IF done = 1 THEN LEAVE read_loop; END IF;
        UPDATE Participates SET status = 'excused' WHERE s_id = v_s AND a_id = p_a_id;
        SET v_count = v_count + 1;
    END LOOP;
    CLOSE cur;

    SELECT v_count AS students_excused;
END//

DROP PROCEDURE IF EXISTS sp_search_feedback//
CREATE PROCEDURE sp_search_feedback(IN p_terms VARCHAR(200))
BEGIN
    SELECT f.f_id, s.s_usn, s.s_name, a.a_name, f.rating, f.comments,
           MATCH(f.comments) AGAINST(p_terms IN NATURAL LANGUAGE MODE) AS relevance
    FROM   Feedback f
    JOIN   Student  s ON s.s_id = f.s_id
    JOIN   Activity a ON a.a_id = f.a_id
    WHERE  MATCH(f.comments) AGAINST(p_terms IN NATURAL LANGUAGE MODE)
    ORDER  BY relevance DESC
    LIMIT  20;
END//

DELIMITER ;

-- ------------------------------ VIEWS --------------------------------
CREATE OR REPLACE VIEW vw_timetable AS
SELECT sc.`day`, g.g_name AS colour_group, a.a_name AS activity,
       sc.room, sc.start_time, sc.end_time, m.m_name AS mentor
FROM   Schedule sc
JOIN   BootstrapGroup g ON g.g_id = sc.g_id
JOIN   Activity       a ON a.a_id = sc.a_id
LEFT JOIN Mentor      m ON m.m_id = a.m_id;

CREATE OR REPLACE VIEW vw_student_attendance AS
SELECT s.s_id, s.s_usn, s.s_name, g.g_name AS colour_group, s.branch, s.semester,
       COUNT(p.p_id)             AS sessions,
       SUM(p.status = 'present') AS present,
       SUM(p.status = 'late')    AS late_arrivals,
       SUM(p.status = 'absent')  AS absent,
       SUM(p.status = 'excused') AS excused,
       fn_attendance_pct(s.s_id) AS attendance_pct,
       fn_risk_level(s.s_id)     AS risk
FROM   Student s
JOIN   BootstrapGroup g ON g.g_id = s.g_id
LEFT JOIN Participates p ON p.s_id = s.s_id
GROUP  BY s.s_id, s.s_usn, s.s_name, g.g_name, s.branch, s.semester;

CREATE OR REPLACE VIEW vw_activity_stats AS
SELECT a.a_id, a.a_name, a.capacity, m.m_name AS mentor,
       COUNT(p.p_id)                                                        AS enrolled,
       SUM(p.status IN ('present','late'))                                  AS attended,
       ROUND(100 * SUM(p.status IN ('present','late')) / NULLIF(COUNT(p.p_id),0), 2) AS attendance_pct,
       fn_activity_rating(a.a_id)                                           AS avg_rating,
       (SELECT COUNT(*) FROM Feedback f WHERE f.a_id = a.a_id)              AS responses
FROM   Activity a
LEFT JOIN Mentor       m ON m.m_id = a.m_id
LEFT JOIN Participates p ON p.a_id = a.a_id
GROUP  BY a.a_id, a.a_name, a.capacity, m.m_name;

CREATE OR REPLACE VIEW vw_attendance_audit AS
SELECT l.log_id, l.changed_at, s.s_usn, s.s_name, a.a_name AS activity,
       l.old_status, l.new_status, l.changed_by
FROM   AttendanceLog l
JOIN   Student  s ON s.s_id = l.s_id
JOIN   Activity a ON a.a_id = l.a_id;

CREATE OR REPLACE VIEW vw_activity_ranking AS
SELECT a.a_name, f.rating, s.s_name,
       RANK() OVER (PARTITION BY a.a_id ORDER BY f.rating DESC) AS rating_rank
FROM   Feedback f
JOIN   Activity a ON a.a_id = f.a_id
JOIN   Student  s ON s.s_id = f.s_id;

-- UPDATABLE view. WITH CHECK OPTION rejects any write that would move a row
-- out of the view, so this coordinator cannot touch another activity.
CREATE OR REPLACE VIEW vw_circuits_feedback AS
SELECT f_id, s_id, a_id, rating, comments, `time`
FROM   Feedback WHERE a_id = 5
WITH CHECK OPTION;

-- =====================================================================
-- PART 4 : RUNNING THE WORKFLOW (procedures + triggers in action)
-- =====================================================================

-- 4.1 Reports through the procedures
CALL sp_group_report(1);
CALL sp_group_report(3);

-- 4.2 Test the functions
SELECT fn_attendance_pct(1)        AS student1_attendance,
       fn_activity_rating(5)       AS circuits_avg_rating,
       fn_scheduled_day(3, 5)      AS green_does_circuits_on_day,
       fn_risk_level(1)            AS student1_risk,
       fn_session_minutes('2026-10-05 09:10:00','2026-10-05 16:30:00') AS minutes;

-- 4.3 Enrol a late registrant (transaction inside the procedure)
CALL sp_enroll_student('1BM26CS051', 'Nikita Joshi', 'nikita.joshi@univ.edu',
                       'Computer Science', 1, 1, @new_id);
SELECT @new_id AS newly_created_s_id;

CALL sp_check_in(@new_id, 1);
CALL sp_check_out(@new_id, 1);
CALL sp_submit_feedback(@new_id, 1, 5, 'Joined late but the robotics build was very well run.');
SELECT * FROM Participates WHERE s_id = @new_id;

-- 4.4 Move a student between colour groups (transaction + SAVEPOINT)
CALL sp_transfer_student(@new_id, 4);
SELECT s_usn, g_id FROM Student WHERE s_id = @new_id;

-- 4.5 Cursor procedure : excuse everyone still absent from Biotechnology
CALL sp_mark_absentees(4);
SELECT status, COUNT(*) FROM Participates WHERE a_id = 4 GROUP BY status;

-- 4.6 Triggers firing : a late check-in is reclassified and logged
UPDATE Participates
SET    check_in_time = TIMESTAMP('2026-10-05','11:45:00')
WHERE  s_id = 2 AND a_id = 2;                        -- trg_part_set_status -> 'late'
SELECT status, check_in_time FROM Participates WHERE s_id = 2 AND a_id = 2;
SELECT * FROM vw_attendance_audit WHERE s_usn = '1BM26EC002' ORDER BY changed_at DESC LIMIT 5;

-- 4.7 INSERT / UPDATE / DELETE on live data
INSERT INTO Mentor (m_name, dept, designation, email, phone) VALUES
('Arjun Bhat',  'Biotechnology',              'Lab Instructor', 'arjun.bhat@univ.edu',  '9845010009'),
('Kavya Hegde', 'Electrical and Electronics', 'Lab Instructor', 'kavya.hegde@univ.edu', '9845010010');

UPDATE Mentor SET designation = 'Professor' WHERE m_name = 'Anitha Rao';

UPDATE Schedule sc JOIN Activity a ON a.a_id = sc.a_id        -- UPDATE with JOIN
SET    sc.room = 'LAB-BLOCK-E'
WHERE  a.a_name = 'Electrical Circuits';

UPDATE vw_circuits_feedback SET rating = 4 WHERE rating = 1;  -- UPDATE through a view

DELETE FROM Mentor WHERE m_name = 'Farhan Ahmed';             -- ON DELETE SET NULL
SELECT a_name, m_id FROM Activity WHERE m_id IS NULL;

DELETE FROM Feedback                                          -- DELETE with subquery
WHERE  (s_id, a_id) IN (SELECT s_id, a_id FROM
                          (SELECT s_id, a_id FROM Participates WHERE status = 'excused') AS ex);

DELETE l FROM AttendanceLog l                                 -- multi-table DELETE
LEFT JOIN Student s ON s.s_id = l.s_id
WHERE  s.s_id IS NULL;

-- 4.8 Rules that are supposed to FAIL. Uncomment one at a time (error 1644).
-- DELETE FROM Student WHERE s_usn = '1BM26CS001';            -- trg_student_protect
-- INSERT INTO Schedule (`day`, start_time, end_time, room, a_id, g_id)
--        VALUES (1,'09:00:00','16:30:00','ROOM-01',2,1);     -- trg_schedule_room_clash
-- INSERT INTO Feedback (s_id, a_id, rating, comments)
--        SELECT s_id, a_id, 5, 'Rejected' FROM Participates WHERE status='absent' LIMIT 1;
-- UPDATE Activity SET capacity = 5 WHERE a_id = 5;
-- INSERT INTO Participates (s_id, a_id) VALUES (1, 5);       -- trg_part_validate capacity
-- UPDATE Activity SET capacity = 25 WHERE a_id = 5;
-- UPDATE vw_circuits_feedback SET a_id = 3 WHERE f_id =
--        (SELECT MIN(f_id) FROM (SELECT f_id FROM Feedback WHERE a_id=5) t);  -- CHECK OPTION

-- =====================================================================
-- PART 5 : SELECT QUERIES (JOIN, GROUP BY, HAVING, ORDER BY, subqueries)
-- =====================================================================

-- Q1  INNER JOIN : the printed timetable for the Green group
SELECT sc.`day`, g.g_name AS colour_group, a.a_name AS activity, sc.room, sc.start_time
FROM   Schedule sc
JOIN   BootstrapGroup g ON g.g_id = sc.g_id
JOIN   Activity       a ON a.a_id = sc.a_id
WHERE  g.g_name = 'Green'
ORDER  BY sc.`day`;

-- Q2  LEFT JOIN : every mentor, including the ones never assigned
SELECT m.m_name, m.dept, a.a_name AS assigned_activity
FROM   Mentor m LEFT JOIN Activity a ON a.m_id = m.m_id
ORDER  BY a.a_name IS NULL, m.m_name;

-- Q3  GROUP BY + aggregates : attendance per activity
SELECT a.a_name, COUNT(p.p_id) AS enrolled,
       SUM(p.status = 'present') AS present, SUM(p.status = 'late') AS late_arrivals,
       SUM(p.status = 'absent')  AS absent,  AVG(TIMESTAMPDIFF(MINUTE, p.check_in_time,
                                                               p.check_out_time)) AS avg_minutes
FROM   Activity a JOIN Participates p ON p.a_id = a.a_id
GROUP  BY a.a_id, a.a_name;

-- Q4  HAVING : branches with more than eight students on the programme
SELECT branch, COUNT(*) AS students, ROUND(AVG(semester), 2) AS avg_semester
FROM   Student
GROUP  BY branch
HAVING COUNT(*) > 8
ORDER  BY students DESC;

-- Q5  HAVING on a join : activities whose attendance fell below 90%
SELECT a.a_name, COUNT(p.p_id) AS enrolled,
       ROUND(100 * SUM(p.status IN ('present','late')) / COUNT(p.p_id), 2) AS attendance_pct
FROM   Activity a JOIN Participates p ON p.a_id = a.a_id
GROUP  BY a.a_id, a.a_name
HAVING attendance_pct < 90
ORDER  BY attendance_pct;

-- Q6  ORDER BY + LIMIT : the ten best attenders
SELECT s_usn, s_name, colour_group, attendance_pct
FROM   vw_student_attendance
ORDER  BY attendance_pct DESC, s_name
LIMIT  10;

-- Q7  Scalar subquery : students below the programme average attendance
SELECT s.s_usn, s.s_name, fn_attendance_pct(s.s_id) AS attendance_pct
FROM   Student s
WHERE  fn_attendance_pct(s.s_id) < (SELECT AVG(fn_attendance_pct(s2.s_id)) FROM Student s2)
ORDER  BY attendance_pct;

-- Q8  IN subquery : everyone who missed Electrical Circuits
SELECT s_usn, s_name, branch FROM Student
WHERE  s_id IN (SELECT s_id FROM Participates WHERE a_id = 5 AND status = 'absent')
ORDER  BY s_usn;

-- Q9  NOT EXISTS : students who never submitted any feedback
SELECT s.s_usn, s.s_name FROM Student s
WHERE  NOT EXISTS (SELECT 1 FROM Feedback f WHERE f.s_id = s.s_id)
ORDER  BY s.s_usn;

-- Q10 CORRELATED EXISTS : students who were late at least once
SELECT s.s_usn, s.s_name FROM Student s
WHERE  EXISTS (SELECT 1 FROM Participates p WHERE p.s_id = s.s_id AND p.status = 'late');

-- Q11 CORRELATED subquery : each student's best-rated activity
SELECT s.s_usn, s.s_name,
       (SELECT a.a_name FROM Feedback f JOIN Activity a ON a.a_id = f.a_id
         WHERE f.s_id = s.s_id ORDER BY f.rating DESC, a.a_name LIMIT 1) AS favourite_activity
FROM   Student s ORDER BY s.s_usn LIMIT 15;

-- Q12 NESTED (multi-level) subquery : groups attending better than average
SELECT t.g_name, t.pct
FROM  (SELECT g.g_name, ROUND(100 * SUM(p.status IN ('present','late')) / COUNT(*), 2) AS pct
       FROM   BootstrapGroup g JOIN Student s ON s.g_id = g.g_id
       JOIN   Participates p ON p.s_id = s.s_id
       GROUP  BY g.g_id, g.g_name) t
WHERE t.pct > (SELECT AVG(x.pct) FROM
                 (SELECT ROUND(100 * SUM(p.status IN ('present','late')) / COUNT(*), 2) AS pct
                  FROM BootstrapGroup g JOIN Student s ON s.g_id = g.g_id
                  JOIN Participates p ON p.s_id = s.s_id
                  GROUP BY g.g_id) x);

-- Q13 Derived table : the three activities with the most absences
SELECT t.a_name, t.absences
FROM  (SELECT a.a_name, SUM(p.status = 'absent') AS absences
       FROM   Activity a JOIN Participates p ON p.a_id = a.a_id
       GROUP  BY a.a_id, a.a_name) AS t
ORDER BY t.absences DESC LIMIT 3;

-- Q14 ANY / ALL : ratings that beat every rating given to Electrical Circuits
SELECT DISTINCT a.a_name, f.rating
FROM   Feedback f JOIN Activity a ON a.a_id = f.a_id
WHERE  f.rating > ALL (SELECT rating FROM Feedback WHERE a_id = 5);

-- Q15 UNION : everyone involved, either as a student or as a mentor
SELECT s_name AS name, 'Student' AS involvement FROM Student WHERE g_id = 1
UNION
SELECT m_name, 'Mentor' FROM Mentor WHERE m_id IN (SELECT m_id FROM Activity WHERE m_id IS NOT NULL);

-- Q16 CASE + function : attendance risk report
SELECT s.s_usn, s.s_name, fn_attendance_pct(s.s_id) AS pct, fn_risk_level(s.s_id) AS risk,
       CASE fn_risk_level(s.s_id)
            WHEN 'LOW'    THEN 'Certificate eligible'
            WHEN 'MEDIUM' THEN 'Needs a make-up session'
            ELSE               'Refer to the coordinator' END AS recommendation
FROM   Student s ORDER BY pct LIMIT 15;

-- Q17 Multi-table JOIN : full session record for one day
SELECT g.g_name, a.a_name, sc.room, m.m_name AS mentor, s.s_usn, s.s_name,
       p.status, fn_session_minutes(p.check_in_time, p.check_out_time) AS minutes
FROM   Schedule sc
JOIN   BootstrapGroup g ON g.g_id = sc.g_id
JOIN   Activity       a ON a.a_id = sc.a_id
LEFT JOIN Mentor      m ON m.m_id = a.m_id
JOIN   Student        s ON s.g_id = g.g_id
JOIN   Participates   p ON p.s_id = s.s_id AND p.a_id = a.a_id
WHERE  sc.`day` = 1
ORDER  BY g.g_name, s.s_usn;

-- Q18 FULL-TEXT SEARCH on the feedback comments
SELECT f.f_id, a.a_name, f.rating, f.comments,
       MATCH(f.comments) AGAINST('crowded equipment lab') AS relevance
FROM   Feedback f JOIN Activity a ON a.a_id = f.a_id
WHERE  MATCH(f.comments) AGAINST('crowded equipment lab')
ORDER  BY relevance DESC LIMIT 10;

SELECT f_id, rating, comments FROM Feedback
WHERE  MATCH(comments) AGAINST('+mentor -rushed' IN BOOLEAN MODE) LIMIT 10;

SELECT f_id, rating, comments FROM Feedback
WHERE  MATCH(comments) AGAINST('"soldering practice"' IN BOOLEAN MODE);

SELECT a_id, a_name, MATCH(a_name, description) AGAINST('prototyping lab safety') AS relevance
FROM   Activity WHERE MATCH(a_name, description) AGAINST('prototyping lab safety')
ORDER  BY relevance DESC;

CALL sp_search_feedback('robot chassis build');

-- Q19 Queries on the VIEWS
SELECT * FROM vw_timetable ORDER BY `day`, colour_group;
SELECT * FROM vw_student_attendance WHERE attendance_pct < 80 ORDER BY attendance_pct;
SELECT * FROM vw_activity_stats ORDER BY avg_rating DESC;
SELECT * FROM vw_activity_ranking WHERE rating_rank <= 3;
SELECT * FROM vw_attendance_audit ORDER BY changed_at DESC LIMIT 20;

-- Joining two views together
SELECT va.a_name, va.attendance_pct, va.avg_rating,
       COUNT(DISTINCT vt.colour_group) AS groups_hosted
FROM   vw_activity_stats va JOIN vw_timetable vt ON vt.activity = va.a_name
GROUP  BY va.a_name, va.attendance_pct, va.avg_rating
ORDER  BY va.attendance_pct DESC;

-- Q20 Index usage check (look at the "key" column)
EXPLAIN SELECT * FROM Participates WHERE a_id = 5 AND status = 'absent';
EXPLAIN SELECT * FROM Student WHERE g_id = 2 AND branch = 'Electronics';

-- =====================================================================
-- PART 6 : TRANSACTIONS (COMMIT, ROLLBACK, SAVEPOINT, locking)
-- =====================================================================

-- T1  COMMIT : hire a mentor and assign them an activity together
START TRANSACTION;
INSERT INTO Mentor (m_name, dept, designation, email, phone)
VALUES ('Nisha Verma', 'Design and Innovation', 'Assistant Professor',
        'nisha.verma@univ.edu', '9845010011');
UPDATE Activity SET m_id = LAST_INSERT_ID() WHERE a_name = 'Design Thinking';
COMMIT;
SELECT a.a_name, m.m_name FROM Activity a JOIN Mentor m ON m.m_id = a.m_id
WHERE  a.a_name = 'Design Thinking';

-- T2  ROLLBACK : a mistaken bulk change is undone
START TRANSACTION;
UPDATE Participates SET status = 'excused' WHERE status = 'absent';
SELECT status, COUNT(*) AS inside_txn FROM Participates GROUP BY status;
ROLLBACK;
SELECT status, COUNT(*) AS after_rollback FROM Participates GROUP BY status;

-- T3  SAVEPOINT : partial rollback; the room change survives, the wipe does not
START TRANSACTION;
UPDATE Schedule SET room = 'ANNEXE-1' WHERE `day` = 1 AND g_id = 1;
SAVEPOINT room_changed;
UPDATE Feedback SET rating = 1;
ROLLBACK TO SAVEPOINT room_changed;
COMMIT;
SELECT room FROM Schedule WHERE `day` = 1 AND g_id = 1;
SELECT ROUND(AVG(rating), 2) AS ratings_still_intact FROM Feedback;

-- T4  Row locking + isolation level
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
START TRANSACTION;
SELECT * FROM Schedule WHERE `day` = 2 AND g_id = 2 FOR UPDATE;   -- locks the row
UPDATE Schedule SET start_time = '09:30:00' WHERE `day` = 2 AND g_id = 2;
COMMIT;

-- T5  ROLLBACK inside a procedure : the EXIT HANDLER in sp_enroll_student
--     undoes the student row if anything fails. A duplicate USN forces it.
-- CALL sp_enroll_student('1BM26CS001', 'Duplicate Test', 'dup@univ.edu',
--                        'Computer Science', 1, 1, @fail_id);
SELECT COUNT(*) AS students_after_failed_enrolment FROM Student;
