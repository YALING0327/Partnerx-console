export type StoredUser = {
  id: string;
  companyId: string;
  role: 'boss' | 'staff';
  username: string;
  name: string | null;
  companyName?: string | null;
};

export type BossEmployee = {
  id: string;
  name: string;
  username: string;
  inviteCode: string;
  inviterId: string | null;
  status: string;
  newUsers: number;
  mergedUsers: number;
  inviteUsers: number;
  adjustUsers: number;
  paidUsers: number;
  androidUsers?: number;
  iosUsers?: number;
  totalAmount: number;
  arppu: number;
};

export type DashboardUser = {
  platformUserId: string;
  employeeName: string;
  inviteCode: string;
  bindTime: string | null;
  source?: 'adjust' | 'invite';
  appPlatform?: 'android' | 'ios' | 'unknown';
  firstRechargeAt: string | null;
  lastRechargeAt: string | null;
  rechargeCount: number;
  totalAmount: number;
};

export type TeamTodayStat = {
  name: string;
  paidUsers: number;
  totalAmount: number;
};

type SummaryBase = {
  newUsers: number;
  mergedUsers: number;
  inviteUsers: number;
  adjustUsers: number;
  paidUsers: number;
  androidUsers: number;
  iosUsers: number;
  totalAmount: number;
  arppu: number;
};

export type DashboardData =
  | {
      role: 'boss';
      companyName?: string | null;
      currentUser: { name: string | null; username: string };
      lastSyncTime: string | null;
      summary: SummaryBase & { employeeCount: number };
      employees: BossEmployee[];
      users: DashboardUser[];
      totalUsers: number;
    }
  | {
      role: 'staff';
      companyName?: string | null;
      currentUser: { name: string | null; username: string };
      lastSyncTime: string | null;
      summary: SummaryBase;
      profile: { name: string; inviteCode: string; inviterId: string | null; status: string };
      todayTeamStats?: TeamTodayStat[];
      users: DashboardUser[];
      totalUsers: number;
    };

export type View = 'home' | 'employees' | 'users' | 'backfill' | 'chat';
export type BackfillMode = 'employee' | 'user' | 'order';

// 用户明细的「已应用」筛选条件（发给后端做服务端筛选+分页）
export type UserFilters = {
  startDate: string;
  endDate: string;
  employee: string;
  userIdKeyword: string;
};

export function authPayload(user: StoredUser) {
  return { userId: user.id, companyId: user.companyId, role: user.role, username: user.username };
}
