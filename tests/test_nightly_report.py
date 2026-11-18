"""Characterization tests for the nightly report jobs/nightly_report.py (plan step 4).

The report sums the totals of the paid orders created on a given date. These tests pin its exact
stdout, captured by running it against the freshly reset test database. They must pass against
the unchanged job; see "Characterization Tests versus TDD Tests" in
docs/plans/legacy-price-calc-modernization.md.

created_at::date uses the database session's time zone (UTC in the test database). All times
below are at midday, so the UTC date and the local (+02) date are the same.
"""

from legacy_db import REPO_ROOT, create_order, run_script

NIGHTLY_REPORT = REPO_ROOT / "jobs" / "nightly_report.py"


def test_reports_the_one_paid_seed_order_of_a_day():
    # Seed order 1042 (paid, 2026-10-01) has the total 1187.5.
    assert run_script(NIGHTLY_REPORT, "2026-10-01") == (
        0,
        "2026-10-01: 1 betalda ordrar, totalt 1187.5 kr\n",
        "",
    )


def test_reports_a_paid_seed_order_with_a_discount():
    # Seed order 1044 (paid, 2026-10-05, VAR10) has the total 224.88.
    assert run_script(NIGHTLY_REPORT, "2026-10-05") == (
        0,
        "2026-10-05: 1 betalda ordrar, totalt 224.88 kr\n",
        "",
    )


def test_sums_several_paid_orders_and_skips_unpaid_ones():
    day = "2026-10-20"
    create_order(3101, [(1, "100.00")], status="paid", created_at=f"{day} 10:00+02")  # 125
    create_order(3102, [(2, "10.03")], status="paid", created_at=f"{day} 14:30+02")  # 25.07
    create_order(3103, [(1, "500.00")], status="new", created_at=f"{day} 12:00+02")  # not paid

    assert run_script(NIGHTLY_REPORT, "2026-10-20") == (
        0,
        "2026-10-20: 2 betalda ordrar, totalt 150.07 kr\n",
        "",
    )


def test_reports_zero_for_a_day_without_paid_orders():
    # The sum starts as the int 0, so it prints "0", not a Decimal.
    assert run_script(NIGHTLY_REPORT, "2026-10-02") == (
        0,
        "2026-10-02: 0 betalda ordrar, totalt 0 kr\n",
        "",
    )
