"""Characterization tests for the legacy CLI src/legacy/price_calc.py (plan steps 2 and 3).

These tests pin what the module does today, including output that does not follow
docs/standard.md (for example "950" instead of "950.00"). The expected values were captured by
running the module against the freshly reset test database. They must pass against the
unchanged module; see "Characterization Tests versus TDD Tests" in
docs/plans/legacy-price-calc-modernization.md.

The module is run as a subprocess through its CLI, exactly as src/pricing/legacyPrice.ts runs it.
"""

import datetime

import pytest

from legacy_db import REPO_ROOT, run_script, run_sql

PRICE_CALC = REPO_ROOT / "src" / "legacy" / "price_calc.py"
PRICE_LOG = REPO_ROOT / "src" / "legacy" / "price_calc.log"

# Captured stdout for each seed order in db/seed.sql. print() adds the trailing newline.
SEED_ORDER_OUTPUT = {
    1040: '{"net": "899", "vat": "224.75", "total": "1123.75"}\n',
    # SOMMAR20 (20 %).
    1041: '{"net": "588.8", "vat": "147.2", "total": "736.0"}\n',
    1042: '{"net": "950", "vat": "237.5", "total": "1187.5"}\n',
    # No order lines.
    1043: '{"net": "0", "vat": "0", "total": "0"}\n',
    # VAR10 (10 %). VAT 44.9775 is truncated to 44.97, not rounded.
    1044: '{"net": "179.91", "vat": "44.97", "total": "224.88"}\n',
    # GAMMAL15 (15 %) applies although it expired in 2024.
    1045: '{"net": "551.65", "vat": "137.91", "total": "689.56"}\n',
    # Cancelled order: status is ignored, so it is priced like 1040.
    1046: '{"net": "899", "vat": "224.75", "total": "1123.75"}\n',
    1047: '{"net": "529", "vat": "132.25", "total": "661.25"}\n',
}


@pytest.mark.parametrize(
    ("order_id", "expected_stdout"),
    SEED_ORDER_OUTPUT.items(),
    ids=[f"order-{order_id}" for order_id in SEED_ORDER_OUTPUT],
)
def test_prints_the_price_of_a_seed_order(order_id, expected_stdout):
    assert run_script(PRICE_CALC, order_id) == (0, expected_stdout, "")


def test_reports_a_missing_order_and_exits_with_1():
    assert run_script(PRICE_CALC, 999999) == (1, '{"error": "finns inte"}\n', "")


def test_exits_non_zero_for_a_non_integer_order_id():
    # Only the exit code is pinned, not the traceback text (plan step 2). The seed-order tests in
    # this file show that the database connection works, so a connection failure is not what
    # makes this test pass.
    returncode, stdout, _ = run_script(PRICE_CALC, "abc")

    assert returncode != 0
    assert stdout == ""


# --- Step 3: edge cases on fixtures inserted into the test database -----------------------------

# Fixture order ids are far from the seed ids (1040-1047).


def create_discount(code, percent, valid_from=None, valid_to=None):
    run_sql(
        "INSERT INTO discounts (code, percent, valid_from, valid_to) VALUES (%s, %s, %s, %s)",
        (code, percent, valid_from, valid_to),
    )


def create_order(order_id, lines, discount_code=None):
    """Insert an order and then its (quantity, unit_price) lines."""
    run_sql(
        "INSERT INTO orders (id, customer_id, discount_code) VALUES (%s, %s, %s)",
        (order_id, 1, discount_code),
    )
    for quantity, unit_price in lines:
        run_sql(
            "INSERT INTO order_lines (order_id, product, quantity, unit_price)"
            " VALUES (%s, %s, %s, %s)",
            (order_id, "Fixture", quantity, unit_price),
        )


def test_an_unknown_discount_code_is_ignored():
    # Pins current behavior, see ADR 0003 decision 7.
    create_order(3001, [(1, "100.00")], discount_code="NOSUCH")

    assert run_script(PRICE_CALC, 3001) == (0, '{"net": "100", "vat": "25", "total": "125"}\n', "")


def test_a_zero_percent_discount_changes_nothing():
    create_discount("ZERO", 0)
    create_order(3002, [(1, "100.00")], discount_code="ZERO")

    assert run_script(PRICE_CALC, 3002) == (0, '{"net": "100", "vat": "25", "total": "125"}\n', "")


def test_a_hundred_percent_discount_makes_the_order_free():
    create_discount("ALL", 100)
    create_order(3003, [(1, "100.00")], discount_code="ALL")

    assert run_script(PRICE_CALC, 3003) == (0, '{"net": "0", "vat": "0", "total": "0"}\n', "")


def test_a_discount_over_a_hundred_percent_gives_negative_amounts():
    # Pins current behavior, see ADR 0003 decision 7.
    create_discount("OVER", 150)
    create_order(3004, [(1, "100.00")], discount_code="OVER")

    assert run_script(PRICE_CALC, 3004) == (
        0,
        '{"net": "-50", "vat": "-12.5", "total": "-62.5"}\n',
        "",
    )


def test_an_expired_discount_code_still_applies():
    # Pins current behavior, see ADR 0003 decision 7.
    create_discount("OLD2020", 10, valid_from="2020-01-01", valid_to="2020-12-31")
    create_order(3005, [(1, "100.00")], discount_code="OLD2020")

    assert run_script(PRICE_CALC, 3005) == (0, '{"net": "90", "vat": "22.5", "total": "112.5"}\n', "")


def test_vat_is_truncated_not_rounded():
    # VAT is 10.03 * 25 / 100 = 2.5075. Truncation gives 2.50 ("2.5"); rounding would give 2.51.
    create_order(3006, [(1, "10.03")])

    assert run_script(PRICE_CALC, 3006) == (
        0,
        '{"net": "10.03", "vat": "2.5", "total": "12.53"}\n',
        "",
    )


def test_large_amounts_over_several_lines_stay_exact():
    # Each line is the NUMERIC(10,2) maximum. The sum is larger than the column type allows,
    # but it is calculated in Python Decimal, not stored.
    create_order(3007, [(1, "99999999.99")] * 3)

    assert run_script(PRICE_CALC, 3007) == (
        0,
        '{"net": "299999999.97", "vat": "74999999.99", "total": "374999999.96"}\n',
        "",
    )


def test_a_zero_quantity_line_costs_nothing():
    create_order(3008, [(0, "50.00")])

    assert run_script(PRICE_CALC, 3008) == (0, '{"net": "0", "vat": "0", "total": "0"}\n', "")


def test_a_successful_calculation_appends_one_log_line():
    before = PRICE_LOG.read_text() if PRICE_LOG.exists() else ""

    run_script(PRICE_CALC, 1042)

    after = PRICE_LOG.read_text()
    assert after.startswith(before)
    [new_line] = after[len(before) :].splitlines()
    timestamp, order_id, total = new_line.split(" ")
    datetime.datetime.fromisoformat(timestamp)  # raises if it is not an ISO timestamp
    assert (order_id, total) == ("1042", "1187.5")
