#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/partnerx_bdf8abc}"
LOG_FILE="${LOG_FILE:-$APP_DIR/sync-selectdb.log}"
LOCK_FILE="${LOCK_FILE:-/tmp/partnerx-sync-selectdb.lock}"
SYNC_TIMEOUT_SECONDS="${SYNC_TIMEOUT_SECONDS:-1200}"
SYNC_BATCH_SIZE="${SYNC_BATCH_SIZE:-200}"
RECENT_DAYS="${RECENT_DAYS:-30}"
REPAIR_TIMEOUT_SECONDS="${REPAIR_TIMEOUT_SECONDS:-480}"

mkdir -p "$(dirname "$LOG_FILE")"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  printf "%s skip sync: previous run is still active\n" "$(date '+%F %T')" >> "$LOG_FILE"
  exit 0
fi

cd "$APP_DIR"

export SELECTDB_BATCH_SIZE="$SYNC_BATCH_SIZE"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=512}"

set +e
/usr/bin/timeout "$SYNC_TIMEOUT_SECONDS" /usr/bin/nice -n 10 /usr/bin/npm run sync:selectdb >> "$LOG_FILE" 2>&1
sync_code=$?
set -e

if [ "$sync_code" -eq 124 ]; then
  printf "%s sync timeout after %ss\n" "$(date '+%F %T')" "$SYNC_TIMEOUT_SECONDS" >> "$LOG_FILE"
  exit 0
fi

if [ "$sync_code" -ne 0 ]; then
  printf "%s sync failed with code %s\n" "$(date '+%F %T')" "$sync_code" >> "$LOG_FILE"
  exit "$sync_code"
fi

set +e
/usr/bin/timeout "$REPAIR_TIMEOUT_SECONDS" /usr/bin/nice -n 10 node scripts/repair-recent-recharge-anomalies.mjs --mode non-success --days "$RECENT_DAYS" >> "$LOG_FILE" 2>&1
repair_code=$?
set -e

if [ "$repair_code" -eq 124 ]; then
  printf "%s recent recharge repair timeout after %ss\n" "$(date '+%F %T')" "$REPAIR_TIMEOUT_SECONDS" >> "$LOG_FILE"
  exit 0
fi

if [ "$repair_code" -ne 0 ]; then
  printf "%s recent recharge repair failed with code %s\n" "$(date '+%F %T')" "$repair_code" >> "$LOG_FILE"
  exit "$repair_code"
fi
