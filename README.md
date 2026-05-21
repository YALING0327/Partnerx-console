# PARTNERX 伙伴增长控制台

这是一个可部署的 Next.js 项目版本（包含登录、老板端/员工端控制台、员工新增/停用接口）。

## 本地启动

1. 安装依赖

```bash
npm install
```

2. 准备环境变量

复制 `.env.example` 为 `.env.local` 并填写真实值：

```bash
cp .env.example .env.local
```

3. 启动

```bash
npm run dev
```

访问：

- http://localhost:3000

## 接 SelectDB

这个项目已经带了一个 `SelectDB -> Supabase` 的同步脚本，适合你把公司生产库里的“邀请码绑定关系”和“充值数据”同步到当前控制台。

### 1. 安装依赖

```bash
npm install
```

### 2. 补环境变量

把下面这些值补到 `.env.local`：

```env
SELECTDB_HOST=
SELECTDB_PORT=9030
SELECTDB_USER=
SELECTDB_PASSWORD=
SELECTDB_DATABASE=prod
SELECTDB_ATTRIBUTION_SQL=SELECT TRIM(CAST(properties['sponsor'] AS STRING)) AS invite_code, account_id AS platform_user_id, event_created_time AS bind_time FROM `user` WHERE properties['sponsor'] IS NOT NULL AND TRIM(CAST(properties['sponsor'] AS STRING)) != ''
SELECTDB_RECHARGE_SQL=SELECT id AS order_no, account_id AS platform_user_id, TRIM(CAST(user['sponsor'] AS STRING)) AS invite_code, COALESCE(properties['amount'], properties['money'], properties['price'], properties['pay_amount'], properties['usd_amount'], 0) AS amount, event_created_time AS pay_time, 'success' AS status FROM recharge WHERE user['sponsor'] IS NOT NULL AND TRIM(CAST(user['sponsor'] AS STRING)) != ''
```

### 3. SQL 必须返回这些别名

`SELECTDB_ATTRIBUTION_SQL` 必须返回：

- `invite_code`
- `platform_user_id`
- `bind_time`

`SELECTDB_RECHARGE_SQL` 必须返回：

- `order_no`
- `platform_user_id`
- `invite_code`（建议返回，值来自 `user['sponsor']`）
- `amount`
- `pay_time`
- `status`

### 3.1 你现在这套库的推荐理解

- 邀请码绑定关系来源：`user.properties['sponsor']`
- 充值侧的邀请码来源：`recharge.user['sponsor']`
- 控制台真正做匹配时，还是按 `invite_code -> employees.invite_code` 来归因
- 充值最终会优先按 `platform_user_id` 对应已归因用户，匹配不到时再按 `invite_code` 兜底归因

如果你实际发现 `sponsor` 存的是“邀请人ID”（纯数字）而不是“邀请码字符串”，建议在 `employees` 表里新增一列 `inviter_id` 保存这个数字，并让脚本用 `invite_code -> employees.inviter_id` 来匹配。

也就是说：

1. 先从 `user` 表里拿到 `用户ID + sponsor邀请码`
2. 再用 sponsor 去匹配你控制台里的员工邀请码
3. 再把这些已经归因的用户，去 `recharge` 表里同步充值记录

如果你后面确认 `user` 表主键不是 `id`，或者时间字段不是 `create_time`，只要改 SQL 里的字段名即可，代码不用改。

### 4. 先试跑，不写入

```bash
npm run sync:selectdb:dry
```

如果输出正常，你会看到：

- 读取了多少条邀请码归因记录
- 读取了多少条充值记录
- 命中本控制台邀请码的归因记录有多少条
- 命中已归因用户的充值记录有多少条

### 5. 正式写入 Supabase

```bash
npm run sync:selectdb
```

### 5.1 定时同步

如果你的服务器已经部署好了项目，可以先手动确认没问题，再加定时任务：

```bash
crontab -e
```

每 10 分钟同步一次示例：

```cron
*/10 * * * * cd /你的项目目录 && /usr/bin/env npm run sync:selectdb >> sync-selectdb.log 2>&1
```

### 6. 脚本会写入哪些表

- `attribution_users`
- `recharge_orders`

### 7. 脚本依赖的 Supabase 约束

为了让 `upsert` 正常工作，你的 Supabase 表里最好有这两个唯一约束：

- `attribution_users(company_id, platform_user_id)` 唯一
- `recharge_orders(order_no)` 唯一

如果没有这两个唯一约束，脚本写入时可能会报错。

## 生产部署

```bash
npm run build
npm run start
```

建议使用 Nginx 反向代理到 3000 端口，并在服务器上设置环境变量（不要把 `.env.local` 提交到 GitHub）。
