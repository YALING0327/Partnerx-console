'use client';

import { useEffect, useState } from 'react';
import { t, type Lang } from '@/lib/i18n';
import { authPayload, type BossEmployee, type DashboardUser, type StoredUser, type UserFilters, type UserSortBy } from '../types';
import { exportCsv, fmt, fmtDate, platformLabel, postJson } from '../utils';

type Props = {
  user: StoredUser;
  lang: Lang;
  isBoss: boolean;
  employees: BossEmployee[];
  users: DashboardUser[];
  totalUsers: number;
  pageSize: number;
  page: number;
  filters: UserFilters;
  onApplyFilters: (next: UserFilters) => void;
  onPageChange: (page: number) => void;
  onRefresh: () => void;
};

export default function UsersView({ user, lang, isBoss, employees, users, totalUsers, pageSize, page, filters, onApplyFilters, onPageChange, onRefresh }: Props) {
  const [userIdKeyword, setUserIdKeyword] = useState(filters.userIdKeyword);
  const [startDate, setStartDate] = useState(filters.startDate);
  const [endDate, setEndDate] = useState(filters.endDate);
  const [filterEmployee, setFilterEmployee] = useState(filters.employee);
  const [sortBy, setSortBy] = useState<UserSortBy>(filters.sortBy);
  const [userNicknames, setUserNicknames] = useState<Record<string, string>>({});
  const [nicknamesLoading, setNicknamesLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const totalPages = Math.max(Math.ceil(totalUsers / pageSize), 1);
  const pageUserIdsKey = users.map((u) => String(u.platformUserId)).join(',');

  // 当前页用户的昵称补全（SelectDB 反查，仅查本页）
  useEffect(() => {
    const platformUserIds = users.map((item) => String(item.platformUserId)).filter(Boolean);
    if (platformUserIds.length === 0) return;

    let cancelled = false;
    setNicknamesLoading(true);

    void fetch('/api/dashboard/user-nicknames', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...authPayload(user), platformUserIds })
    })
      .then(async (res) => {
        const result = await res.json() as { error?: string; nicknames?: Record<string, string> };
        if (!res.ok || cancelled) return;
        setUserNicknames((current) => ({ ...current, ...(result.nicknames ?? {}) }));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setNicknamesLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageUserIdsKey]);

  function applyFilters() {
    onApplyFilters({ userIdKeyword, startDate, endDate, employee: filterEmployee, sortBy });
  }

  // 排序选项一变即生效，不需要额外点“查找”
  function handleSortChange(next: UserSortBy) {
    setSortBy(next);
    onApplyFilters({ userIdKeyword, startDate, endDate, employee: filterEmployee, sortBy: next });
  }

  function clearFilters() {
    setUserIdKeyword('');
    setStartDate('');
    setEndDate('');
    setFilterEmployee('');
    setSortBy('');
    onApplyFilters({ userIdKeyword: '', startDate: '', endDate: '', employee: '', sortBy: '' });
  }

  async function handleExport() {
    setExporting(true);
    try {
      // 导出需要筛选后的全部用户，单独请求一次（服务端 30s 缓存命中，代价小）
      const result = await postJson<{ users?: DashboardUser[]; error?: string }>('/api/dashboard/overview', {
        ...authPayload(user),
        startDate: filters.startDate || undefined,
        endDate: filters.endDate || undefined,
        filterEmployee: filters.employee || undefined,
        userIdKeyword: filters.userIdKeyword || undefined,
        sortBy: filters.sortBy || undefined,
        includeAllUsers: true
      });
      const allUsers = result.users ?? [];

      const rows = allUsers.map((u) => [
        u.platformUserId,
        isBoss ? u.employeeName : '',
        u.inviteCode,
        u.source === 'adjust' ? (lang === 'zh' ? 'Adjust链接' : 'Adjust Link') : (lang === 'zh' ? '邀请码' : 'Invite Code'),
        platformLabel(u.appPlatform, lang).replace(/^[^\s]+\s/, ''),
        fmtDate(u.bindTime),
        fmtDate(u.firstRechargeAt),
        String(u.rechargeCount),
        String(((Number(u.totalAmount || 0) || 0) / 100).toFixed(2)),
        fmtDate(u.lastRechargeAt)
      ].filter(Boolean));

      const headers = [
        t(lang, 'export_h_user_id'),
        isBoss ? t(lang, 'export_h_employee') : '',
        t(lang, 'export_h_invite_code'),
        lang === 'zh' ? '来源' : 'Source',
        t(lang, 'th_platform'),
        t(lang, 'export_h_bind_time'),
        t(lang, 'export_h_first_recharge'),
        t(lang, 'export_h_recharge_count'),
        t(lang, 'export_h_total_amount'),
        t(lang, 'export_h_last_recharge')
      ].filter(Boolean);

      exportCsv(t(lang, 'export_filename'), rows, headers as string[]);
    } catch { /* 导出失败静默，保持原行为 */ }
    finally { setExporting(false); }
  }

  return (
    <section className="dashboardSection">
      <div className="sectionHead">
        <div><p className="sectionLabel">{t(lang, 'section_user_detail')}</p><h2>{isBoss ? t(lang, 'section_team_user_recharge') : t(lang, 'section_my_user_recharge')}</h2></div>
        <button className="addBtn" onClick={() => void handleExport()} disabled={exporting}>{t(lang, 'export_csv')}</button>
      </div>

      <div className="filterRow">
        <label className="filterField">
          <span>{t(lang, 'filter_user_id')}</span>
          <input
            value={userIdKeyword}
            onChange={(e) => setUserIdKeyword(e.target.value)}
            placeholder={t(lang, 'placeholder_user_id')}
          />
        </label>
        <label className="filterField"><span>{t(lang, 'filter_start')}</span><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
        <label className="filterField"><span>{t(lang, 'filter_end')}</span><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
        {isBoss && (
          <label className="filterField">
            <span>{t(lang, 'filter_employee')}</span>
            <select className="filterSelect" value={filterEmployee} onChange={(e) => setFilterEmployee(e.target.value)}>
              <option value="">{t(lang, 'filter_all_employees')}</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.name}>{emp.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="filterField">
          <span>{t(lang, 'filter_sort')}</span>
          <select className="filterSelect" value={sortBy} onChange={(e) => handleSortChange(e.target.value as UserSortBy)}>
            <option value="">{t(lang, 'sort_default')}</option>
            <option value="amountDesc">{t(lang, 'sort_amount_desc')}</option>
            <option value="amountAsc">{t(lang, 'sort_amount_asc')}</option>
          </select>
        </label>
        <button className="addBtn" onClick={applyFilters}>{t(lang, 'filter_search')}</button>
        <button className="actionBtn" onClick={onRefresh}>{t(lang, 'filter_refresh')}</button>
        {(userIdKeyword || startDate || endDate || filterEmployee || sortBy || filters.userIdKeyword || filters.startDate || filters.endDate || filters.employee || filters.sortBy) && (
          <button className="cancelBtn" onClick={clearFilters}>{t(lang, 'filter_clear')}</button>
        )}
      </div>

      <div className="tableWrap">
        <table className="dataTable">
          <thead>
            <tr>
              <th>{t(lang, 'export_h_user_id')}</th>
              <th>{t(lang, 'th_nickname')}</th>
              {isBoss && <th>{t(lang, 'export_h_employee')}</th>}
              <th>{t(lang, 'export_h_invite_code')}</th><th>{lang === 'zh' ? '来源' : 'Source'}</th><th>{t(lang, 'th_platform')}</th><th>{t(lang, 'export_h_bind_time')}</th><th>{t(lang, 'export_h_first_recharge')}</th><th>{t(lang, 'export_h_recharge_count')}</th><th>{t(lang, 'export_h_total_amount')}</th><th>{t(lang, 'export_h_last_recharge')}</th>
            </tr>
          </thead>
          <tbody>
            {users.length
              ? users.map((item) => (
              <tr key={item.platformUserId}>
                <td>{item.platformUserId}</td>
                <td>{userNicknames[item.platformUserId] ?? (nicknamesLoading ? '...' : '-')}</td>
                {isBoss && <td>{item.employeeName}</td>}
                <td>{item.inviteCode}</td>
                <td>
                  <span style={{
                    display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 12, whiteSpace: 'nowrap',
                    background: item.source === 'adjust' ? 'rgba(124,92,214,0.15)' : 'rgba(52,211,153,0.15)',
                    color: item.source === 'adjust' ? '#7c5cd6' : '#10b981',
                    border: item.source === 'adjust' ? '1px solid rgba(124,92,214,0.4)' : '1px solid rgba(52,211,153,0.4)'
                  }}>
                    {item.source === 'adjust' ? (lang === 'zh' ? 'Adjust链接' : 'Adjust Link') : (lang === 'zh' ? '邀请码' : 'Invite Code')}
                  </span>
                </td>
                <td>{platformLabel(item.appPlatform, lang)}</td>
                <td>{fmtDate(item.bindTime)}</td>
                <td>{fmtDate(item.firstRechargeAt)}</td><td>{item.rechargeCount}</td>
                <td>{fmt(item.totalAmount, lang)}</td><td>{fmtDate(item.lastRechargeAt)}</td>
              </tr>
            )) : (
              <tr><td colSpan={isBoss ? 11 : 10}>{t(lang, 'empty')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button
            disabled={page === 1}
            onClick={() => onPageChange(page - 1)}
          >
            {lang === 'zh' ? '上一页' : 'Prev'}
          </button>
          <span>{page} / {totalPages}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            {lang === 'zh' ? '下一页' : 'Next'}
          </button>
        </div>
      )}
    </section>
  );
}
