'use client';

import { useEffect, useState } from 'react';
import { t, type Lang } from '@/lib/i18n';
import { authPayload, type BackfillMode, type BossEmployee, type StoredUser } from '../types';

type Props = {
  user: StoredUser;
  lang: Lang;
  isBoss: boolean;
  employees: BossEmployee[];
  onDone: () => Promise<void> | void;
};

export default function BackfillView({ user, lang, isBoss, employees, onDone }: Props) {
  const [mode, setMode] = useState<BackfillMode>('employee');
  const [employeeId, setEmployeeId] = useState('');
  const [recentMinutes, setRecentMinutes] = useState('15');
  const [targetUserId, setTargetUserId] = useState('');
  const [orderNo, setOrderNo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (employees.length === 0) return;
    if (!employeeId || !employees.some((item) => item.id === employeeId)) {
      setEmployeeId(employees[0].id);
    }
  }, [employees, employeeId]);

  async function handleBackfill() {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const payload: Record<string, unknown> = { ...authPayload(user), mode };

      if (mode === 'employee') {
        payload.employeeId = employeeId || undefined;
        payload.recentMinutes = Number(recentMinutes || 15);
      } else if (mode === 'user') {
        payload.targetUserId = targetUserId.trim();
      } else {
        payload.orderNo = orderNo.trim();
      }

      const res = await fetch('/api/dashboard/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await res.json() as { error?: string; message?: string; counts?: { attribution: number; recharge: number } };
      if (!res.ok) {
        setError(result.error ?? t(lang, 'load_failed'));
        return;
      }

      const detail = result.counts
        ? `，归因 ${result.counts.attribution} 条，充值 ${result.counts.recharge} 条`
        : '';
      setSuccess(`${result.message ?? t(lang, 'backfill_success')}${detail}`);
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, 'load_failed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="dashboardSection">
      <div className="sectionHead">
        <div><p className="sectionLabel">{t(lang, 'backfill_title')}</p><h2>{t(lang, 'backfill_title')}</h2></div>
      </div>
      <p className="dashboardBreadcrumb">{t(lang, 'backfill_hint')}</p>
      <div className="filterRow">
        <label className="filterField">
          <span>{t(lang, 'backfill_mode')}</span>
          <select className="filterSelect" value={mode} onChange={(e) => setMode((e.target.value as BackfillMode) || 'employee')}>
            <option value="employee">{t(lang, 'backfill_mode_employee')}</option>
            <option value="user">{t(lang, 'backfill_mode_user')}</option>
            <option value="order">{t(lang, 'backfill_mode_order')}</option>
          </select>
        </label>
        {mode === 'employee' && isBoss && employees.length > 0 && (
          <label className="filterField">
            <span>{t(lang, 'backfill_employee')}</span>
            <select className="filterSelect" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.name}</option>
              ))}
            </select>
          </label>
        )}
        {mode === 'employee' && (
          <label className="filterField">
            <span>{t(lang, 'backfill_recent_minutes')}</span>
            <input type="number" min="1" max="60" value={recentMinutes} onChange={(e) => setRecentMinutes(e.target.value)} />
          </label>
        )}
        {mode === 'user' && (
          <label className="filterField">
            <span>{t(lang, 'filter_user_id')}</span>
            <input value={targetUserId} onChange={(e) => setTargetUserId(e.target.value)} placeholder={t(lang, 'placeholder_user_id')} />
          </label>
        )}
        {mode === 'order' && (
          <label className="filterField">
            <span>{t(lang, 'backfill_order_no')}</span>
            <input value={orderNo} onChange={(e) => setOrderNo(e.target.value)} placeholder={t(lang, 'placeholder_order_no')} />
          </label>
        )}
        <button className="addBtn" onClick={() => void handleBackfill()} disabled={loading}>
          {loading ? t(lang, 'backfill_loading') : t(lang, 'backfill_submit')}
        </button>
      </div>
      {error && <p className="formError">{error}</p>}
      {success && <p className="formSuccess">{success}</p>}
    </section>
  );
}
