#!/bin/bash
# 这个脚本将替换VPS上的crontab
cat <<'EOF' | crontab -
*/10 * * * * cd /root/Partnerx-console && git pull origin main && SELECTDB_BATCH_SIZE=2000 /usr/bin/env npm run sync:selectdb >> /root/Partnerx-console/sync-selectdb.log 2>&1
15 * * * * cd /root/Partnerx-console && /usr/bin/env npm run reconcile:attribution -- --diff-only >> /root/Partnerx-console/reconcile-attribution.log 2>&1
EOF
crontab -l
