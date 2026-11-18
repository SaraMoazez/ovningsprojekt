"""Fixture for tests/test_legacy_db.py: prints the database-related environment it received."""

import json
import os
import sys

json.dump(
    {
        "DATABASE_URL": os.environ["DATABASE_URL"],
        "pg_vars": sorted(name for name in os.environ if name.startswith("PG")),
    },
    sys.stdout,
)
