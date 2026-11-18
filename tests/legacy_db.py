"""Helpers that let Python tests use the test database, and never any other database."""

import os
import subprocess
import sys
from pathlib import Path

import psycopg
from psycopg import ProgrammingError
from psycopg.conninfo import conninfo_to_dict

TEST_SUFFIX = "_test"
# Same default as tests/helpers/env.ts: the local Docker test database.
DEFAULT_TEST_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/butik_test"

REPO_ROOT = Path(__file__).resolve().parent.parent
TSX = REPO_ROOT / "node_modules" / ".bin" / "tsx"
RESET_SCRIPT = REPO_ROOT / "scripts" / "reset-test-db.ts"


def resolve_test_database_url():
    """Return TEST_DATABASE_URL, or the local default. DATABASE_URL is never read."""
    return os.environ.get("TEST_DATABASE_URL", DEFAULT_TEST_DATABASE_URL)


class UnsafeDatabaseError(RuntimeError):
    """Raised when a URL does not point at a database whose name ends in "_test"."""


def require_test_database(url):
    """Raise UnsafeDatabaseError unless libpq would connect to a database named "<name>_test".

    The name is read with libpq's own parser, because a query parameter such as ?dbname=
    overrides the path. A URL without a database name is rejected, because libpq would then
    fall back to PGDATABASE or the user name.
    """
    try:
        name = conninfo_to_dict(url).get("dbname") or ""
    except ProgrammingError:
        name = ""
    if len(name) <= len(TEST_SUFFIX) or not name.endswith(TEST_SUFFIX):
        raise UnsafeDatabaseError(
            f"Refusing to use database {name!r}: its name must end in {TEST_SUFFIX}."
        )


def guarded_test_database_url():
    """Return the test database URL, after checking that it is a test database."""
    url = resolve_test_database_url()
    require_test_database(url)
    return url


def child_env(**database_settings):
    """Copy the environment without any inherited database settings, then add the given ones.

    Every PG* variable, DATABASE_URL and TEST_DATABASE_URL are removed, so nothing inherited can
    redirect a child process to another database.
    """
    env = {
        name: value
        for name, value in os.environ.items()
        if not name.startswith("PG") and name not in ("DATABASE_URL", "TEST_DATABASE_URL")
    }
    env.update(database_settings)
    return env


def reset_test_database():
    """Reset the test database to schema + migrations + seed data via scripts/reset-test-db.ts."""
    env = child_env(TEST_DATABASE_URL=guarded_test_database_url())
    subprocess.run([str(TSX), str(RESET_SCRIPT)], cwd=REPO_ROOT, env=env, check=True, timeout=60)


def run_script(path, *args):
    """Run a Python script with this interpreter against the test database.

    The child gets only DATABASE_URL (the guarded test URL) as database setting.
    Returns (returncode, stdout, stderr).
    """
    result = subprocess.run(
        [sys.executable, str(path), *map(str, args)],
        cwd=REPO_ROOT,
        env=child_env(DATABASE_URL=guarded_test_database_url()),
        capture_output=True,
        text=True,
        timeout=60,
    )
    return result.returncode, result.stdout, result.stderr


def run_sql(sql, params=()):
    """Run one parameterized statement on the test database and return its rows (or [])."""
    with psycopg.connect(guarded_test_database_url(), autocommit=True) as conn:
        cur = conn.execute(sql, params)
        return cur.fetchall() if cur.description else []
