'use client';

import { useState } from 'react';
import { t, type Lang } from '@/lib/i18n';
import type { DashboardData } from '../types';
import { fmt, recentRangeYmd } from '../utils';

type Props = {
  data: DashboardData;
  lang: Lang;
  isBoss: boolean;
  appliedMetricStartDate: string;
  appliedMetricEndDate: string;
  onApplyMetricDates: (start: string, end: string) => void;
};

export default function HomeView({ data, lang, isBoss, appliedMetricStartDate, appliedMetricEndDate, onApplyMetricDates }: Props) {
  const [metricStartDate, setMetricStartDate] = useState(appliedMetricStartDate);
  const [metricEndDate, setMetricEndDate] = useState(appliedMetricEndDate);

  const bossData = data.role === 'boss' ? data : null;
  const staffData = data.role === 'staff' ? data : null;

  function applyRecentDays(days: number) {
    const { start, end } = recentRangeYmd(days);
    setMetricStartDate(start);
    setMetricEndDate(end);
    onApplyMetricDates(start, end);
  }

  return (
    <>
      <section className="dashboardSection">
        <div className="sectionHead">
          <div>
            <p className="sectionLabel">{isBoss ? t(lang, 'home_filter_title') : t(lang, 'amount_query_title')}</p>
            <h2>{isBoss ? t(lang, 'home_filter_title') : t(lang, 'amount_query_title')}</h2>
          </div>
        </div>
        <div className="filterRow">
          <label className="filterField"><span>{t(lang, 'filter_start')}</span><input type="date" value={metricStartDate} onChange={(e) => setMetricStartDate(e.target.value)} /></label>
          <label className="filterField"><span>{t(lang, 'filter_end')}</span><input type="date" value={metricEndDate} onChange={(e) => setMetricEndDate(e.target.value)} /></label>
          <button className="addBtn" onClick={() => onApplyMetricDates(metricStartDate, metricEndDate)}>{t(lang, 'filter_search')}</button>
          {(metricStartDate || metricEndDate || appliedMetricStartDate || appliedMetricEndDate) && (
            <button className="cancelBtn" onClick={() => {
              setMetricStartDate('');
              setMetricEndDate('');
              onApplyMetricDates('', '');
            }}>{t(lang, 'filter_clear')}</button>
          )}
        </div>
        <div className="filterRow">
          <button className="actionBtn" onClick={() => applyRecentDays(1)}>{t(lang, 'quick_today')}</button>
          <button className="actionBtn" onClick={() => applyRecentDays(7)}>{t(lang, 'quick_7d')}</button>
          <button className="actionBtn" onClick={() => applyRecentDays(30)}>{t(lang, 'quick_30d')}</button>
          <button className="actionBtn" onClick={() => applyRecentDays(90)}>{t(lang, 'quick_90d')}</button>
        </div>
        <p className="dashboardBreadcrumb">{isBoss ? t(lang, 'home_filter_hint') : t(lang, 'amount_query_hint')}</p>
      </section>

      <section className={`statsGrid ${isBoss ? 'boss-grid' : 'staff-grid'}`}>
        <article className="statCard"><span>{t(lang, 'stat_merged_users')}</span><strong>{data.summary.mergedUsers}</strong></article>
        <article className="statCard"><span>{t(lang, 'stat_invite_users')}</span><strong>{data.summary.inviteUsers}</strong></article>
        <article className="statCard"><span>{t(lang, 'stat_adjust_users')}</span><strong>{data.summary.adjustUsers}</strong></article>
        <article className="statCard"><span>{t(lang, 'stat_paid_users')}</span><strong>{data.summary.paidUsers}</strong></article>
        <article className="statCard"><span>{t(lang, 'stat_android_users')}</span><strong>🤖 {data.summary.androidUsers ?? 0}</strong></article>
        <article className="statCard"><span>{t(lang, 'stat_ios_users')}</span><strong>🍎 {data.summary.iosUsers ?? 0}</strong></article>
        <article className="statCard statCardAmount"><span>{t(lang, 'stat_total_amount')}</span><strong>{fmt(data.summary.totalAmount, lang)}</strong></article>
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
              <thead><tr><th>{t(lang, 'th_employee')}</th><th>{t(lang, 'th_invite_code')}</th><th>{t(lang, 'th_inviter_id')}</th><th>{t(lang, 'th_merged_users')}</th><th>{t(lang, 'th_invite_users')}</th><th>{t(lang, 'th_adjust_users')}</th><th>{t(lang, 'th_paid_users')}</th><th>{t(lang, 'th_total_amount')}</th><th>{t(lang, 'th_status')}</th></tr></thead>
              <tbody>
                {bossData.employees.map((emp) => (
                  <tr key={emp.id}>
                    <td>{emp.name}</td><td>{emp.inviteCode}</td><td>{emp.inviterId || '-'}</td><td>{emp.mergedUsers}</td><td>{emp.inviteUsers}</td><td>{emp.adjustUsers}</td>
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
        <>
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

          {staffData.todayTeamStats && staffData.todayTeamStats.length > 0 && (
            <section className="dashboardSection">
              <div className="sectionHead">
                <div>
                  <p className="sectionLabel">{t(lang, 'section_team_today')}</p>
                  <h2>{t(lang, 'section_team_today_title')}</h2>
                </div>
              </div>
              <p className="dashboardBreadcrumb">{t(lang, 'section_team_today_hint')}</p>
              <div className="tableWrap">
                <table className="dataTable">
                  <thead>
                    <tr>
                      <th>{t(lang, 'th_rank')}</th>
                      <th>{t(lang, 'th_employee_name')}</th>
                      <th>{t(lang, 'th_today_paid_users')}</th>
                      <th>{t(lang, 'th_today_total_amount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffData.todayTeamStats.map((emp, idx) => (
                      <tr key={emp.name} className={emp.name === staffData.profile.name ? 'highlightRow' : ''}>
                        <td>
                          <strong style={{
                            color: idx === 0 ? '#d4af37' : idx === 1 ? '#c0c0c0' : idx === 2 ? '#cd7f32' : 'inherit',
                            fontSize: idx < 3 ? '1.1em' : 'inherit'
                          }}>
                            {idx + 1}
                          </strong>
                        </td>
                        <td>
                          <strong>{emp.name}</strong>
                          {emp.name === staffData.profile.name && <span style={{ marginLeft: 8, color: 'var(--primary)', fontSize: '0.85em' }}>({t(lang, 'label_me')})</span>}
                        </td>
                        <td>{emp.paidUsers}</td>
                        <td><strong>{fmt(emp.totalAmount, lang)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
