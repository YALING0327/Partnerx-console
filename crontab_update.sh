#!/bin/bash
# 这个脚本将替换VPS上的crontab
echo "*/10 * * * * cd /root/Partnerx-console && git pull origin main && SELECTDB_BATCH_SIZE=2000 /usr/bin/env npm run sync:selectdb >> /root/Partnerx-console/sync-selectdb.log 2>&1" | crontab -
crontab -l
