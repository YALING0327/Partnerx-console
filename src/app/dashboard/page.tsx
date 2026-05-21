'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

type StoredUser = {
  id: string;
  companyId: string;
  role: 'boss' | 'staff';
  username: string;
  name: string | null;
};

type BossEmployee = {
  id: string;
  name: string;
  inviteCode: string;
  inviterId: string | null;
  status: string;
  newUsers: number;
  paidUsers: number;
  totalAmount: number;
  arppu: number;
};

type DashboardUser = {
  platformUserId: string;
  employeeName: string;
  inviteCode: string;
  bindTime: string;
  firstRechargeAt: string | null;
  lastRechargeAt: string | null;
  rechargeCount: number;
  totalAmount: number;
};

type DashboardData =
  | {
      role: 'boss';
      currentUser: { name: string | null; username: string };
      summary: { newUsers: number; paidUsers: number; totalAmount: number; arppu: number; employeeCount: number };
      employees: BossEmployee[];
      users: DashboardUser[];
    }
  | {
      role: 'staff';
      currentUser: { name: string | null; username: string };
      summary: { newUsers: number; paidUsers: number; totalAmount: number; arppu: number };
      profile: { name: string; inviteCode: string; inviterId: string | null; status: string };
      users: DashboardUser[];
    };

type View = 'home' | 'employees' | 'users';

function fmt(value: number) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 }).format(value || 0);
}

function fmtDate(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function exportCsv(filename: string, rows: string[][], headers: string[]) {
  const lines = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [view, setView] = useState<View>('home');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [filterEmployee, setFilterEmployee] = useState('');

  // Employee creation form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newInviteCode, setNewInviteCode] = useState('');
  const [newInviterId, setNewInviterId] = useState('');
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem('partnerx_user');
    if (!raw) { router.replace('/'); return; }
    setUser(JSON.parse(raw) as StoredUser);
  }, [router]);

  const loadDashboard = useCallback(async (u: StoredUser, sd: string, ed: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/dashboard/overview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...u, userId: u.id, companyId: u.companyId, startDate: sd || undefined, endDate: ed || undefined })
      });
      const result = await res.json() as DashboardData | { error: string };
      if (!res.ok) { setError('error' in result ? result.error : '加载失败'); return; }
      setData(result as DashboardData);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void loadDashboard(user, startDate, endDate);
  }, [user, loadDashboard, startDate, endDate]);

  async function handleAddEmployee(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setFormLoading(true);
    setFormError('');
    try {
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requesterId: user.id,
          requesterCompanyId: user.companyId,
          requesterRole: user.role,
          employeeName: newName,
          username: newUsername,
          password: newPassword,
          inviteCode: newInviteCode,
          inviterId: newInviterId
        })
      });
      const result = await res.json() as { message?: string; error?: string };
      if (!res.ok) { setFormError(result.error ?? '创建失败'); return; }
      setShowAddForm(false);
      setNewName(''); setNewUsername(''); setNewPassword(''); setNewInviteCode(''); setNewInviterId('');
      void loadDashboard(user, startDate, endDate);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleToggleEmployee(employeeId: string, currentStatus: string) {
    if (!user) return;
    const action = currentStatus === 'active' ? 'disable' : 'enable';
    await fetch('/api/employees', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requesterId: user.id, requesterCompanyId: user.companyId, requesterRole: user.role, employeeId, action })
    });
    void loadDashboard(user, startDate, endDate);
  }

  function handleLogout() {
    localStorage.removeItem('partnerx_user');
    router.replace('/');
  }

  if (!user) return null;

  const isBoss = user.role === 'boss';
  const bossData = data?.role === 'boss' ? data : null;
  const staffData = data?.role === 'staff' ? data : null;

  const navItems: { key: View; label: string }[] = isBoss
    ? [{ key: 'home', label: '首页' }, { key: 'employees', label: '员工与邀请码' }, { key: 'users', label: '用户业绩明细' }]
    : [{ key: 'home', label: '首页' }, { key: 'employees', label: '我的邀请码' }, { key: 'users', label: '用户业绩明细' }];

  const pageTitle = view === 'home'
    ? (isBoss ? '老板端业绩总览' : '员工端个人业绩')
    : view === 'employees'
    ? (isBoss ? '员工与邀请码' : '我的邀请码')
    : '用户业绩明细';

  return (
    <main className="dashboardPage">
      <aside className="sidebar">
        <div className="sidebarBrand">
          <div className="sidebarLogo">PX</div>
          <div>
            <strong>PARTNERX</strong>
            <p>伙伴增长控制台</p>
          </div>
        </div>
        <nav className="sidebarNav">
          {navItems.map((item) => (
            <button key={item.key} className={`sidebarLink${view === item.key ? ' active' : ''}`} onClick={() => setView(item.key)}>
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="dashboardMain">
        <header className="dashboardHeader">
          <div>
            <p className="dashboardBreadcrumb">首页 / 伙伴增长控制台</p>
            <h1 className="dashboardTitle">{pageTitle}</h1>
          </div>
          <div className="dashboardActions">
            <span className="roleTag">{isBoss ? '企业管理员' : '员工'}</span>
            <button className="logoutBtn" onClick={handleLogout}>退出登录</button>
          </div>
        </header>

        {loading ? (
          <section className="loadingCard">正在加载数据...</section>
        ) : error ? (
          <section className="loadingCard">加载失败：{error}</section>
        ) : !data ? null : (
          <>
            {/* HOME VIEW */}
            {view === 'home' && (
              <>
                <section className="statsGrid">
                  <article className="statCard"><span>拉新总人数</span><strong>{data.summary.newUsers}</strong></article>
                  <article className="statCard"><span>总付费人数</span><strong>{data.summary.paidUsers}</strong></article>
                  <article className="statCard"><span>充值总金额</span><strong>{fmt(data.summary.totalAmount)}</strong></article>
                  <article className="statCard"><span>ARPPU</span><strong>{fmt(data.summary.arppu)}</strong></article>
                  {bossData && <article className="statCard"><span>团队人数</span><strong>{bossData.summary.employeeCount}</strong></article>}
                </section>

                {bossData && (
                  <section className="dashboardSection">
                    <div className="sectionHead">
                      <div><p className="sectionLabel">团队概览</p><h2>员工与邀请码表现</h2></div>
                    </div>
                    <div className="tableWrap">
                      <table className="dataTable">
                        <thead><tr><th>员工</th><th>邀请码</th><th>邀请人ID</th><th>拉新人数</th><th>付费人数</th><th>充值总额</th><th>状态</th></tr></thead>
                        <tbody>
                          {bossData.employees.map((emp) => (
                            <tr key={emp.id}>
                              <td>{emp.name}</td><td>{emp.inviteCode}</td><td>{emp.inviterId || '-'}</td><td>{emp.newUsers}</td>
                              <td>{emp.paidUsers}</td><td>{fmt(emp.totalAmount)}</td>
                              <td><span className={emp.status === 'active' ? 'statusActive' : 'statusDisabled'}>{emp.status === 'active' ? '正常' : '停用'}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {staffData && (
                  <section className="dashboardSection">
                    <div className="sectionHead"><div><p className="sectionLabel">个人信息</p><h2>我的邀请码与账户状态</h2></div></div>
                    <div className="profileGrid">
                      <article className="profileCard"><span>员工姓名</span><strong>{staffData.profile.name}</strong></article>
                      <article className="profileCard"><span>邀请码</span><strong>{staffData.profile.inviteCode}</strong></article>
                      <article className="profileCard"><span>邀请人ID</span><strong>{staffData.profile.inviterId || '-'}</strong></article>
                      <article className="profileCard"><span>账号状态</span><strong>{staffData.profile.status === 'active' ? '正常' : '停用'}</strong></article>
                      <article className="profileCard"><span>登录账号</span><strong>{staffData.currentUser.username}</strong></article>
                    </div>
                  </section>
                )}
              </>
            )}

            {/* EMPLOYEES VIEW */}
            {view === 'employees' && (
              <section className="dashboardSection">
                {isBoss ? (
                  <>
                    <div className="sectionHead">
                      <div><p className="sectionLabel">员工管理</p><h2>员工列表与邀请码</h2></div>
                      <button className="addBtn" onClick={() => { setShowAddForm(true); setFormError(''); }}>+ 新增员工</button>
                    </div>

                    {showAddForm && (
                      <form className="addForm" onSubmit={(e) => void handleAddEmployee(e)}>
                        <h3>新增员工</h3>
                        <div className="formRow">
                          <label className="field"><span>员工姓名</span><input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例：张三" required /></label>
                          <label className="field"><span>登录账号</span><input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="例：staff_zhang" required /></label>
                        </div>
                        <div className="formRow">
                          <label className="field"><span>初始密码</span><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="至少 6 位" minLength={6} required /></label>
                          <label className="field"><span>邀请码</span><input value={newInviteCode} onChange={(e) => setNewInviteCode(e.target.value)} placeholder="例：ZHANG2024" required /></label>
                        </div>
                        <div className="formRow">
                          <label className="field"><span>邀请人ID</span><input value={newInviterId} onChange={(e) => setNewInviterId(e.target.value)} placeholder="例：156938339" /></label>
                        </div>
                        {formError && <p className="formError">{formError}</p>}
                        <div className="formActions">
                          <button type="submit" className="submitBtn" disabled={formLoading}>{formLoading ? '创建中...' : '确认创建'}</button>
                          <button type="button" className="cancelBtn" onClick={() => setShowAddForm(false)}>取消</button>
                        </div>
                      </form>
                    )}

                    <div className="tableWrap">
                      <table className="dataTable">
                        <thead><tr><th>员工姓名</th><th>邀请码</th><th>邀请人ID</th><th>拉新人数</th><th>付费人数</th><th>充值总额</th><th>状态</th><th>操作</th></tr></thead>
                        <tbody>
                          {bossData?.employees.map((emp) => (
                            <tr key={emp.id}>
                              <td>{emp.name}</td><td>{emp.inviteCode}</td><td>{emp.inviterId || '-'}</td><td>{emp.newUsers}</td>
                              <td>{emp.paidUsers}</td><td>{fmt(emp.totalAmount)}</td>
                              <td><span className={emp.status === 'active' ? 'statusActive' : 'statusDisabled'}>{emp.status === 'active' ? '正常' : '停用'}</span></td>
                              <td>
                                <button className="actionBtn" onClick={() => void handleToggleEmployee(emp.id, emp.status)}>
                                  {emp.status === 'active' ? '停用' : '启用'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : staffData ? (
                  <>
                    <div className="sectionHead"><div><p className="sectionLabel">推广工具</p><h2>我的邀请码</h2></div></div>
                    <div className="inviteCodeBox">
                      <span className="inviteCodeLabel">我的专属邀请码</span>
                      <strong className="inviteCodeValue">{staffData.profile.inviteCode}</strong>
                    </div>
                    <div className="inviteCodeBox">
                      <span className="inviteCodeLabel">邀请人ID</span>
                      <strong className="inviteCodeValue">{staffData.profile.inviterId || '-'}</strong>
                    </div>
                  </>
                ) : null}
              </section>
            )}

            {/* USERS VIEW */}
            {view === 'users' && (
              <section className="dashboardSection">
                <div className="sectionHead">
                  <div><p className="sectionLabel">用户明细</p><h2>{isBoss ? '团队归因用户充值表现' : '我拉来的用户及充值表现'}</h2></div>
                  <button className="addBtn" onClick={() => {
                    const rows = data.users.map((u) => [u.platformUserId, u.employeeName, u.inviteCode, fmtDate(u.bindTime), fmtDate(u.firstRechargeAt), String(u.rechargeCount), String(u.totalAmount), fmtDate(u.lastRechargeAt)]);
                    exportCsv('用户业绩明细.csv', rows, ['用户ID', '归因员工', '邀请码', '绑定时间', '首次充值时间', '充值笔数', '累计充值', '最近充值时间']);
                  }}>导出 CSV</button>
                </div>

                <div className="filterRow">
                  <label className="filterField"><span>开始日期</span><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
                  <label className="filterField"><span>结束日期</span><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
                  {isBoss && bossData && (
                    <label className="filterField">
                      <span>归因员工</span>
                      <select className="filterSelect" value={filterEmployee} onChange={(e) => setFilterEmployee(e.target.value)}>
                        <option value="">全部员工</option>
                        {bossData.employees.map((emp) => (
                          <option key={emp.id} value={emp.name}>{emp.name}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {(startDate || endDate || filterEmployee) && <button className="cancelBtn" onClick={() => { setStartDate(''); setEndDate(''); setFilterEmployee(''); }}>清除筛选</button>}
                </div>

                <div className="tableWrap">
                  <table className="dataTable">
                    <thead>
                      <tr>
                        <th>用户 ID</th>
                        {isBoss && <th>归因员工</th>}
                        <th>邀请码</th><th>绑定时间</th><th>首次充值时间</th><th>充值笔数</th><th>累计充值</th><th>最近充值时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.users.filter((u) => !filterEmployee || u.employeeName === filterEmployee).length
                        ? data.users.filter((u) => !filterEmployee || u.employeeName === filterEmployee).map((item) => (
                        <tr key={item.platformUserId}>
                          <td>{item.platformUserId}</td>
                          {isBoss && <td>{item.employeeName}</td>}
                          <td>{item.inviteCode}</td><td>{fmtDate(item.bindTime)}</td>
                          <td>{fmtDate(item.firstRechargeAt)}</td><td>{item.rechargeCount}</td>
                          <td>{fmt(item.totalAmount)}</td><td>{fmtDate(item.lastRechargeAt)}</td>
                        </tr>
                      )) : (
                        <tr><td colSpan={isBoss ? 8 : 7}>暂无数据</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
      </section>
    </main>
  );
}
