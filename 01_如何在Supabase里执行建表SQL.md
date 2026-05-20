# 如何在 Supabase 里执行建表 SQL

这份说明是给完全小白看的。

你现在要做的事情只有一件：

- 把 [01_建表语句.sql](file:///Users/lingyaliu/Downloads/%E5%BC%95%E6%B5%81%E5%AF%B9%E5%A4%96%E6%8E%A7%E5%88%B6%E5%8F%B0/01_%E5%BB%BA%E8%A1%A8%E8%AF%AD%E5%8F%A5.sql) 里的代码复制到 Supabase
- 然后点击运行

如果你严格照着下面做，7 张表就会被创建出来。

---

## 第 1 步：打开 Supabase

1. 打开浏览器。
2. 进入 [https://supabase.com/dashboard](https://supabase.com/dashboard)
3. 登录你的账号。

你登录后，会看到你的项目列表。

---

## 第 2 步：进入你的项目

1. 在项目列表里，找到你刚创建的项目。
2. 点击项目名称。

点击后，你会进入项目后台。

---

## 第 3 步：找到 SQL Editor

1. 看左边这一列菜单。
2. 找到 `SQL Editor`。
3. 点击它。

如果你找不到，就记住关键词：

- `SQL Editor`

一般它会在左侧菜单比较靠上的位置。

---

## 第 4 步：新建一个 SQL 查询窗口

1. 进入 `SQL Editor` 后，点击右上角的 `New query`。
2. 点击以后，页面中间会出现一个很大的编辑区域。

这个大框就是你等会儿要粘贴 SQL 的地方。

---

## 第 5 步：打开建表 SQL 文件

1. 回到你的电脑文件夹：
   - `/Users/lingyaliu/Downloads/引流对外控制台`
2. 找到这个文件：
   - [01_建表语句.sql](file:///Users/lingyaliu/Downloads/%E5%BC%95%E6%B5%81%E5%AF%B9%E5%A4%96%E6%8E%A7%E5%88%B6%E5%8F%B0/01_%E5%BB%BA%E8%A1%A8%E8%AF%AD%E5%8F%A5.sql)
3. 用 VS Code 或任何文本编辑器打开它。

你打开后，会看到很多 `CREATE TABLE` 开头的代码。

这就是建表代码。

---

## 第 6 步：复制整个 SQL 文件内容

1. 在 `01_建表语句.sql` 文件里点击任意位置。
2. 按键盘：
   - `Command + A`
   - 作用：全选
3. 再按：
   - `Command + C`
   - 作用：复制

如果你不习惯快捷键，也可以：

1. 用鼠标全选所有代码
2. 右键复制

---

## 第 7 步：把 SQL 粘贴到 Supabase

1. 回到 Supabase 的 `SQL Editor` 页面。
2. 点击中间那个大黑框或大输入框。
3. 按：
   - `Command + V`

这一步做完后，你应该能看到整段 SQL 已经出现在输入框里。

---

## 第 8 步：运行 SQL

1. 检查一眼，确认输入框里不是空的。
2. 点击右下角或右上角的 `Run` 按钮。
3. 等几秒钟。

如果执行成功，通常会看到成功提示，比如：

- `Success`
- `Query executed successfully`
- `No rows returned`

不同版本界面文案可能略有不同，但意思都一样：

- 运行成功了

---

## 第 9 步：去哪里查看 7 张表有没有建好

1. 看左侧菜单。
2. 点击 `Table Editor`。
3. 在表列表里查看是否已经出现这些表：

- `companies`
- `company_accounts`
- `employees`
- `attribution_users`
- `recharge_orders`
- `operation_logs`
- `login_logs`

如果这 7 张表都出现了，就说明你建表成功了。

---

## 第 10 步：如果成功了，下一步做什么

建表成功后，不要停。

下一步你应该执行测试数据文件：

- [02_插入测试数据.sql](file:///Users/lingyaliu/Downloads/%E5%BC%95%E6%B5%81%E5%AF%B9%E5%A4%96%E6%8E%A7%E5%88%B6%E5%8F%B0/02_%E6%8F%92%E5%85%A5%E6%B5%8B%E8%AF%95%E6%95%B0%E6%8D%AE.sql)

这样你的表里才会有测试数据，后面你做登录页和列表页时才看得到内容。

---

## 常见问题 1：我点了 Run 但是报错了

先不要慌。

最常见的几种情况是：

### 情况 A：表已经存在

可能会看到类似：

- `relation already exists`

这说明你之前已经执行过一次了。

解决方法：

- 如果只是第一次学习，可以先忽略
- 因为现在 SQL 文件里已经加了 `IF NOT EXISTS`
- 大多数重复执行不会有问题

### 情况 B：复制不完整

如果你只复制了一半，可能会报语法错误。

解决方法：

1. 回到 [01_建表语句.sql](file:///Users/lingyaliu/Downloads/%E5%BC%95%E6%B5%81%E5%AF%B9%E5%A4%96%E6%8E%A7%E5%88%B6%E5%8F%B0/01_%E5%BB%BA%E8%A1%A8%E8%AF%AD%E5%8F%A5.sql)
2. 再按一次 `Command + A`
3. 再按一次 `Command + C`
4. 重新粘贴

### 情况 C：你把别的内容也复制进去了

比如把说明文字一起复制了。

解决方法：

- 只复制 `.sql` 文件里的代码
- 不要复制 Markdown 说明文档里的普通文字

---

## 常见问题 2：我怎么看表里的内容

如果你只是建表，还没有插入测试数据，那表里通常是空的。

你可以：

1. 点击 `Table Editor`
2. 点击某一张表，例如 `companies`
3. 看右侧数据区

如果没有数据，这是正常的，因为你还没执行测试数据 SQL。

---

## 常见问题 3：我下一步到底先做什么

你按这个顺序就对了：

1. 先执行 [01_建表语句.sql](file:///Users/lingyaliu/Downloads/%E5%BC%95%E6%B5%81%E5%AF%B9%E5%A4%96%E6%8E%A7%E5%88%B6%E5%8F%B0/01_%E5%BB%BA%E8%A1%A8%E8%AF%AD%E5%8F%A5.sql)
2. 再执行 [02_插入测试数据.sql](file:///Users/lingyaliu/Downloads/%E5%BC%95%E6%B5%81%E5%AF%B9%E5%A4%96%E6%8E%A7%E5%88%B6%E5%8F%B0/02_%E6%8F%92%E5%85%A5%E6%B5%8B%E8%AF%95%E6%95%B0%E6%8D%AE.sql)
3. 再做登录接口

不要颠倒顺序。

---

## 你现在最该做的动作

马上去打开：

- [01_建表语句.sql](file:///Users/lingyaliu/Downloads/%E5%BC%95%E6%B5%81%E5%AF%B9%E5%A4%96%E6%8E%A7%E5%88%B6%E5%8F%B0/01_%E5%BB%BA%E8%A1%A8%E8%AF%AD%E5%8F%A5.sql)

然后按这份文档的步骤执行一次。

如果中途报错，把报错原文发给我，我会继续一步一步带你改。
