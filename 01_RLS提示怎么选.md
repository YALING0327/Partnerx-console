# Supabase 弹出 RLS 提示时怎么选

当你在 Supabase 运行建表 SQL 时，可能会看到这个提示：

`Potential issue detected`

大意是：

- 你创建了新表
- 但这些表还没有启用 `Row Level Security`
- 如果以后你的前端或客户端用了 `anon key` 或 `authenticated key`
- 那么这些表可能会被不该访问的人访问到

---

## 你现在应该选哪个？

建议你选：

- `Run and enable RLS`

不要优先选：

- `Run without RLS`

---

## 为什么建议你选 `Run and enable RLS`

因为你这个项目未来是要给外部合作伙伴使用的。

所以安全要从一开始就养成习惯。

开启 RLS 的好处是：

- 数据更安全
- 不容易被直接读表
- 更符合正式项目的做法

---

## 选了 `Run and enable RLS` 之后会发生什么

这表示：

1. 你的表会被创建出来
2. 这些表会开启 RLS 保护

开启之后，默认会更严格。

这其实是好事。

---

## 开启 RLS 后，为什么我后面代码可能会查不到数据？

因为：

- 普通匿名 key 的权限会被限制
- 前端不能再随便直接读这些表

这就是 RLS 的作用。

所以后面你登录接口、后台接口，应该放在服务端去查数据库。

也就是：

- 用 `service_role key`
- 只在后端 API 里使用

这也是为什么我已经把你的登录接口文档改成了服务端方式。

你可以看这里：

- [03_登录接口代码.md](file:///Users/lingyaliu/Downloads/%E5%BC%95%E6%B5%81%E5%AF%B9%E5%A4%96%E6%8E%A7%E5%88%B6%E5%8F%B0/03_%E7%99%BB%E5%BD%95%E6%8E%A5%E5%8F%A3%E4%BB%A3%E7%A0%81.md)

---

## 你现在应该怎么做

如果你现在正停在那个弹窗页面：

### 直接这样点

1. 点 `Run and enable RLS`
2. 等它执行完成
3. 执行完后去 `Table Editor` 看 7 张表有没有建出来

---

## 如果你已经选错了怎么办

如果你不小心点了：

- `Run without RLS`

也不是世界末日。

后面你依然可以再手动开启 RLS。

只是从安全角度来说，不如一开始就开。

---

## 最简单结论

你现在看到这个提示时，直接选：

- `Run and enable RLS`

这就是当前最适合你的选择。
