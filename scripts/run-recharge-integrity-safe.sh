#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/partnerx_bdf8abc}"
LOG_FILE="${LOG_FILE:-$APP_DIR/recharge-integrity.log}"
LOCK_FILE="${LOCK_FILE:-/tmp/partnerx-recharge-integrity.lock}"
REPAIR_TIMEOUT_SECONDS="${REPAIR_TIMEOUT_SECONDS:-3600}"
REPAIR_DAYS="${REPAIR_DAYS:-30}"

mkdir -p "$(dirname "$LOG_FILE")"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  printf "%s skip recharge integrity: previous run is still active\n" "$(date '+%F %T')" >> "$LOG_FILE"
  exit 0
fi

cd "$APP_DIR"

export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=512}"

set +e
/usr/bin/timeout "$REPAIR_TIMEOUT_SECONDS" /usr/bin/nice -n 10 node scripts/repair-recent-recharge-anomalies.mjs --mode full --days "$REPAIR_DAYS" >> "$LOG_FILE" 2>&1
code=$?
set -e

if [ "$code" -eq 124 ]; then
  printf "%s recharge integrity timeout after %ss\n" "$(date '+%F %T')" "$REPAIR_TIMEOUT_SECONDS" >> "$LOG_FILE"
  exit 0
fi

if [ "$code" -ne 0 ]; then
  printf "%s recharge integrity failed with code %s\n" "$(date '+%F %T')" "$code" >> "$LOG_FILE"
  exit "$code"
fi
