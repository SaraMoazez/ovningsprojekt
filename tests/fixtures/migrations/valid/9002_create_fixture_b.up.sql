-- Data loss: none (test fixture).
-- References migration_fixture_a, so it only succeeds if 9001 ran first.
CREATE TABLE migration_fixture_b (id INT PRIMARY KEY, a_id INT REFERENCES migration_fixture_a (id));
