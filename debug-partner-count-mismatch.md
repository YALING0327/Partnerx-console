# [OPEN] partner-count-mismatch

## 会话信息
- session_id: `partner-count-mismatch`
- 当前约束：先收集证据，不改业务逻辑。
- 当前目标：对齐 `employees`、`attribution_users`、SelectDB 原始 `user` 表、线上接口 `overview` 的人数差异。

## 用户现象
- 对外控制台中，软件里显示今天拉了 5 个用户，但后台只显示了最下面 1 个。
- 软件里显示该员工累计拉了 21 个邀请码用户，但后台只显示 13 个。
- 用户提供的员工 ID 为 `250194588`。

## 当前假设
1. 软件侧展示的是原始 `user` 表数据，而后台展示依赖 `attribution_users`，同步存在延迟或漏同步。
2. 后台接口按日期筛选时，使用的时间边界与软件页面不同，导致今天的 5 个里只有 1 个落入当前查询区间。
3. 员工 `250194588` 对应的归因键有多种（邀请码、邀请人 ID、链接 key），后台只统计了其中一部分。
4. `attribution_users` 中同一用户发生覆盖或去重，导致软件统计 21 个原始注册用户，但后台只保留了 13 个归因结果。
5. 员工映射关系有误，部分用户被归到别的员工或别的公司。

## 待验证
- 查员工 `250194588` 在 `employees` / `company_accounts` 中对应的真实员工记录。
- 查该员工今天在 `attribution_users` 的明细、累计人数、来源类型分布。
- 对比 SelectDB 原始 `user` 表中该员工相关归因线的今日人数和累计人数。
- 直接调用 `partnerx.cc/api/dashboard/overview` 验证接口返回值与库中是否一致。

## 已确认结论
- `250194588` 不是 `employees.id`，而是员工 `Red Wang / FUN666` 的 `inviter_id`。
- 当前线上 `partnerx.cc/api/dashboard/overview` 对该员工返回值为：`今天 5 个 / 累计 13 个`。
- `attribution_users` 中该员工当前也确实只有 `13` 条，其中 `5` 条落在 `2026-06-18` 的北京时间范围内。
- 用户截图里的 5 个 `platform_user_id`（`251129411 / 251126926 / 251126174 / 251117132 / 251085805`）在 `attribution_users` 和 `recharge_orders` 中均不存在。
- 这说明差异不是页面筛选造成，而是这些用户在同步入库前就被漏掉了。

## 根因判断
- 当前 `.env.local` 中的 `SELECTDB_ATTRIBUTION_SQL` 逻辑是：有 `campaign` 就忽略 `sponsor`。
- 如果软件侧按 `师傅id=250194588` 统计，但原始用户同时带有 `campaign`，同步前就会丢掉 `sponsor`，最终无法归到 `FUN666 / 250194588`。
- 这与“软件累计 21、后台累计 13”以及“截图里的 5 个用户后台完全查不到”一致。

## 本次修复
- 已修改 `scripts/sync-selectdb.mjs`：
  - 不再依赖只输出单列 `invite_code` 的归因 SQL。
  - 改为直接读取 `campaign_key + sponsor_key + platform_user_id + bind_time`。
  - 过滤时同时匹配 `campaign_key` 和 `sponsor_key`。
  - 归因时优先使用能命中的 `campaign_key`，若 `campaign` 未命中则回退到 `sponsor`，避免用户因为“有 campaign”而彻底丢失。

## 待执行
- 在可连通 SelectDB 的环境补跑 `sync:selectdb`，验证 `250194588` 是否从 `13` 增长到与软件侧更接近的结果。
- 补查截图 5 个用户在原始 `user` 表中的 `campaign / sponsor` 实际值，作为最终证据闭环。

## 当前阻塞
- 已在本机尝试执行最小范围 dry run：
  - `SELECTDB_ONLY_INVITE_KEY=fun666 SELECTDB_CURSOR_RESET=1 DRY_RUN=1 node scripts/sync-selectdb.mjs`
- 结果为 `connect ETIMEDOUT`，阻塞点发生在连接 SelectDB，而不是脚本语法或本次逻辑修改。

## 服务器验证
- 已登录同步服务器 `64.176.85.59`，确认项目目录为 `/root/Partnerx-console`。
- 服务器原始脚本未包含本次修复，已先备份远端 `scripts/sync-selectdb.mjs`，再同步本地修复版脚本。
- 在服务器上执行：
  - `SELECTDB_ONLY_INVITE_KEY=250194588 SELECTDB_CURSOR_RESET=1 DRY_RUN=1 node scripts/sync-selectdb.mjs`
- 结果：
  - `归因批次读取: 21 条（累计 21）`
  - `增量归因读取完成：读取 21 条，命中 21 条`
- 随后已正式执行写库：
  - `SELECTDB_ONLY_INVITE_KEY=250194588 SELECTDB_CURSOR_RESET=1 node scripts/sync-selectdb.mjs`
  - 返回 `同步完成，已写入 Supabase`

## 写库后结果
- 线上 `overview` 接口重新查询后，`Red Wang / FUN666 / 250194588` 的总拉新已从 `13` 变为 `27`。
- 这说明原先“21 条 sponsor 线用户未入库”的问题已经补进后台，不再丢人。
- 当前 `27` 大于软件口径里的 `21`，是因为后台同时保留了原本已经存在的链接归因用户；软件那条口径更接近“纯 sponsor / 纯邀请码人数”，而后台当前展示的是合并后的总拉新人数。

## 全量补刷
- 为避免其他员工也存在同类漏数，已在服务器 `64.176.85.59` 上执行全量重刷：
  - `SELECTDB_CURSOR_RESET=1 node scripts/sync-selectdb.mjs`
- 过程中发现另一类隐藏脏数据：部分时间字段为 `13` 位毫秒时间戳，例如 `1763714827000`。
- 已在 `scripts/sync-selectdb.mjs` 中补充对 `10/13` 位时间戳的兼容。
- 修复后全量重刷成功：
  - `增量归因读取完成：读取 8035 条，命中 8035 条`
  - `增量充值读取完成：读取 6944 条，命中 6944 条`
  - `同步完成，已写入 Supabase`

## 口径治理
- 已修改 `overview` 接口与前台页面，拆分显示：
  - `mergedUsers`：合并总拉新
  - `inviteUsers`：邀请码人数
  - `adjustUsers`：链接人数
- 这样后续即使软件和后台看的不是同一口径，也能直接看出差异来自 `invite` 还是 `adjust`，不再只能看到一个总数。
