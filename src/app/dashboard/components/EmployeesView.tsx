'use client';

import { useState } from 'react';
import { t, type Lang } from '@/lib/i18n';
import type { BossEmployee, DashboardData, StoredUser } from '../types';
import { fmt } from '../utils';

type Props = {
  user: StoredUser;
  data: DashboardData;
  lang: Lang;
  isBoss: boolean;
  onChanged: () => void;
};

export default function EmployeesView({ user, data, lang, isBoss, onChanged }: Props) {
  const bossData = data.role === 'boss' ? data : null;
  const staffData = data.role === 'staff' ? data : null;

  // 新建员工表单
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newInviteCode, setNewInviteCode] = useState('');
  const [newInviterId, setNewInviterId] = useState('');
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  // 编辑员工表单
  const [editingEmployee, setEditingEmployee] = useState<BossEmployee | null>(null);
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editInviteCode, setEditInviteCode] = useState('');
  const [editInviterId, setEditInviterId] = useState('');
  const [editFormError, setEditFormError] = useState('');
  const [editFormLoading, setEditFormLoading] = useState(false);

  const requester = {
    requesterId: user.id,
    requesterCompanyId: user.companyId,
    requesterRole: user.role
  };

  async function handleAddEmployee(e: React.FormEvent) {
    e.preventDefault();
    setFormLoading(true);
    setFormError('');
    try {
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...requester,
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
      onChanged();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleToggleEmployee(employeeId: string, currentStatus: string) {
    const action = currentStatus === 'active' ? 'disable' : 'enable';
    await fetch('/api/employees', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...requester, employeeId, action })
    });
    onChanged();
  }

  async function handleEditEmployee(e: React.FormEvent) {
    e.preventDefault();
    if (!editingEmployee) return;
    setEditFormLoading(true);
    setEditFormError('');
    try {
      const res = await fetch('/api/employees', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...requester,
          employeeId: editingEmployee.id,
          employeeName: editName,
          username: editUsername,
          password: editPassword || undefined,
          inviteCode: editInviteCode,
          inviterId: editInviterId
        })
      });
      const result = await res.json() as { message?: string; error?: string };
      if (!res.ok) { setEditFormError(result.error ?? '修改失败'); return; }
      setEditingEmployee(null);
      onChanged();
    } catch (e) {
      setEditFormError(e instanceof Error ? e.message : '修改失败');
    } finally {
      setEditFormLoading(false);
    }
  }

  function openEditForm(emp: BossEmployee) {
    setEditingEmployee(emp);
    setEditName(emp.name);
    setEditUsername(emp.username || '');
    setEditPassword(''); // 留空表示不修改
    setEditInviteCode(emp.inviteCode);
    setEditInviterId(emp.inviterId || '');
    setEditFormError('');
    setShowAddForm(false);
  }

  return (
    <section className="dashboardSection">
      {isBoss ? (
        <>
          <div className="sectionHead">
            <div><p className="sectionLabel">{t(lang, 'section_employee_mgmt')}</p><h2>{t(lang, 'section_employee_list')}</h2></div>
            <button className="addBtn" onClick={() => { setShowAddForm(true); setFormError(''); setEditingEmployee(null); }}>{t(lang, 'add_employee')}</button>
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

          {editingEmployee && (
            <form className="addForm" onSubmit={(e) => void handleEditEmployee(e)}>
              <h3>{t(lang, 'edit_employee_title')}</h3>
              <div className="formRow">
                <label className="field"><span>{t(lang, 'field_employee_name')}</span><input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={t(lang, 'placeholder_employee_name')} required /></label>
                <label className="field"><span>{t(lang, 'field_login_username')}</span><input value={editUsername} onChange={(e) => setEditUsername(e.target.value)} placeholder={t(lang, 'placeholder_login_username')} required /></label>
              </div>
              <div className="formRow">
                <label className="field"><span>{t(lang, 'field_initial_password')}</span><input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder={t(lang, 'placeholder_password_optional')} minLength={6} /></label>
                <label className="field"><span>{t(lang, 'field_invite_code')}</span><input value={editInviteCode} onChange={(e) => setEditInviteCode(e.target.value)} placeholder={t(lang, 'placeholder_invite_code')} required /></label>
              </div>
              <div className="formRow">
                <label className="field"><span>{t(lang, 'field_inviter_id')}</span><input value={editInviterId} onChange={(e) => setEditInviterId(e.target.value)} placeholder={t(lang, 'placeholder_inviter_id')} /></label>
              </div>
              {editFormError && <p className="formError">{editFormError}</p>}
              <div className="formActions">
                <button type="submit" className="submitBtn" disabled={editFormLoading}>{editFormLoading ? t(lang, 'edit_loading') : t(lang, 'edit_confirm')}</button>
                <button type="button" className="cancelBtn" onClick={() => setEditingEmployee(null)}>{t(lang, 'cancel')}</button>
              </div>
            </form>
          )}

          <div className="tableWrap">
            <table className="dataTable">
              <thead><tr><th>{t(lang, 'th_employee_name')}</th><th>{t(lang, 'th_invite_code')}</th><th>{t(lang, 'th_inviter_id')}</th><th>{t(lang, 'th_merged_users')}</th><th>{t(lang, 'th_invite_users')}</th><th>{t(lang, 'th_adjust_users')}</th><th>{t(lang, 'th_paid_users')}</th><th>{t(lang, 'th_total_amount')}</th><th>{t(lang, 'th_status')}</th><th>{t(lang, 'th_action')}</th></tr></thead>
              <tbody>
                {bossData?.employees.map((emp) => (
                  <tr key={emp.id}>
                    <td>{emp.name}</td><td>{emp.inviteCode}</td><td>{emp.inviterId || '-'}</td><td>{emp.mergedUsers}</td><td>{emp.inviteUsers}</td><td>{emp.adjustUsers}</td>
                    <td>{emp.paidUsers}</td><td>{fmt(emp.totalAmount, lang)}</td>
                    <td><span className={emp.status === 'active' ? 'statusActive' : 'statusDisabled'}>{emp.status === 'active' ? t(lang, 'status_active') : t(lang, 'status_disabled')}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="actionBtn" onClick={() => openEditForm(emp)}>
                          {t(lang, 'action_edit')}
                        </button>
                        <button className="actionBtn" onClick={() => void handleToggleEmployee(emp.id, emp.status)}>
                          {emp.status === 'active' ? t(lang, 'action_disable') : t(lang, 'action_enable')}
                        </button>
                      </div>
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
  );
}
