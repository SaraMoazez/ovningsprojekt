"""Shared pytest setup: every Python test starts from a freshly reset test database."""

import pytest

from legacy_db import reset_test_database


@pytest.fixture(autouse=True)
def reset_test_db():
    """Reset the test database before each test (docs/standard.md, Tests).

    reset_test_database() checks that the target is a *_test database before doing anything.
    """
    reset_test_database()
