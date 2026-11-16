-- Data loss: none (test fixture).
-- The SQL itself succeeds, but it records its own version, so the runner's insert into
-- schema_migrations then fails. Only one transaction around both can roll back the table.
CREATE TABLE migration_fixture_record_conflict (id INT PRIMARY KEY);
INSERT INTO schema_migrations (version) VALUES ('9001');
