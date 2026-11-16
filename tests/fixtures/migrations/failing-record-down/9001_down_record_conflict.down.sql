-- Data loss: drops the test fixture table migration_fixture_down_conflict and the tracking table.
-- The SQL itself succeeds, but it drops schema_migrations, so the runner's delete of the record
-- then fails. Only one transaction around both can restore the table.
DROP TABLE migration_fixture_down_conflict;
DROP TABLE schema_migrations;
