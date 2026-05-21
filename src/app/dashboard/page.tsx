'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredLang, langLocale, setStoredLang, t, type Lang } from '@/lib/i18n';

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

function fmt(value: number, lang: Lang) {
  const dollars = (Number(value || 0) || 0) / 100;
  return new Intl.NumberFormat(langLocale(lang), { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(dollars);
}

function fmtDate(value: string | null, lang: Lang) {
  if (!value) return '-';
  return new Date(value).toLocaleString(langLocale(lang), { hour12: false });
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
  const [lang, setLang] = useState<Lang>('zh');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [appliedStartDate, setAppliedStartDate] = useState('');
  const [appliedEndDate, setAppliedEndDate] = useState('');
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

  useEffect(() => {
    setLang(getStoredLang());
  }, []);

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
      if (!res.ok) { setError('error' in result ? result.error : t(lang, 'load_failed')); return; }
      setData(result as DashboardData);
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, 'load_failed'));
    } finally {
      setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    if (user) void loadDashboard(user, appliedStartDate, appliedEndDate);
  }, [user, loadDashboard, appliedStartDate, appliedEndDate]);

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
      void loadDashboard(user, appliedStartDate, appliedEndDate);
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
    void loadDashboard(user, appliedStartDate, appliedEndDate);
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
    ? [{ key: 'home', label: t(lang, 'nav_home') }, { key: 'employees', label: t(lang, 'nav_employees') }, { key: 'users', label: t(lang, 'nav_users') }]
    : [{ key: 'home', label: t(lang, 'nav_home') }, { key: 'employees', label: t(lang, 'nav_my_invite') }, { key: 'users', label: t(lang, 'nav_users') }];

  const pageTitle = view === 'home'
    ? (isBoss ? t(lang, 'title_boss_home') : t(lang, 'title_staff_home'))
    : view === 'employees'
    ? (isBoss ? t(lang, 'title_employees') : t(lang, 'title_my_invite'))
    : t(lang, 'title_users');

  return (
    <main className="dashboardPage">
      <aside className="sidebar">
        <div className="sidebarBrand">
          <div className="sidebarLogo">PX</div>
          <div>
            <strong>PARTNERX</strong>
            <p>{t(lang, 'login_title')}</p>
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
            <p className="dashboardBreadcrumb">{t(lang, 'breadcrumb')}</p>
            <h1 className="dashboardTitle">{pageTitle}</h1>
          </div>
          <div className="dashboardActions">
            <select
              className="langSelect"
              value={lang}
              onChange={(e) => {
                const next = (e.target.value === 'en' ? 'en' : 'zh') as Lang;
                setLang(next);
                setStoredLang(next);
              }}
              aria-label={t(lang, 'language')}
            >
              <option value="zh">{t(lang, 'lang_zh')}</option>
              <option value="en">{t(lang, 'lang_en')}</option>
            </select>
            <span className="roleTag">{isBoss ? t(lang, 'role_boss') : t(lang, 'role_staff')}</span>
            <button className="logoutBtn" onClick={handleLogout}>{t(lang, 'logout')}</button>
          </div>
        </header>

        {loading ? (
          <section className="loadingCard">{t(lang, 'loading')}</section>
        ) : error ? (
          <section className="loadingCard">{t(lang, 'load_failed')}：{error}</section>
        ) : !data ? null : (
          <>
            {/* HOME VIEW */}
            {view === 'home' && (
              <>
                <section className="statsGrid">
                  <article className="statCard"><span>{t(lang, 'stat_new_users')}</span><strong>{data.summary.newUsers}</strong></article>
                  <article className="statCard"><span>{t(lang, 'stat_paid_users')}</span><strong>{data.summary.paidUsers}</strong></article>
                  <article className="statCard"><span>{t(lang, 'stat_total_amount')}</span><strong>{fmt(data.summary.totalAmount, lang)}</strong></article>
                  <article className="statCard"><span>{t(lang, 'stat_arppu')}</span><strong>{fmt(data.summary.arppu, lang)}</strong></article>
                  {bossData && <article className="statCard"><span>{t(lang, 'stat_employee_count')}</span><strong>{bossData.summary.employeeCount}</strong></article>}
                </section>

                {bossData && (
                  <section className="dashboardSection">
                    <div className="sectionHead">
                      <div><p className="sectionLabel">{t(lang, 'section_team_overview')}</p><h2>{t(lang, 'section_employee_performance')}</h2></div>
                    </div>
                    <div className="tableWrap">
                      <table className="dataTable">
                        <thead><tr><th>{t(lang, 'th_employee')}</th><th>{t(lang, 'th_invite_code')}</th><th>{t(lang, 'th_inviter_id')}</th><th>{t(lang, 'th_new_users')}</th><th>{t(lang, 'th_paid_users')}</th><th>{t(lang, 'th_total_amount')}</th><th>{t(lang, 'th_status')}</th></tr></thead>
                        <tbody>
                          {bossData.employees.map((emp) => (
                            <tr key={emp.id}>
                              <td>{emp.name}</td><td>{emp.inviteCode}</td><td>{emp.inviterId || '-'}</td><td>{emp.newUsers}</td>
                              <td>{emp.paidUsers}</td><td>{fmt(emp.totalAmount, lang)}</td>
                              <td><span className={emp.status === 'active' ? 'statusActive' : 'statusDisabled'}>{emp.status === 'active' ? t(lang, 'status_active') : t(lang, 'status_disabled')}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {staffData && (
                  <section className="dashboardSection">
                    <div className="sectionHead"><div><p className="sectionLabel">{t(lang, 'section_profile')}</p><h2>{t(lang, 'section_my_invite_profile')}</h2></div></div>
                    <div className="profileGrid">
                      <article className="profileCard"><span>{t(lang, 'profile_name')}</span><strong>{staffData.profile.name}</strong></article>
                      <article className="profileCard"><span>{t(lang, 'profile_invite_code')}</span><strong>{staffData.profile.inviteCode}</strong></article>
                      <article className="profileCard"><span>{t(lang, 'profile_inviter_id')}</span><strong>{staffData.profile.inviterId || '-'}</strong></article>
                      <article className="profileCard"><span>{t(lang, 'profile_account_status')}</span><strong>{staffData.profile.status === 'active' ? t(lang, 'status_active') : t(lang, 'status_disabled')}</strong></article>
                      <article className="profileCard"><span>{t(lang, 'profile_username')}</span><strong>{staffData.currentUser.username}</strong></article>
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
                      <div><p className="sectionLabel">{t(lang, 'section_employee_mgmt')}</p><h2>{t(lang, 'section_employee_list')}</h2></div>
                      <button className="addBtn" onClick={() => { setShowAddForm(true); setFormError(''); }}>{t(lang, 'add_employee')}</button>
                    </div>

                    {showAddForm && (
                      <form className="addForm" onSubmit={(e) => void handleAddEmployee(e)}>
                        <h3>{t(lang, 'add_employee_title')}</h3>
                        <div className="formRow">
                          <label className="field"><span>{t(lang, 'field_employee_name')}</span><input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t(lang, 'placeholder_employee_name')} required /></label>
                          <label className="field"><span>{t(lang, 'field_login_username')}</span><input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder={t(lang, 'placeholder_login_username')} required /></label>
                        </div>
                        <div className="formRow">
                          <label className="field"><span>{t(lang, 'field_initial_password')}</span><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={t(lang, 'placeholder_password')} minLength={6} required /></label>
                          <label className="field"><span>{t(lang, 'field_invite_code')}</span><input value={newInviteCode} onChange={(e) => setNewInviteCode(e.target.value)} placeholder={t(lang, 'placeholder_invite_code')} required /></label>
                        </div>
                        <div className="formRow">
                          <label className="field"><span>{t(lang, 'field_inviter_id')}</span><input value={newInviterId} onChange={(e) => setNewInviterId(e.target.value)} placeholder={t(lang, 'placeholder_inviter_id')} /></label>
                        </div>
                        {formError && <p className="formError">{formError}</p>}
                        <div className="formActions">
                          <button type="submit" className="submitBtn" disabled={formLoading}>{formLoading ? t(lang, 'create_loading') : t(lang, 'create_confirm')}</button>
                          <button type="button" className="cancelBtn" onClick={() => setShowAddForm(false)}>{t(lang, 'cancel')}</button>
                        </div>
                      </form>
                    )}

                    <div className="tableWrap">
                      <table className="dataTable">
                        <thead><tr><th>{t(lang, 'th_employee_name')}</th><th>{t(lang, 'th_invite_code')}</th><th>{t(lang, 'th_inviter_id')}</th><th>{t(lang, 'th_new_users')}</th><th>{t(lang, 'th_paid_users')}</th><th>{t(lang, 'th_total_amount')}</th><th>{t(lang, 'th_status')}</th><th>{t(lang, 'th_action')}</th></tr></thead>
                        <tbody>
                          {bossData?.employees.map((emp) => (
                            <tr key={emp.id}>
                              <td>{emp.name}</td><td>{emp.inviteCode}</td><td>{emp.inviterId || '-'}</td><td>{emp.newUsers}</td>
                              <td>{emp.paidUsers}</td><td>{fmt(emp.totalAmount, lang)}</td>
                              <td><span className={emp.status === 'active' ? 'statusActive' : 'statusDisabled'}>{emp.status === 'active' ? t(lang, 'status_active') : t(lang, 'status_disabled')}</span></td>
                              <td>
                                <button className="actionBtn" onClick={() => void handleToggleEmployee(emp.id, emp.status)}>
                                  {emp.status === 'active' ? t(lang, 'action_disable') : t(lang, 'action_enable')}
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
                    <div className="sectionHead"><div><p className="sectionLabel">{t(lang, 'section_tools')}</p><h2>{t(lang, 'section_my_invite')}</h2></div></div>
                    <div className="inviteCodeBox">
                      <span className="inviteCodeLabel">{t(lang, 'my_invite_label')}</span>
                      <strong className="inviteCodeValue">{staffData.profile.inviteCode}</strong>
                    </div>
                    <div className="inviteCodeBox">
                      <span className="inviteCodeLabel">{t(lang, 'th_inviter_id')}</span>
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
                  <div><p className="sectionLabel">{t(lang, 'section_user_detail')}</p><h2>{isBoss ? t(lang, 'section_team_user_recharge') : t(lang, 'section_my_user_recharge')}</h2></div>
                  <button className="addBtn" onClick={() => {
                    const rows = data.users.map((u) => [u.platformUserId, u.employeeName, u.inviteCode, fmtDate(u.bindTime, lang), fmtDate(u.firstRechargeAt, lang), String(u.rechargeCount), String(((Number(u.totalAmount || 0) || 0) / 100).toFixed(2)), fmtDate(u.lastRechargeAt, lang)]);
                    exportCsv(t(lang, 'export_filename'), rows, [t(lang, 'export_h_user_id'), t(lang, 'export_h_employee'), t(lang, 'export_h_invite_code'), t(lang, 'export_h_bind_time'), t(lang, 'export_h_first_recharge'), t(lang, 'export_h_recharge_count'), t(lang, 'export_h_total_amount'), t(lang, 'export_h_last_recharge')]);
                  }}>{t(lang, 'export_csv')}</button>
                </div>

                <div className="filterRow">
                  <label className="filterField"><span>{t(lang, 'filter_start')}</span><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
                  <label className="filterField"><span>{t(lang, 'filter_end')}</span><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
                  {isBoss && bossData && (
                    <label className="filterField">
                      <span>{t(lang, 'filter_employee')}</span>
                      <select className="filterSelect" value={filterEmployee} onChange={(e) => setFilterEmployee(e.target.value)}>
                        <option value="">{t(lang, 'filter_all_employees')}</option>
                        {bossData.employees.map((emp) => (
                          <option key={emp.id} value={emp.name}>{emp.name}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button className="addBtn" onClick={() => { setAppliedStartDate(startDate); setAppliedEndDate(endDate); }}>{t(lang, 'filter_search')}</button>
                  {(startDate || endDate || filterEmployee || appliedStartDate || appliedEndDate) && <button className="cancelBtn" onClick={() => { setStartDate(''); setEndDate(''); setAppliedStartDate(''); setAppliedEndDate(''); setFilterEmployee(''); }}>{t(lang, 'filter_clear')}</button>}
                </div>

                <div className="tableWrap">
                  <table className="dataTable">
                    <thead>
                      <tr>
                        <th>{t(lang, 'export_h_user_id')}</th>
                        {isBoss && <th>{t(lang, 'export_h_employee')}</th>}
                        <th>{t(lang, 'export_h_invite_code')}</th><th>{t(lang, 'export_h_bind_time')}</th><th>{t(lang, 'export_h_first_recharge')}</th><th>{t(lang, 'export_h_recharge_count')}</th><th>{t(lang, 'export_h_total_amount')}</th><th>{t(lang, 'export_h_last_recharge')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.users.filter((u) => !filterEmployee || u.employeeName === filterEmployee).length
                        ? data.users.filter((u) => !filterEmployee || u.employeeName === filterEmployee).map((item) => (
                        <tr key={item.platformUserId}>
                          <td>{item.platformUserId}</td>
                          {isBoss && <td>{item.employeeName}</td>}
                          <td>{item.inviteCode}</td><td>{fmtDate(item.bindTime, lang)}</td>
                          <td>{fmtDate(item.firstRechargeAt, lang)}</td><td>{item.rechargeCount}</td>
                          <td>{fmt(item.totalAmount, lang)}</td><td>{fmtDate(item.lastRechargeAt, lang)}</td>
                        </tr>
                      )) : (
                        <tr><td colSpan={isBoss ? 8 : 7}>{t(lang, 'empty')}</td></tr>
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
