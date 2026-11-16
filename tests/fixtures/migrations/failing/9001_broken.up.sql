-- Data loss: none (test fixture).
-- Creates a table and then fails, so the runner must roll back the whole migration.
CREATE TABLE migration_fixture_broken (id INT PRIMARY KEY);
THIS IS NOT VALID SQL;
