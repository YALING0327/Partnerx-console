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

## 生产部署

```bash
npm run build
npm run start
```

建议使用 Nginx 反向代理到 3000 端口，并在服务器上设置环境变量（不要把 `.env.local` 提交到 GitHub）。

