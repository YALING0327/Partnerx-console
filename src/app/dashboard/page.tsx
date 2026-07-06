'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredLang, setStoredLang, t, type Lang } from '@/lib/i18n';
import { authPayload, type DashboardData, type StoredUser, type UserFilters, type View } from './types';
import { formatLastSyncTime } from './utils';
import HomeView from './components/HomeView';
import EmployeesView from './components/EmployeesView';
import UsersView from './components/UsersView';
import BackfillView from './components/BackfillView';
import ChatView from './components/ChatView';

const PAGE_SIZE = 20;

const EMPTY_FILTERS: UserFilters = { startDate: '', endDate: '', employee: '', userIdKeyword: '' };

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [view, setView] = useState<View>('home');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [lang, setLang] = useState<Lang>('zh');

  // 已应用的筛选条件（用户明细 + 首页指标日期），由后端做筛选和分页
  const [filters, setFilters] = useState<UserFilters>(EMPTY_FILTERS);
  const [metricStartDate, setMetricStartDate] = useState('');
  const [metricEndDate, setMetricEndDate] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const raw = localStorage.getItem('partnerx_user');
    if (!raw) { router.replace('/'); return; }
    setUser(JSON.parse(raw) as StoredUser);
  }, [router]);

  useEffect(() => {
    setLang(getStoredLang());
  }, []);

  const loadDashboard = useCallback(async (
    u: StoredUser,
    f: UserFilters,
    msd: string,
    med: string,
    p: number,
    forceRefresh = false
  ) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/dashboard/overview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...authPayload(u),
          startDate: f.startDate || undefined,
          endDate: f.endDate || undefined,
          metricStartDate: msd || undefined,
          metricEndDate: med || undefined,
          filterEmployee: f.employee || undefined,
          userIdKeyword: f.userIdKeyword || undefined,
          page: p,
          pageSize: PAGE_SIZE,
          forceRefresh
        })
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
    if (user) {
      void loadDashboard(user, filters, metricStartDate, metricEndDate, page);
    }
  }, [user, loadDashboard, filters, metricStartDate, metricEndDate, page]);

  function handleApplyFilters(next: UserFilters) {
    setPage(1);
    setFilters(next);
  }

  function handleApplyMetricDates(start: string, end: string) {
    setMetricStartDate(start);
    setMetricEndDate(end);
  }

  const reload = useCallback(async (forceRefresh = false) => {
    if (!user) return;
    await loadDashboard(user, filters, metricStartDate, metricEndDate, page, forceRefresh);
  }, [user, loadDashboard, filters, metricStartDate, metricEndDate, page]);

  function handleLogout() {
    localStorage.removeItem('partnerx_user');
    router.replace('/');
  }

  if (!user) return null;

  const isBoss = user.role === 'boss';
  const bossData = data?.role === 'boss' ? data : null;
  const employees = bossData?.employees ?? [];

  // 聊天记录仅对老板开放
  const navItems: { key: View; label: string }[] = isBoss
    ? [{ key: 'home', label: t(lang, 'nav_home') }, { key: 'employees', label: t(lang, 'nav_employees') }, { key: 'users', label: t(lang, 'nav_users') }, { key: 'backfill', label: t(lang, 'nav_backfill') }, { key: 'chat', label: t(lang, 'nav_chat') }]
    : [{ key: 'home', label: t(lang, 'nav_home') }, { key: 'employees', label: t(lang, 'nav_my_invite') }, { key: 'users', label: t(lang, 'nav_users') }, { key: 'backfill', label: t(lang, 'nav_backfill') }];

  const pageTitle = view === 'home'
    ? (isBoss ? t(lang, 'title_boss_home') : t(lang, 'title_staff_home'))
    : view === 'employees'
    ? (isBoss ? t(lang, 'title_employees') : t(lang, 'title_my_invite'))
    : view === 'backfill'
    ? t(lang, 'title_backfill')
    : view === 'chat'
    ? t(lang, 'title_chat')
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
            <p className="dashboardBreadcrumb">{t(lang, 'last_sync_time')}: {formatLastSyncTime(data?.lastSyncTime ?? null, lang)}</p>
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

        {view === 'chat' ? (
          <ChatView user={user} lang={lang} />
        ) : loading ? (
          <section className="loadingCard">{t(lang, 'loading')}</section>
        ) : error ? (
          <section className="loadingCard">{t(lang, 'load_failed')}：{error}</section>
        ) : !data ? null : (
          <>
            {view === 'home' && (
              <HomeView
                data={data}
                lang={lang}
                isBoss={isBoss}
                appliedMetricStartDate={metricStartDate}
                appliedMetricEndDate={metricEndDate}
                onApplyMetricDates={handleApplyMetricDates}
              />
            )}

            {view === 'employees' && (
              <EmployeesView
                user={user}
                data={data}
                lang={lang}
                isBoss={isBoss}
                onChanged={() => void reload()}
              />
            )}

            {view === 'users' && (
              <UsersView
                user={user}
                lang={lang}
                isBoss={isBoss}
                employees={employees}
                users={data.users}
                totalUsers={data.totalUsers ?? data.users.length}
                pageSize={PAGE_SIZE}
                page={page}
                filters={filters}
                onApplyFilters={handleApplyFilters}
                onPageChange={setPage}
                onRefresh={() => void reload(true)}
              />
            )}

            {view === 'backfill' && (
              <BackfillView
                user={user}
                lang={lang}
                isBoss={isBoss}
                employees={employees}
                onDone={() => reload(true)}
              />
            )}
          </>
        )}
      </section>
    </main>
  );
}
