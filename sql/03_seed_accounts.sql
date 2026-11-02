-- =====================================================================
--  CAMPUS BOOTSTRAP : demo login accounts
-- =====================================================================
--  Run AFTER 02_app_extensions.sql. Only bcrypt hashes are stored; the demo
--  passwords below exist for the classroom demonstration and must be changed
--  (Account page, or `npm run hash-password`) on any shared deployment.
--
--      role     username                      password
--      admin    admin@univ.edu                Admin@123
--      mentor   <mentor email>                Mentor@123
--      student  <student email>               Student@123
-- =====================================================================

USE bootstrap_db;

DELETE FROM AppUser;

INSERT INTO AppUser (username, password_hash, role) VALUES
('admin@univ.edu', '$2b$10$5o5p5F0mFnHz301f3RkfkeMgw8r9AnMLCey7Z8tjuxLFmJCxxq5cq', 'admin');

INSERT INTO AppUser (username, password_hash, role, m_id)
SELECT email, '$2b$10$4p7kbxT8Hi0iAh27Cdh.KuCJuWXAsaQKSlTIYRmz8Z0RSyYP4hNA.', 'mentor', m_id
FROM   Mentor;

INSERT INTO AppUser (username, password_hash, role, s_id)
SELECT email, '$2b$10$e5TGef/WEEtC9/q.pg2YEezhLBPL8D38OZj3rgTBwPQsXucW69jF6', 'student', s_id
FROM   Student;

SELECT role, COUNT(*) AS accounts FROM AppUser GROUP BY role;
