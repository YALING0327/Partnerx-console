import { supabaseServer } from '@/lib/supabase-server';

export type ChatAuthBody = {
  userId?: string;
  companyId?: string;
  role?: 'boss' | 'staff';
  username?: string;
};

export type EmployeeLite = {
  id: string;
  account_id: string;
  employee_name: string;
  invite_code: string;
  inviter_id: string | null;
  status: string;
};

type AuthOk = { ok: true; companyId: string; role: 'boss' | 'staff'; account: any };
type AuthErr = { ok: false; status: number; error: string };

// 复用 overview/route.ts 的鉴权范式：用 company_accounts 复验登录态。
// opts.requireBoss=true 时仅允许老板(聊天记录功能只对老板开放)。
export async function authenticate(body: ChatAuthBody, opts: { requireBoss?: boolean } = {}): Promise<AuthOk | AuthErr> {
  const { userId, companyId, role, username } = body;
  if (!userId || !companyId || !role || !username) {
    return { ok: false, status: 400, error: '缺少必要参数' };
  }
  const { data: account, error } = await supabaseServer
    .from('company_accounts')
    .select('id, company_id, role, username, status')
    .eq('id', userId)
    .eq('company_id', companyId)
    .eq('username', username)
    .single();
  if (error || !account) return { ok: false, status: 401, error: '登录信息无效，请重新登录' };
  if (account.status !== 'active') return { ok: false, status: 403, error: '账号已停用' };
  if (account.role !== role) return { ok: false, status: 403, error: '角色信息不匹配' };
  if (opts.requireBoss && account.role !== 'boss') return { ok: false, status: 403, error: '无权访问' };
  return { ok: true, companyId, role, account };
}

// 取当前账号可见的员工（boss=本公司全部；staff=仅自己那条，按 account_id 关联）。
export async function getVisibleEmployees(companyId: string, role: 'boss' | 'staff', userId: string): Promise<EmployeeLite[]> {
  let query = supabaseServer
    .from('employees')
    .select('id, account_id, employee_name, invite_code, inviter_id, status')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true });
  if (role === 'staff') {
    query = query.eq('account_id', userId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as EmployeeLite[];
}

// 校验某 inviterId 是否在当前账号可见范围内（防越权查别人/别公司师傅）。
// 返回匹配到的员工，找不到则返回 null。
export async function assertInviterVisible(
  inviterId: string,
  companyId: string,
  role: 'boss' | 'staff',
  userId: string
): Promise<EmployeeLite | null> {
  const emps = await getVisibleEmployees(companyId, role, userId);
  return emps.find((e) => String(e.inviter_id ?? '') === String(inviterId)) ?? null;
}
