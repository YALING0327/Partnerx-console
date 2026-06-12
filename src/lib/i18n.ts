export type Lang = 'zh' | 'en';

export const LANG_STORAGE_KEY = 'partnerx_lang';

export function normalizeLang(value: unknown): Lang {
  return value === 'en' ? 'en' : 'zh';
}

export function getStoredLang(): Lang {
  if (typeof window === 'undefined') return 'zh';
  return normalizeLang(window.localStorage.getItem(LANG_STORAGE_KEY));
}

export function setStoredLang(lang: Lang) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LANG_STORAGE_KEY, lang);
}

const dictionary = {
  zh: {
    language: '语言',
    lang_zh: '中文',
    lang_en: 'English',

    login_title: '伙伴增长控制台',
    login_username: '账号',
    login_password: '密码',
    login_username_placeholder: '请输入账号',
    login_password_placeholder: '请输入密码',
    login_loading: '登录中...',
    login_submit: '登录',
    login_failed: '登录失败',
    network_error: '网络错误，请稍后重试',

    nav_home: '首页',
    nav_employees: '员工与邀请码',
    nav_my_invite: '我的邀请码',
    nav_users: '用户业绩明细',

    title_boss_home: '老板端业绩总览',
    title_staff_home: '员工端个人业绩',
    title_employees: '员工与邀请码',
    title_my_invite: '我的邀请码',
    title_users: '用户业绩明细',

    breadcrumb: '首页 / 伙伴增长控制台',
    role_boss: '企业管理员',
    role_staff: '员工',
    logout: '退出登录',

    loading: '正在加载数据...',
    load_failed: '加载失败',

    stat_new_users: '拉新总人数',
    stat_paid_users: '总付费人数',
    stat_total_amount: '充值总金额',
    stat_arppu: 'ARPPU',
    stat_employee_count: '团队人数',

    section_team_overview: '团队概览',
    section_employee_performance: '员工与邀请码表现',
    th_employee: '员工',
    th_employee_name: '员工姓名',
    th_invite_code: '邀请码',
    th_inviter_id: '邀请人ID',
    th_new_users: '拉新人数',
    th_paid_users: '付费人数',
    th_total_amount: '充值总额',
    th_status: '状态',
    th_action: '操作',

    status_active: '正常',
    status_disabled: '停用',
    action_disable: '停用',
    action_enable: '启用',

    section_profile: '个人信息',
    section_my_invite_profile: '我的邀请码与账户状态',
    profile_name: '员工姓名',
    profile_invite_code: '邀请码',
    profile_inviter_id: '邀请人ID',
    profile_account_status: '账号状态',
    profile_username: '登录账号',

    section_employee_mgmt: '员工管理',
    section_employee_list: '员工列表与邀请码',
    add_employee: '+ 新增员工',
    add_employee_title: '新增员工',
    field_employee_name: '员工姓名',
    field_login_username: '登录账号',
    field_initial_password: '初始密码',
    field_invite_code: '邀请码',
    field_inviter_id: '邀请人ID',
    placeholder_employee_name: '例：张三',
    placeholder_login_username: '例：staff_zhang',
    placeholder_password: '至少 6 位',
    placeholder_invite_code: '例：ZHANG2024',
    placeholder_inviter_id: '例：156938339',
    create_loading: '创建中...',
    create_confirm: '确认创建',
    edit_employee_title: '编辑员工',
    edit_loading: '保存中...',
    edit_confirm: '确认保存',
    action_edit: '编辑',
    placeholder_password_optional: '留空表示不修改',
    cancel: '取消',
    create_failed: '创建失败',

    section_tools: '推广工具',
    section_my_invite: '我的邀请码',
    my_invite_label: '我的专属邀请码',

    section_user_detail: '用户明细',
    section_team_user_recharge: '团队归因用户充值表现',
    section_my_user_recharge: '我拉来的用户及充值表现',
    export_csv: '导出 CSV',
    export_filename: '用户业绩明细.csv',
    export_h_user_id: '用户ID',
    export_h_employee: '归因员工',
    export_h_invite_code: '邀请码',
    export_h_bind_time: '绑定时间',
    export_h_first_recharge: '首次充值时间',
    export_h_recharge_count: '充值笔数',
    export_h_total_amount: '累计充值',
    export_h_last_recharge: '最近充值时间',

    filter_start: '开始日期',
    filter_end: '结束日期',
    filter_employee: '归因员工',
    filter_all_employees: '全部员工',
    filter_search: '查找',
    filter_clear: '清除筛选',
    empty: '暂无数据'
  },
  en: {
    language: 'Language',
    lang_zh: '中文',
    lang_en: 'English',

    login_title: 'Partner Growth Console',
    login_username: 'Username',
    login_password: 'Password',
    login_username_placeholder: 'Enter username',
    login_password_placeholder: 'Enter password',
    login_loading: 'Signing in...',
    login_submit: 'Sign in',
    login_failed: 'Login failed',
    network_error: 'Network error. Please try again later.',

    nav_home: 'Home',
    nav_employees: 'Employees',
    nav_my_invite: 'My Invite',
    nav_users: 'User Details',

    title_boss_home: 'Boss Overview',
    title_staff_home: 'My Performance',
    title_employees: 'Employees',
    title_my_invite: 'My Invite',
    title_users: 'User Details',

    breadcrumb: 'Home / Partner Growth Console',
    role_boss: 'Admin',
    role_staff: 'Staff',
    logout: 'Logout',

    loading: 'Loading...',
    load_failed: 'Load failed',

    stat_new_users: 'New Users',
    stat_paid_users: 'Paid Users',
    stat_total_amount: 'Total Revenue',
    stat_arppu: 'ARPPU',
    stat_employee_count: 'Employees',

    section_team_overview: 'Team Overview',
    section_employee_performance: 'Employee Performance',
    th_employee: 'Employee',
    th_employee_name: 'Name',
    th_invite_code: 'Invite Code',
    th_inviter_id: 'Inviter ID',
    th_new_users: 'New Users',
    th_paid_users: 'Paid Users',
    th_total_amount: 'Revenue',
    th_status: 'Status',
    th_action: 'Action',

    status_active: 'Active',
    status_disabled: 'Disabled',
    action_disable: 'Disable',
    action_enable: 'Enable',

    section_profile: 'Profile',
    section_my_invite_profile: 'Invite & Status',
    profile_name: 'Name',
    profile_invite_code: 'Invite Code',
    profile_inviter_id: 'Inviter ID',
    profile_account_status: 'Status',
    profile_username: 'Login',

    section_employee_mgmt: 'Management',
    section_employee_list: 'Employees',
    add_employee: '+ Add',
    add_employee_title: 'Add Employee',
    field_employee_name: 'Name',
    field_login_username: 'Login',
    field_initial_password: 'Password',
    field_invite_code: 'Invite Code',
    field_inviter_id: 'Inviter ID',
    placeholder_employee_name: 'e.g. Alex',
    placeholder_login_username: 'e.g. staff_alex',
    placeholder_password: 'At least 6 chars',
    placeholder_invite_code: 'e.g. ALEX2026',
    placeholder_inviter_id: 'e.g. 156938339',
    create_loading: 'Creating...',
    create_confirm: 'Create',
    edit_employee_title: 'Edit Employee',
    edit_loading: 'Saving...',
    edit_confirm: 'Save',
    action_edit: 'Edit',
    placeholder_password_optional: 'Leave blank to keep unchanged',
    cancel: 'Cancel',
    create_failed: 'Create failed',

    section_tools: 'Tools',
    section_my_invite: 'My Invite',
    my_invite_label: 'My invite code',

    section_user_detail: 'Users',
    section_team_user_recharge: 'Team user performance',
    section_my_user_recharge: 'My user performance',
    export_csv: 'Export CSV',
    export_filename: 'user-details.csv',
    export_h_user_id: 'User ID',
    export_h_employee: 'Employee',
    export_h_invite_code: 'Invite Code',
    export_h_bind_time: 'Bind Time',
    export_h_first_recharge: 'First Recharge',
    export_h_recharge_count: 'Recharge Count',
    export_h_total_amount: 'Total',
    export_h_last_recharge: 'Last Recharge',

    filter_start: 'Start',
    filter_end: 'End',
    filter_employee: 'Employee',
    filter_all_employees: 'All',
    filter_search: 'Search',
    filter_clear: 'Clear',
    empty: 'No data'
  }
} as const;

export type I18nKey = keyof typeof dictionary.zh;

export function t(lang: Lang, key: I18nKey): string {
  const group = dictionary[lang] ?? dictionary.zh;
  return group[key] ?? dictionary.zh[key] ?? key;
}

export function langLocale(lang: Lang): string {
  return lang === 'en' ? 'en-US' : 'zh-CN';
}

