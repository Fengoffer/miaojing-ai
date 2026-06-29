#!/bin/bash
set -Eeuo pipefail

fail=0

search_pattern() {
  local pattern="$1"
  shift

  if command -v rg >/dev/null 2>&1; then
    rg -n "$pattern" "$@" || true
  else
    grep -RInE "$pattern" "$@" || true
  fi
}

check_no_match() {
  local label="$1"
  local pattern="$2"
  shift 2
  local output

  output="$(search_pattern "$pattern" "$@")"
  if [ -n "$output" ]; then
    echo "Boundary violation: ${label}" >&2
    echo "$output" >&2
    fail=1
  fi
}

check_no_match \
  "web module must not import server database/storage internals" \
  "@/storage|@/lib/local-storage|@/lib/session-auth|@/lib/admin-auth|@/lib/runtime-env|@/lib/server-crypto" \
  src/modules/web

check_no_match \
  "console module must not import server database/storage internals directly" \
  "@/storage|@/lib/local-storage|@/lib/runtime-env|@/lib/server-crypto" \
  src/modules/console

check_no_match \
  "shared module must not depend on app-specific modules" \
  "@/modules/(web|console|api)|@/app/|@/components/admin" \
  src/modules/shared

if [ "$fail" -ne 0 ]; then
  exit 1
fi

echo "Module boundaries OK"
