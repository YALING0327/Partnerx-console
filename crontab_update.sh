#!/usr/bin/env bash
# 唯一的 crontab 安装脚本（生产 source of truth）。
# 取代此前三份互相冲突的定义（旧的 /root/Partnerx-console 与 /var/www/partnerx 路径、
# 无 flock 的裸 npm run sync:selectdb 等）。
#
# 用法：在生产服务器项目目录执行 `bash crontab_update.sh`。
# 可用环境变量覆盖路径：APP_DIR=/var/www/partnerx_xxx bash crontab_update.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/partnerx_bdf8abc}"

if [ ! -d "$APP_DIR/scripts" ]; then
  echo "错误：APP_DIR=$APP_DIR 下找不到 scripts/ 目录，请先设置正确的 APP_DIR。" >&2
  exit 1
fi

cat <<CRON | crontab -
# ===== PartnerX 数据同步（由 crontab_update.sh 生成，请勿手工编辑）=====
# 每 10 分钟增量同步 SelectDB -> Supabase，并修复最近 30 天非成功订单（带 flock/timeout）
*/10 * * * * APP_DIR=$APP_DIR bash $APP_DIR/scripts/run-sync-selectdb-safe.sh
# 每天 04:00 做一次最近 30 天的充值全量对账修复
0 4 * * * APP_DIR=$APP_DIR bash $APP_DIR/scripts/run-recharge-integrity-safe.sh

# ===== LeadPulse 飞书战报（北京时间）=====
CRON_TZ=Asia/Shanghai
# 每天 09:00 播报前一天数据
0 9 * * * APP_DIR=$APP_DIR bash $APP_DIR/scripts/run-leadpulse-report.sh daily
# 每周一 09:05 追加上周（周一~周日）汇总
5 9 * * 1 APP_DIR=$APP_DIR bash $APP_DIR/scripts/run-leadpulse-report.sh weekly
CRON

echo "已安装 crontab（APP_DIR=$APP_DIR）："
crontab -l
