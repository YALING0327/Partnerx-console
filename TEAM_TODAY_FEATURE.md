# 员工端"团队今日数据"功能实现总结

## 功能描述

为**引流对外控制台**的员工端（staff）添加"团队今日数据"功能，让员工可以看到同公司其他员工今天的业绩数据，包括：
- 员工姓名
- 今日付费用户数
- 今日充值总额
- 按充值金额降序排列展示排名
- 高亮显示当前登录员工

## 实现细节

### 1. 前端界面（Dashboard页面）

**文件**: `src/app/dashboard/page.tsx`

#### 修改类型定义
```typescript
type DashboardData =
  | { role: 'boss'; ... }
  | {
      role: 'staff';
      currentUser: { name: string | null; username: string };
      summary: { ... };
      profile: { ... };
      todayTeamStats?: {  // 新增：今日团队数据
        name: string;
        paidUsers: number;
        totalAmount: number;
      }[];
      users: DashboardUser[];
    };
```

#### 添加UI组件
在员工主页添加新的section，展示团队排行榜：
- **排名**：前三名用金银铜色高亮（🥇🥈🥉）
- **员工姓名**：当前员工标记"(我)"
- **今日付费人数**：该员工今天的付费用户数
- **今日充值金额**：该员工今天的充值总额
- **高亮行**：当前员工的行用金色背景高亮

### 2. 后端API（Overview接口）

**文件**: `src/app/api/dashboard/overview/route.ts`

#### 新增辅助函数
```typescript
function getTodayBeijing() {
  const now = new Date();
  const beijingTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const year = beijingTime.getFullYear();
  const month = String(beijingTime.getMonth() + 1).padStart(2, '0');
  const day = String(beijingTime.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
```

#### 数据查询逻辑
1. 查询同公司所有活跃员工
2. 查询今天的充值订单（使用北京时区）
3. 按员工ID分组统计：
   - 付费用户数（去重）
   - 充值总额（只统计成功订单）
4. 按充值金额降序排列

```typescript
// 查询今天的团队数据
const today = getTodayBeijing();
const { data: allEmployees } = await supabaseServer
  .from('employees')
  .select('id, employee_name, status')
  .eq('company_id', companyId);

const activeEmployeeIds = (allEmployees ?? [])
  .filter((e: { status: string }) => e.status === 'active')
  .map((e: { id: string }) => e.id);

let todayTeamRechargeQuery = supabaseServer
  .from('recharge_orders')
  .select('employee_id, platform_user_id, amount, status')
  .eq('company_id', companyId)
  .in('employee_id', activeEmployeeIds);

todayTeamRechargeQuery = applyBeijingPayDateRange(todayTeamRechargeQuery, today, today);
```

#### 返回数据格式
```typescript
{
  role: 'staff',
  currentUser: { ... },
  summary: { ... },
  profile: { ... },
  todayTeamStats: [
    { name: "张三", paidUsers: 15, totalAmount: 450000 },
    { name: "李四", paidUsers: 12, totalAmount: 380000 },
    { name: "王五", paidUsers: 10, totalAmount: 320000 }
  ],
  users: [ ... ]
}
```

### 3. 样式（CSS）

**文件**: `src/app/globals.css`

添加高亮行样式：
```css
.dataTable tbody tr.highlightRow {
  background: rgba(220, 180, 84, 0.1);
  border-left: 3px solid var(--accent);
}

.dataTable tbody tr.highlightRow:hover {
  background: rgba(220, 180, 84, 0.15);
}
```

### 4. 多语言支持

**文件**: `src/lib/i18n.ts`

#### 中文文案
```typescript
section_team_today: '团队竞争榜',
section_team_today_title: '团队今日数据',
section_team_today_hint: '仅显示今天的付费用户和充值金额，按充值金额降序排列',
th_rank: '排名',
th_today_paid_users: '今日付费人数',
th_today_total_amount: '今日充值金额',
label_me: '我'
```

#### 英文文案
```typescript
section_team_today: 'Team Leaderboard',
section_team_today_title: 'Today\'s Team Performance',
section_team_today_hint: 'Showing only today\'s paid users and revenue, sorted by amount descending',
th_rank: 'Rank',
th_today_paid_users: 'Today\'s Paid Users',
th_today_total_amount: 'Today\'s Revenue',
label_me: 'Me'
```

## 功能特点

### 1. 实时更新
- 只显示**今天**的数据（北京时区）
- 每次刷新页面都会重新统计最新数据

### 2. 隐私保护
- **只显示活跃员工**的数据（status = 'active'）
- 已停用员工不在列表中显示

### 3. 排名可视化
- 前三名用特殊颜色高亮：
  - 🥇 第1名：金色 `#d4af37`
  - 🥈 第2名：银色 `#c0c0c0`
  - 🥉 第3名：铜色 `#cd7f32`
- 当前员工行用金色背景高亮

### 4. 按充值金额排序
- 默认按今日充值总额降序排列
- 充值金额相同时保持原有顺序

### 5. 空状态处理
- 如果今天没有任何员工有付费用户，section不显示
- 避免展示空表格

## 使用场景

### 场景1：激励员工竞争
员工登录后可以看到自己在团队中的排名，促进良性竞争。

### 场景2：了解团队整体表现
员工可以看到今天团队的整体业绩情况，而不仅仅是自己的数据。

### 场景3：学习优秀案例
排名靠前的员工可以作为学习榜样。

## 数据统计规则

### 今日定义
- 使用**北京时区**（Asia/Shanghai）
- 从今天00:00:00到23:59:59

### 付费用户统计
- 只统计**今天充值成功**的订单（status = 'success'）
- 同一用户多次充值只算1个付费用户（去重）

### 充值金额统计
- 累加今天所有成功订单的金额
- 金额单位：美分（需除以100显示为美元）

## 注意事项

### 1. 性能考虑
- 每次加载dashboard页面都会查询今天的团队数据
- 如果公司员工数量很多（>100），建议：
  - 添加缓存（Redis）
  - 缓存时间5-10分钟

### 2. 数据一致性
- 使用与其他统计相同的时区（北京时区）
- 使用相同的日期范围计算函数 `applyBeijingPayDateRange`

### 3. 显示逻辑
```typescript
{staffData.todayTeamStats && staffData.todayTeamStats.length > 0 && (
  // 只有当有数据时才显示这个section
)}
```

## 验证测试

### 构建测试
```bash
cd "/Users/lingyaliu/Downloads/控制台工作区/引流对外控制台"
npm run build
```
结果：✅ 编译成功

### 功能测试清单

#### 1. 员工登录测试
- [ ] 员工登录后可以看到"团队今日数据"section
- [ ] 当前员工在列表中高亮显示
- [ ] 标记"(我)"在员工姓名后

#### 2. 数据准确性测试
- [ ] 今日付费人数统计正确（去重）
- [ ] 今日充值金额统计正确（只统计success订单）
- [ ] 排序正确（按金额降序）

#### 3. 排名显示测试
- [ ] 前三名显示特殊颜色（金银铜）
- [ ] 排名数字显示正确

#### 4. 边界情况测试
- [ ] 今天没有数据时，section不显示
- [ ] 只有当前员工有数据时，也正常显示
- [ ] 所有员工都停用时，列表为空

#### 5. 多语言测试
- [ ] 切换到英文，文案正确显示
- [ ] 切换到中文，文案正确显示

## 后续优化建议

### 1. 性能优化
- 添加Redis缓存，缓存5-10分钟
- 只在首页加载时查询，员工切换到其他tab时不重复查询

### 2. 功能增强
- 添加"昨日数据"对比
- 添加"本周累计"排行榜
- 添加趋势图表（过去7天的排名变化）

### 3. 交互优化
- 添加刷新按钮，手动刷新数据
- 添加自动刷新功能（每5分钟）
- 点击员工名可查看详细数据

### 4. 数据导出
- 支持导出团队今日数据为CSV

---

## 文件修改清单

### 修改的文件
1. `src/app/dashboard/page.tsx` - 添加团队今日数据UI
2. `src/app/api/dashboard/overview/route.ts` - 添加今日团队数据查询
3. `src/app/globals.css` - 添加高亮行样式
4. `src/lib/i18n.ts` - 添加多语言文案

### 新建的文档
1. `TEAM_TODAY_FEATURE.md` - 本文档

---

## 联系人
- 开发者：Claude (Opus 4.8)
- 实现日期：2026年6月22日
