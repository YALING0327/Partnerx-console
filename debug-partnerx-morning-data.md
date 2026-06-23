# [OPEN] partnerx-morning-data

## 问题

- 现象：`https://www.partnerx.cc/dashboard` 今天早上的数据为空
- 预期：今天早上的 dashboard 数据应正常显示

## 当前假设

1. 早上那段时间的源数据没有同步进数据库
2. dashboard 接口对“今日”时间范围或时区边界计算错误
3. 数据已入库，但被 overview/dashboard 查询条件过滤掉
4. 前端请求拿到数据后，展示层错误渲染为空

## 调试约束

- 在拿到运行时证据前，不修改业务逻辑
- 第一处逻辑改动只能是插桩/日志

## 当前状态

- 已创建调试会话文件
- 已定位 dashboard 接口：`src/app/api/dashboard/overview/route.ts`
- 已确认 staff 端“团队今日数据”来源：
  - 表：`recharge_orders`
  - 字段：`pay_time`
  - 时间过滤：`applyBeijingPayDateRange(today, today)`
- 已拿到运行时证据：
  - 本地直查 Supabase：`2026-06-23` 当天只有 `50` 条订单
  - 最后一笔 `pay_time` 为 `2026-06-22T18:01:46+00:00`，即北京时间 `2026-06-23 02:01:46`
  - 按小时分布只有 `00 / 01 / 02` 三个小时有数据
  - 对照昨日，`2026-06-22` 的订单覆盖 `00-23` 全时段，共 `394` 条
  - 说明今天不是“查询逻辑只漏了早上某几个小时”，而是生产库今天 02:01 之后就没有新增充值数据进入 `recharge_orders`
  - 新加坡同步机 `64.176.85.59` SSH 连接报错：`Connection timed out during banner exchange`

## 当前判断

### 已基本排除

1. 前端展示层自己把数据渲染空
2. dashboard 今日榜单接口单纯因为时区计算错误漏掉早上数据

### 当前最可能根因

1. SelectDB -> Supabase 的同步链路今天凌晨后中断
2. 负责同步的 `partnerx-sync-sg` 服务器当前不可达，定时任务大概率没有继续跑

## 下一步

1. 恢复或替换同步服务器
2. 在恢复后执行一次补同步，把 `2026-06-23 02:01` 之后的数据补进 `recharge_orders`
3. 再重新验证 `/dashboard` 今日团队数据是否恢复
