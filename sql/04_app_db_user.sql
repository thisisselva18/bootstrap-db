-- =====================================================================
--  CAMPUS BOOTSTRAP : least-privilege MySQL account for the web app
-- =====================================================================
--  Run as root once. Replace the placeholder password, then put the same
--  value in web/.env.local (MYSQL_PASSWORD). Never commit the real password.
--
--  The app gets DML + EXECUTE only: no DDL, no DROP, no GRANT. Stored
--  procedures and triggers run with their DEFINER's rights, so they keep
--  working without giving the app account those privileges directly.
-- =====================================================================

CREATE USER IF NOT EXISTS 'bootstrap_app'@'localhost' IDENTIFIED BY 'CHANGE_ME_TO_A_STRONG_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON bootstrap_db.* TO 'bootstrap_app'@'localhost';
FLUSH PRIVILEGES;

SHOW GRANTS FOR 'bootstrap_app'@'localhost';
