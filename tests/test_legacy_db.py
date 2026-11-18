"""Tests for the isolated Python test-database setup (tests/legacy_db.py, scripts/reset-test-db.ts)."""

import json
import subprocess

import pytest

import legacy_db
from legacy_db import (
    REPO_ROOT,
    RESET_SCRIPT,
    TSX,
    UnsafeDatabaseError,
    child_env,
    require_test_database,
    reset_test_database,
    resolve_test_database_url,
    run_script,
    run_sql,
)

DEV_URL = "postgresql://postgres:postgres@localhost:5432/butik"
TEST_URL = "postgresql://postgres:postgres@localhost:5432/butik_test"


def test_guard_rejects_the_dev_database():
    with pytest.raises(UnsafeDatabaseError, match="_test"):
        require_test_database(DEV_URL)


def test_guard_accepts_the_test_database():
    require_test_database(TEST_URL)


# The guard must check the database libpq would actually use, not the end of the URL text.
@pytest.mark.parametrize(
    "url",
    [
        # libpq lets a ?dbname= query parameter override the path.
        "postgresql://postgres:postgres@localhost:5432/butik_test?dbname=butik",
        # The text ends in _test, but the database is butik.
        "postgresql://postgres:postgres@localhost:5432/butik?application_name=x_test",
        "host=localhost dbname=butik application_name=a_test",
        # No database name: libpq would fall back to PGDATABASE or the user name.
        "postgresql://postgres:postgres@localhost:5432/",
        # A name that is only the suffix.
        "postgresql://postgres:postgres@localhost:5432/_test",
        # Not a connection string at all.
        "not a conninfo_test",
    ],
)
def test_guard_rejects_urls_whose_effective_database_is_not_a_test_database(url):
    with pytest.raises(UnsafeDatabaseError, match="_test"):
        require_test_database(url)


def test_test_url_defaults_to_butik_test_and_ignores_database_url(monkeypatch):
    monkeypatch.delenv("TEST_DATABASE_URL", raising=False)
    monkeypatch.setenv("DATABASE_URL", DEV_URL)

    assert resolve_test_database_url() == TEST_URL


# Nothing listens on port 1, so a connection attempt fails with ECONNREFUSED.
UNREACHABLE = "postgresql://postgres:postgres@127.0.0.1:1"
PRINT_DB_ENV = REPO_ROOT / "tests" / "fixtures" / "print_db_env.py"


def run_reset_script(database_settings):
    """Run the reset script directly, bypassing the Python guard, to test the script's own guard."""
    return subprocess.run(
        [str(TSX), str(RESET_SCRIPT)],
        cwd=REPO_ROOT,
        env=child_env(**database_settings),
        capture_output=True,
        text=True,
        timeout=60,
    )


@pytest.mark.parametrize(
    "url",
    [
        f"{UNREACHABLE}/butik",
        # No database name: pg falls back to the user name ("postgres").
        f"{UNREACHABLE}/",
    ],
)
def test_reset_script_refuses_a_non_test_database_before_connecting(url):
    result = run_reset_script({"TEST_DATABASE_URL": url})

    assert result.returncode != 0
    assert "must end in _test" in result.stderr
    assert "ECONNREFUSED" not in result.stderr


def test_reset_script_requires_test_database_url_and_ignores_database_url():
    result = run_reset_script({"DATABASE_URL": f"{UNREACHABLE}/butik"})

    assert result.returncode != 0
    assert "TEST_DATABASE_URL is not set" in result.stderr
    assert "ECONNREFUSED" not in result.stderr


def test_reset_restores_seed_data():
    count_lines = "SELECT COUNT(*) FROM order_lines WHERE order_id = %s"
    count_stray = "SELECT COUNT(*) FROM discounts WHERE code = %s"
    run_sql("DELETE FROM order_lines WHERE order_id = %s", (1042,))
    run_sql("INSERT INTO discounts (code, percent) VALUES (%s, %s)", ("STRAY", 5))
    # Preconditions: both changes were committed, so the reset has something to undo.
    assert run_sql(count_lines, (1042,)) == [(0,)]
    assert run_sql(count_stray, ("STRAY",)) == [(1,)]

    reset_test_database()

    # db/seed.sql gives order 1042 two lines and has no STRAY discount.
    assert run_sql(count_lines, (1042,)) == [(2,)]
    assert run_sql(count_stray, ("STRAY",)) == [(0,)]


# The Python layer checks the database itself, before any subprocess or connection. The URL is
# unreachable, so any other error type would mean a connection or subprocess was attempted.
@pytest.mark.parametrize(
    "helper",
    [
        reset_test_database,
        lambda: run_sql("SELECT 1"),
        lambda: run_script(PRINT_DB_ENV),
    ],
    ids=["reset_test_database", "run_sql", "run_script"],
)
def test_helpers_refuse_a_non_test_database_before_connecting(monkeypatch, helper):
    monkeypatch.setenv("TEST_DATABASE_URL", f"{UNREACHABLE}/butik")

    with pytest.raises(UnsafeDatabaseError, match="_test"):
        helper()


def test_run_script_passes_the_test_url_and_no_inherited_database_settings(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", DEV_URL)
    monkeypatch.setenv("PGDATABASE", "butik")
    monkeypatch.setenv("PGHOST", "elsewhere.example")

    returncode, stdout, stderr = run_script(PRINT_DB_ENV)

    assert (returncode, stderr) == (0, "")
    assert json.loads(stdout) == {"DATABASE_URL": resolve_test_database_url(), "pg_vars": []}


def test_reset_passes_only_the_test_url_and_no_inherited_database_settings(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", DEV_URL)
    monkeypatch.setenv("PGHOST", "elsewhere.example")
    calls = []
    # This replaces subprocess.run for the whole process (legacy_db.subprocess is the shared
    # module). That is safe because the autouse reset has already run before the test body, and
    # monkeypatch restores the real function at teardown, before the next test's reset.
    monkeypatch.setattr(
        legacy_db.subprocess, "run", lambda args, **kwargs: calls.append(kwargs["env"])
    )

    reset_test_database()

    [env] = calls
    assert env["TEST_DATABASE_URL"] == resolve_test_database_url()
    assert "DATABASE_URL" not in env
    assert [name for name in env if name.startswith("PG")] == []
