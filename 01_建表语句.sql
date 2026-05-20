-- ==========================================
-- 伙伴增长控制台 - 第一版建表 SQL
-- 用途：一次性创建 7 张核心业务表
-- 使用方式：把整个文件全部复制到 Supabase 的 SQL Editor 中执行
-- ==========================================

-- 如果数据库里还没有 gen_random_uuid()，先开启 pgcrypto 扩展
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ==========================================
-- 1. 合作公司表
-- ==========================================
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'active', -- active(正常), inactive(禁用)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- ==========================================
-- 2. 公司账户表 (存老板和员工账号)
-- ==========================================
CREATE TABLE IF NOT EXISTS company_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL, -- boss(老板), staff(员工)
  username VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  phone VARCHAR(50),
  email VARCHAR(255),
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- ==========================================
-- 3. 员工信息表
-- ==========================================
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  account_id UUID REFERENCES company_accounts(id) ON DELETE CASCADE,
  employee_name VARCHAR(255) NOT NULL,
  invite_code VARCHAR(50) UNIQUE NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- ==========================================
-- 4. 被归因用户表
-- ==========================================
CREATE TABLE IF NOT EXISTS attribution_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  platform_user_id VARCHAR(255) UNIQUE NOT NULL, -- 保证一个平台用户只能被归因一次
  invite_code VARCHAR(50) NOT NULL,
  bind_time TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  bind_status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- ==========================================
-- 5. 充值订单表
-- ==========================================
CREATE TABLE IF NOT EXISTS recharge_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  platform_user_id VARCHAR(255) NOT NULL,
  order_no VARCHAR(255) UNIQUE NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status VARCHAR(50) DEFAULT 'success',
  pay_time TIMESTAMP WITH TIME ZONE NOT NULL,
  is_first_recharge BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- ==========================================
-- 6. 操作日志表
-- ==========================================
CREATE TABLE IF NOT EXISTS operation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID, -- 这里不加外键，防止公司删了导致日志也跟着没了
  operator_account_id UUID,
  operator_role VARCHAR(50),
  action VARCHAR(255) NOT NULL,
  target_type VARCHAR(255),
  target_id VARCHAR(255),
  detail TEXT,
  ip VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- ==========================================
-- 7. 登录日志表
-- ==========================================
CREATE TABLE IF NOT EXISTS login_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID,
  company_id UUID,
  login_result VARCHAR(50) NOT NULL, -- success(成功), failed(失败)
  ip VARCHAR(50),
  device_info TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- ==========================================
-- 常用索引
-- 作用：让后面登录、筛选、查业绩更快
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_company_accounts_company_id ON company_accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_company_accounts_role ON company_accounts(role);
CREATE INDEX IF NOT EXISTS idx_employees_company_id ON employees(company_id);
CREATE INDEX IF NOT EXISTS idx_employees_invite_code ON employees(invite_code);
CREATE INDEX IF NOT EXISTS idx_attribution_users_company_id ON attribution_users(company_id);
CREATE INDEX IF NOT EXISTS idx_attribution_users_employee_id ON attribution_users(employee_id);
CREATE INDEX IF NOT EXISTS idx_attribution_users_platform_user_id ON attribution_users(platform_user_id);
CREATE INDEX IF NOT EXISTS idx_recharge_orders_company_id ON recharge_orders(company_id);
CREATE INDEX IF NOT EXISTS idx_recharge_orders_employee_id ON recharge_orders(employee_id);
CREATE INDEX IF NOT EXISTS idx_recharge_orders_platform_user_id ON recharge_orders(platform_user_id);
CREATE INDEX IF NOT EXISTS idx_recharge_orders_pay_time ON recharge_orders(pay_time);

-- ==========================================
-- 说明
-- 1. 这个文件只负责建表，不负责插入测试数据
-- 2. 测试数据请执行同目录下的 02_插入测试数据.sql
-- ==========================================
