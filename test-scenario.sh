#!/bin/bash
# test-scenario.sh — Run all E2E scenario tests for RentalEscrow
# Usage: ./test-scenario.sh

FORGE="/Users/dmitrijulybin/.foundry/bin/forge"
cd /Users/dmitrijulybin/pi2pi-project/contracts

echo "═══════════════════════════════════════════════════"
echo "  pi2pi RentalEscrow — Full Scenario Test Suite"
echo "═══════════════════════════════════════════════════"
echo ""

# Run all E2E tests with verbose output
$FORGE test --match-test "test_e2e" -vv 2>&1 | grep -E "Step|PASS|FAIL|=====|Suite"

echo ""
echo "═══════════════════════════════════════════════════"

# Run all scenario tests
echo ""
echo "  All Scenario Tests (including non-E2E):"
echo ""
$FORGE test --match-test "test_scenario" -v 2>&1 | grep -E "\[PASS\]|\[FAIL\]"

echo ""
echo "═══════════════════════════════════════════════════"

# Full suite
RESULT=$($FORGE test 2>&1 | tail -1)
echo ""
echo "  Full Suite: $RESULT"
echo ""
echo "═══════════════════════════════════════════════════"
