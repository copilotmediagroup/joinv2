#!/usr/bin/env bash

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

export GIT_PAGER=cat
export PAGER=cat

pass() {
  printf 'PASS: %s\n' "$1"
}

fail() {
  printf 'FAIL: %s\n' "$1"
  return 1
}

header() {
  printf '\n===== %s =====\n' "$1"
}

show_head() {
  header "HEAD"
  git log -1 --oneline
}

show_status() {
  header "GIT STATUS"
  git status --short

  header "TRACKED DIFF"
  git diff --name-only

  header "STAGED DIFF"
  git diff --cached --name-only

  header "UNTRACKED"
  git ls-files --others --exclude-standard | sort
}

check_no_tracked_diff() {
  if git diff --quiet; then
    pass "NO_TRACKED_DIFF"
  else
    fail "NO_TRACKED_DIFF"
    return 1
  fi
}

check_no_staged_diff() {
  if git diff --cached --quiet; then
    pass "NO_STAGED_DIFF"
  else
    fail "NO_STAGED_DIFF"
    return 1
  fi
}

check_build() {
  header "BUILD"

  npm run build
  BUILD_EXIT=$?

  echo
  echo "BUILD_EXIT_CODE=$BUILD_EXIT"

  if [ "$BUILD_EXIT" -eq 0 ]; then
    pass "BUILD_GREEN"
    return 0
  fi

  fail "BUILD_GREEN"
  return 1
}

check_e6_untracked_set() {
  header "E6 EXPECTED UNTRACKED SET"

  ACTUAL_UNTRACKED="$(
    git ls-files --others --exclude-standard |
      grep -v '^scripts/signal-gate\.sh$' |
      sort
  )"

  EXPECTED_UNTRACKED="$(
    printf '%s\n' \
      'src/features/signal/realtime/contract.ts' \
      'src/features/signal/realtime/signalRealtime.ts' \
      'src/features/signal/realtime/useSignalRealtime.ts' \
      'src/lib/supabaseClient.ts' \
      'supabase/migrations/0007_signal_activity_policy_authority.sql' |
      sort
  )"

  echo "----- ACTUAL -----"
  printf '%s\n' "$ACTUAL_UNTRACKED"

  echo
  echo "----- EXPECTED -----"
  printf '%s\n' "$EXPECTED_UNTRACKED"

  echo

  if [ "$ACTUAL_UNTRACKED" = "$EXPECTED_UNTRACKED" ]; then
    pass "EXPECTED_UNTRACKED_SET"
    return 0
  fi

  fail "EXPECTED_UNTRACKED_SET"
  return 1
}

check_0007() {
  header "0007 CONTRACT"

  FILE="supabase/migrations/0007_signal_activity_policy_authority.sql"

  if [ ! -f "$FILE" ]; then
    fail "0007_EXISTS"
    return 1
  fi

  pass "0007_EXISTS"

  echo
  shasum -a 256 "$FILE"

  FAILURES=0

  if grep -F \
    "create table public.grouping_policy_families" \
    "$FILE" >/dev/null
  then
    pass "POLICY_FAMILY_TABLE"
  else
    fail "POLICY_FAMILY_TABLE"
    FAILURES=$((FAILURES + 1))
  fi

  if grep -F \
    "grouping_policy_code" \
    "$FILE" >/dev/null
  then
    pass "ACTIVITY_POLICY_CODE"
  else
    fail "ACTIVITY_POLICY_CODE"
    FAILURES=$((FAILURES + 1))
  fi

if grep -Eq \
    "\\('nightlife',[[:space:]]*1,[[:space:]]*5,[[:space:]]*6,[[:space:]]*8,[[:space:]]*true\\)" \
    "$FILE"
then
  pass "NIGHTLIFE_5_6_8"
else
  fail "NIGHTLIFE_5_6_8"
  FAILURES=$((FAILURES + 1))
fi

if grep -Eq \
    "\\('creative',[[:space:]]*'fun'\\)" \
    "$FILE"
then
  pass "CREATIVE_TO_FUN"
else
  fail "CREATIVE_TO_FUN"
  FAILURES=$((FAILURES + 1))
fi

  if grep -Eiq \
    'alter[[:space:]]+table[[:space:]]+public\.activities.*grouping_policy_id' \
    "$FILE"
  then
    fail "ACTIVITY_NOT_PINNED_TO_POLICY_VERSION"
    FAILURES=$((FAILURES + 1))
  else
    pass "ACTIVITY_NOT_PINNED_TO_POLICY_VERSION"
  fi

  if grep -Eiq \
    'update[[:space:]]+public\.signal_groups|delete[[:space:]]+from[[:space:]]+public\.signal_groups' \
    "$FILE"
  then
    fail "SIGNAL_GROUP_HISTORY_UNTOUCHED"
    FAILURES=$((FAILURES + 1))
  else
    pass "SIGNAL_GROUP_HISTORY_UNTOUCHED"
  fi

  if [ "$FAILURES" -eq 0 ]; then
    pass "0007_CONTRACT"
    return 0
  fi

  fail "0007_CONTRACT"
  return 1
}

doctor() {
  header "SIGNAL GATE RUNNER — DOCTOR"

  echo "ROOT=$ROOT"
  echo "RUNNER=$ROOT/scripts/signal-gate.sh"

  echo

  if [ -d ".git" ]; then
    pass "REPOSITORY_ROOT"
  else
    fail "REPOSITORY_ROOT"
    return 1
  fi

  command -v git >/dev/null 2>&1 &&
    pass "GIT_AVAILABLE" ||
    {
      fail "GIT_AVAILABLE"
      return 1
    }

  command -v node >/dev/null 2>&1 &&
    pass "NODE_AVAILABLE" ||
    {
      fail "NODE_AVAILABLE"
      return 1
    }

  command -v npm >/dev/null 2>&1 &&
    pass "NPM_AVAILABLE" ||
    {
      fail "NPM_AVAILABLE"
      return 1
    }

  echo
  echo "NODE=$(node --version)"
  echo "NPM=$(npm --version)"

  show_head
  show_status

  echo
  pass "RUNNER_DOCTOR"
}

e6_preflight() {
  header "G4.17-E6 PRE-CHECKPOINT VERIFICATION"

  FAILURES=0

  show_head
  show_status

  check_0007 || FAILURES=$((FAILURES + 1))
  check_no_tracked_diff || FAILURES=$((FAILURES + 1))
  check_no_staged_diff || FAILURES=$((FAILURES + 1))
  check_e6_untracked_set || FAILURES=$((FAILURES + 1))
  check_build || FAILURES=$((FAILURES + 1))

  header "FINAL E6 PREFLIGHT CLASSIFIER"

  if [ "$FAILURES" -eq 0 ]; then
    echo "G4.17-E6_PREFLIGHT_GATE=PASS"
    echo "G4.17-E6_PREFLIGHT_COMPLETE"
    return 0
  fi

  echo "G4.17-E6_PREFLIGHT_GATE=FAIL"
  echo "FAILURE_COUNT=$FAILURES"
  echo "G4.17-E6_PREFLIGHT_COMPLETE"
  return 1
}

usage() {
  cat <<'USAGE'
SIGNAL Gate Runner

Usage:
  ./scripts/signal-gate.sh doctor
  ./scripts/signal-gate.sh e6-preflight

Current safety level:
  READ-ONLY / VERIFICATION ONLY

This runner currently does NOT:
  - stage files
  - commit files
  - modify product code
  - execute SQL
  - access Supabase secrets
  - apply migrations
USAGE
}

COMMAND="${1:-}"

case "$COMMAND" in
  doctor)
    doctor
    ;;
  e6-preflight)
    e6_preflight
    ;;
  *)
    usage
    exit 2
    ;;
esac
