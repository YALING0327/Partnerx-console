#!/usr/bin/env bash
# 触发 LeadPulse 飞书战报（daily=前一天，weekly=上周一~周日）。
# 用法：run-leadpulse-report.sh <daily|weekly>
# 依赖：APP_DIR/.env.local 中的 REPORT_TRIGGER_SECRET；应用监听 REPORT_BASE_URL。
set -euo pipefail

MODE="${1:-daily}"
APP_DIR="${APP_DIR:-/var/www/partnerx_bdf8abc}"
REPORT_BASE_URL="${REPORT_BASE_URL:-http://127.0.0.1:3001}"
LOG_FILE="${LOG_FILE:-$APP_DIR/leadpulse-report.log}"

mkdir -p "$(dirname "$LOG_FILE")"

if [ -f "$APP_DIR/.env.local" ]; then
  # 只提取需要的变量，避免 source 整个 .env.local（文件里含带括号的 SQL，source 会报语法错误）
  _env_val() {
    { grep -E "^$1=" "$APP_DIR/.env.local" | tail -n 1 | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//'; } || true
  }
  REPORT_TRIGGER_SECRET="${REPORT_TRIGGER_SECRET:-$(_env_val REPORT_TRIGGER_SECRET)}"
  _base_url="$(_env_val REPORT_BASE_URL)"
  [ -n "$_base_url" ] && REPORT_BASE_URL="$_base_url"
fi

if [ -z "${REPORT_TRIGGER_SECRET:-}" ]; then
  printf "%s [%s] 缺少 REPORT_TRIGGER_SECRET，跳过\n" "$(date '+%F %T')" "$MODE" >> "$LOG_FILE"
  exit 0
fi

URL="$REPORT_BASE_URL/api/reports/leadpulse?mode=$MODE&token=$REPORT_TRIGGER_SECRET"
printf "%s [%s] 触发战报...\n" "$(date '+%F %T')" "$MODE" >> "$LOG_FILE"
HTTP_BODY=$(curl -sS --max-time 120 "$URL" 2>>"$LOG_FILE" || true)
printf "%s [%s] 结果: %s\n" "$(date '+%F %T')" "$MODE" "$HTTP_BODY" >> "$LOG_FILE"
