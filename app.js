const companies = [
  {
    id: "c1",
    name: "Nova Reach Media",
    owner: "Daniel Chen",
  },
  {
    id: "c2",
    name: "BlueWave Partners",
    owner: "Mila Jordan",
  },
];

const employees = [
  {
    id: "e1",
    name: "Sofia",
    companyId: "c1",
    companyName: "Nova Reach Media",
    inviteCode: "SOFIA88",
    status: "active",
    team: "欧洲渠道组",
  },
  {
    id: "e2",
    name: "Liam",
    companyId: "c1",
    companyName: "Nova Reach Media",
    inviteCode: "LIAM66",
    status: "active",
    team: "东南亚投放组",
  },
  {
    id: "e3",
    name: "Emma",
    companyId: "c2",
    companyName: "BlueWave Partners",
    inviteCode: "EMMA55",
    status: "pending",
    team: "北美联盟组",
  },
];

const users = [
  {
    id: "U100271",
    employeeId: "e1",
    companyId: "c1",
    country: "Germany",
    firstRechargeTime: "2026-05-03 10:16",
    firstRechargeDate: "2026-05-03",
    lastRechargeTime: "2026-05-18 21:40",
    amount: 1280,
    rechargeCount: 4,
    source: "邀请码",
  },
  {
    id: "U100394",
    employeeId: "e1",
    companyId: "c1",
    country: "France",
    firstRechargeTime: "2026-05-08 13:12",
    firstRechargeDate: "2026-05-08",
    lastRechargeTime: "2026-05-09 08:20",
    amount: 460,
    rechargeCount: 2,
    source: "邀请码",
  },
  {
    id: "U100511",
    employeeId: "e1",
    companyId: "c1",
    country: "Italy",
    firstRechargeTime: "2026-05-12 20:08",
    firstRechargeDate: "2026-05-12",
    lastRechargeTime: "2026-05-17 10:04",
    amount: 860,
    rechargeCount: 3,
    source: "邀请码",
  },
  {
    id: "U200109",
    employeeId: "e2",
    companyId: "c1",
    country: "Thailand",
    firstRechargeTime: "2026-05-05 15:11",
    firstRechargeDate: "2026-05-05",
    lastRechargeTime: "2026-05-16 19:30",
    amount: 920,
    rechargeCount: 4,
    source: "邀请码",
  },
  {
    id: "U200258",
    employeeId: "e2",
    companyId: "c1",
    country: "Vietnam",
    firstRechargeTime: "2026-05-15 11:37",
    firstRechargeDate: "2026-05-15",
    lastRechargeTime: "2026-05-15 11:37",
    amount: 300,
    rechargeCount: 1,
    source: "邀请码",
  },
  {
    id: "U200377",
    employeeId: "e2",
    companyId: "c1",
    country: "Malaysia",
    firstRechargeTime: "2026-05-17 09:25",
    firstRechargeDate: "2026-05-17",
    lastRechargeTime: "2026-05-18 23:10",
    amount: 670,
    rechargeCount: 2,
    source: "邀请码",
  },
  {
    id: "U300043",
    employeeId: "e3",
    companyId: "c2",
    country: "United States",
    firstRechargeTime: "2026-05-04 09:42",
    firstRechargeDate: "2026-05-04",
    lastRechargeTime: "2026-05-13 18:09",
    amount: 1450,
    rechargeCount: 5,
    source: "邀请码",
  },
  {
    id: "U300311",
    employeeId: "e3",
    companyId: "c2",
    country: "Canada",
    firstRechargeTime: "2026-05-14 17:55",
    firstRechargeDate: "2026-05-14",
    lastRechargeTime: "2026-05-16 22:45",
    amount: 520,
    rechargeCount: 2,
    source: "邀请码",
  },
];

const state = {
  isLoggedIn: false,
  loginRole: "boss",
  role: "boss",
  activeSection: "dashboard",
  currentCompanyId: "c1",
  selectedEmployeeId: "all",
  currentStaffId: "e1",
  startDate: "",
  endDate: "",
};

const loginScreen = document.getElementById("loginScreen");
const appShell = document.getElementById("appShell");
const loginRoleButtons = Array.from(document.querySelectorAll(".login-role-card"));
const loginButton = document.getElementById("loginButton");
const loginUsername = document.getElementById("loginUsername");
const loginPassword = document.getElementById("loginPassword");
const logoutButton = document.getElementById("logoutButton");
const pageTitle = document.getElementById("pageTitle");
const roleBadge = document.getElementById("roleBadge");
const filterBoard = document.getElementById("filterBoard");
const filterDescription = document.getElementById("filterDescription");
const employeeFilterWrap = document.getElementById("employeeFilterWrap");

const bossView = document.getElementById("bossView");
const staffView = document.getElementById("staffView");
const employeeFilter = document.getElementById("employeeFilter");
const startDateInput = document.getElementById("startDate");
const endDateInput = document.getElementById("endDate");
const resetFiltersBtn = document.getElementById("resetFilters");
const menuButtons = Array.from(document.querySelectorAll(".sidebar-menu-item"));

const bossStats = document.getElementById("bossStats");
const staffStats = document.getElementById("staffStats");
const teamCards = document.getElementById("teamCards");
const employeeTableBody = document.getElementById("employeeTableBody");
const userTableBody = document.getElementById("userTableBody");
const staffUserTableBody = document.getElementById("staffUserTableBody");
const staffProfile = document.getElementById("staffProfile");
const toolCards = document.getElementById("toolCards");
const employeeForm = document.getElementById("employeeForm");

function formatCurrency(value) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function buildEmployeeOptions() {
  const candidateEmployees = employees.filter((employee) => {
    if (state.role === "staff") {
      return employee.id === state.currentStaffId;
    }
    return employee.companyId === state.currentCompanyId;
  });

  employeeFilter.innerHTML = [
    '<option value="all">全部员工</option>',
    ...candidateEmployees.map(
      (employee) => `<option value="${employee.id}">${employee.name} · ${employee.companyName}</option>`
    ),
  ].join("");

  if (state.role === "staff") {
    employeeFilter.value = state.currentStaffId;
    employeeFilter.disabled = true;
  } else {
    if (!candidateEmployees.some((employee) => employee.id === state.selectedEmployeeId)) {
      state.selectedEmployeeId = "all";
    }
    employeeFilter.value = state.selectedEmployeeId;
    employeeFilter.disabled = false;
  }
}

function isWithinDateRange(dateText) {
  const date = new Date(dateText);
  const start = state.startDate ? new Date(state.startDate) : null;
  const end = state.endDate ? new Date(`${state.endDate}T23:59:59`) : null;

  if (start && date < start) {
    return false;
  }
  if (end && date > end) {
    return false;
  }
  return true;
}

function getVisibleUsers() {
  return users.filter((user) => {
    if (state.role === "staff" && user.employeeId !== state.currentStaffId) {
      return false;
    }
    if (state.role === "boss" && user.companyId !== state.currentCompanyId) {
      return false;
    }
    if (state.role === "staff") {
      const currentEmployee = employees.find((employee) => employee.id === state.currentStaffId);
      if (currentEmployee && user.companyId !== currentEmployee.companyId) {
        return false;
      }
    }
    if (state.selectedEmployeeId !== "all" && user.employeeId !== state.selectedEmployeeId) {
      return false;
    }
    return isWithinDateRange(user.firstRechargeDate);
  });
}

function getVisibleEmployees() {
  return employees.filter((employee) => {
    if (state.role === "staff") {
      return employee.id === state.currentStaffId;
    }
    if (employee.companyId !== state.currentCompanyId) {
      return false;
    }
    if (state.selectedEmployeeId !== "all" && employee.id !== state.selectedEmployeeId) {
      return false;
    }
    return true;
  });
}

function computeMetrics(userList) {
  const totalUsers = userList.length;
  const totalRecharge = userList.reduce((sum, user) => sum + user.amount, 0);
  const paidUsers = userList.filter((user) => user.amount > 0).length;
  const firstRechargeUsers = userList.filter((user) => user.rechargeCount >= 1).length;
  const avgRecharge = paidUsers ? Math.round(totalRecharge / paidUsers) : 0;

  return {
    totalUsers,
    totalRecharge,
    paidUsers,
    firstRechargeUsers,
    avgRecharge,
  };
}

function getEmployeeMetrics(employeeId) {
  return computeMetrics(users.filter((user) => user.employeeId === employeeId && isWithinDateRange(user.firstRechargeDate)));
}

function renderStats(container, metrics, mode) {
  const statItems =
    mode === "boss"
      ? [
          { title: "拉新总人数", value: metrics.totalUsers, desc: "当前筛选范围内已归因用户" },
          { title: "总付费人数", value: metrics.paidUsers, desc: "至少产生过 1 次充值的用户" },
          { title: "充值总金额", value: formatCurrency(metrics.totalRecharge), desc: "基于当前筛选时间范围汇总" },
          { title: "ARPPU", value: formatCurrency(metrics.avgRecharge), desc: "付费用户人均充值金额" },
        ]
      : [
          { title: "我的拉新人数", value: metrics.totalUsers, desc: "通过我的邀请码归因" },
          { title: "我的付费人数", value: metrics.paidUsers, desc: "当前时间范围内有充值行为" },
          { title: "我的充值总额", value: formatCurrency(metrics.totalRecharge), desc: "当前时间范围内的累计充值金额" },
          { title: "我的首充人数", value: metrics.firstRechargeUsers, desc: "首次充值已发生的用户数" },
        ];

  container.innerHTML = statItems
    .map(
      (item) => `
        <article class="metric-card">
          <p class="metric-title">${item.title}</p>
          <div class="metric-value">${item.value}</div>
          <p class="metric-desc">${item.desc}</p>
        </article>
      `
    )
    .join("");
}

function renderTeamCards() {
  const currentEmployees = employees.filter((employee) => employee.companyId === state.currentCompanyId);
  teamCards.innerHTML = currentEmployees
    .map((employee) => {
      const metrics = getEmployeeMetrics(employee.id);
      const statusClass = employee.status === "active" ? "active" : "pending";
      const statusText = employee.status === "active" ? "已启用" : "待审核";

      return `
        <article class="company-card">
          <div class="company-card-main">
            <div>
              <strong>${employee.name}</strong>
              <p>${employee.team} · 邀请码 ${employee.inviteCode}</p>
            </div>
            <span class="status ${statusClass}">${statusText}</span>
          </div>
          <div class="company-metrics">
            <div>
              <p>拉新人数</p>
              <strong>${metrics.totalUsers}</strong>
            </div>
            <div>
              <p>付费人数</p>
              <strong>${metrics.paidUsers}</strong>
            </div>
            <div>
              <p>充值总额</p>
              <strong>${formatCurrency(metrics.totalRecharge)}</strong>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderEmployeeTable() {
  const visibleEmployees = getVisibleEmployees();

  employeeTableBody.innerHTML = visibleEmployees
    .map((employee) => {
      const metrics = getEmployeeMetrics(employee.id);
      const statusClass = employee.status === "active" ? "active" : "pending";
      const statusText = employee.status === "active" ? "已启用" : "待审核";

      return `
        <tr>
          <td>${employee.name}<br /><small>${employee.team}</small></td>
          <td>${employee.inviteCode}</td>
          <td>${metrics.totalUsers}</td>
          <td>${metrics.paidUsers}</td>
          <td>${formatCurrency(metrics.totalRecharge)}</td>
          <td><span class="status ${statusClass}">${statusText}</span></td>
        </tr>
      `;
    })
    .join("");
}

function renderUserTable(container, userList, isStaffTable = false) {
  if (!userList.length) {
    container.innerHTML = `<tr><td colspan="${isStaffTable ? 7 : 8}" class="empty-hint">当前筛选条件下暂无数据</td></tr>`;
    return;
  }

  container.innerHTML = userList
    .map((user) => {
      const employee = employees.find((item) => item.id === user.employeeId);
      const status = user.rechargeCount >= 2 ? "活跃付费" : "首充用户";

      if (isStaffTable) {
        return `
          <tr>
            <td>${user.id}</td>
            <td>${user.country}</td>
            <td>${user.firstRechargeTime}</td>
            <td>${formatCurrency(user.amount)}</td>
            <td>${user.rechargeCount}</td>
            <td>${user.lastRechargeTime}</td>
            <td><span class="status active">${status}</span></td>
          </tr>
        `;
      }

      return `
        <tr>
          <td>${user.id}</td>
          <td>${employee ? employee.name : "-"}</td>
          <td>${user.source}</td>
          <td>${user.country}</td>
          <td>${user.firstRechargeTime}</td>
          <td>${user.rechargeCount}</td>
          <td>${formatCurrency(user.amount)}</td>
          <td>${user.lastRechargeTime}</td>
        </tr>
      `;
    })
    .join("");
}

function renderStaffProfile() {
  const employee = employees.find((item) => item.id === state.currentStaffId);
  if (!employee) {
    staffProfile.innerHTML = "";
    toolCards.innerHTML = "";
    return;
  }

  staffProfile.innerHTML = `
    <dt>员工姓名</dt><dd>${employee.name}</dd>
    <dt>所属公司</dt><dd>${employee.companyName}</dd>
    <dt>团队</dt><dd>${employee.team}</dd>
    <dt>邀请码</dt><dd>${employee.inviteCode}</dd>
    <dt>账号状态</dt><dd>${employee.status === "active" ? "已启用" : "待审核"}</dd>
  `;

  toolCards.innerHTML = `
    <article class="tool-card">
      <h4>邀请码</h4>
      <strong>${employee.inviteCode}</strong>
      <p>用户注册时填写邀请码后，系统将自动完成归因。</p>
    </article>
    <article class="tool-card">
      <h4>归因规则</h4>
      <strong>邀请码归因</strong>
      <p>用户成功绑定邀请码后，后续充值数据将归属到当前员工名下。</p>
    </article>
  `;
}

function updateSectionVisibility() {
  document.querySelectorAll(".section-card").forEach((section) => {
    const rolePanel = state.role === "boss" ? bossView : staffView;
    const isCurrentRoleSection = rolePanel.contains(section);
    section.classList.toggle("visible", isCurrentRoleSection && section.dataset.section === state.activeSection);
  });

  menuButtons.forEach((button) => {
    const roles = (button.dataset.role || "").split(",");
    const shouldShow = roles.includes(state.role);
    button.classList.toggle("hidden", !shouldShow);
    button.classList.toggle("active", shouldShow && button.dataset.section === state.activeSection);
  });
}

function updatePageTitle() {
  const titleMap = {
    dashboard: state.role === "boss" ? "老板端业绩总览" : "员工端个人业绩总览",
    employees: state.role === "boss" ? "员工与邀请码管理" : "我的邀请码",
    users: state.role === "boss" ? "老板端用户业绩明细" : "员工端用户业绩明细",
  };

  pageTitle.textContent = titleMap[state.activeSection] || "伙伴增长控制台";
  roleBadge.textContent = state.role === "boss" ? "企业管理员" : "员工账户";
}

function renderLoginState() {
  loginScreen.classList.toggle("hidden", state.isLoggedIn);
  appShell.classList.toggle("hidden", !state.isLoggedIn);

  loginRoleButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.loginRole === state.loginRole);
  });

  if (state.loginRole === "boss") {
    loginUsername.placeholder = "请输入企业管理员账号";
  } else {
    loginUsername.placeholder = "请输入员工账号";
  }
  loginPassword.placeholder = "请输入密码";

  if (!state.isLoggedIn) {
    loginUsername.value = "";
    loginPassword.value = "";
  }
}

function render() {
  renderLoginState();
  if (!state.isLoggedIn) {
    return;
  }

  buildEmployeeOptions();

  const visibleUsers = getVisibleUsers();
  const metrics = computeMetrics(visibleUsers);

  renderStats(bossStats, metrics, "boss");
  renderStats(staffStats, metrics, "staff");
  renderTeamCards();
  renderEmployeeTable();
  renderUserTable(userTableBody, visibleUsers, false);
  renderUserTable(staffUserTableBody, visibleUsers, true);
  renderStaffProfile();
  updateSectionVisibility();
  updatePageTitle();

  filterBoard.classList.toggle("hidden", state.activeSection !== "users");
  employeeFilterWrap.classList.toggle("hidden", state.role === "staff");
  filterDescription.textContent = state.role === "boss"
    ? "按时间和员工查看指定周期内的拉新与充值业绩"
    : "按时间查看指定周期内的拉新与充值业绩";

  bossView.classList.toggle("visible", state.role === "boss");
  staffView.classList.toggle("visible", state.role === "staff");
}

function resetFilters() {
  state.startDate = "";
  state.endDate = "";
  state.selectedEmployeeId = state.role === "staff" ? state.currentStaffId : "all";

  startDateInput.value = "";
  endDateInput.value = "";
  render();
}

employeeFilter.addEventListener("change", (event) => {
  state.selectedEmployeeId = event.target.value;
  render();
});

startDateInput.addEventListener("change", (event) => {
  state.startDate = event.target.value;
  render();
});

endDateInput.addEventListener("change", (event) => {
  state.endDate = event.target.value;
  render();
});

resetFiltersBtn.addEventListener("click", resetFilters);

menuButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.activeSection = button.dataset.section;
    render();
  });
});

loginRoleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.loginRole = button.dataset.loginRole;
    renderLoginState();
  });
});

loginButton.addEventListener("click", () => {
  if (!loginUsername.value.trim() || !loginPassword.value.trim()) {
    window.alert("请输入账号和密码。");
    return;
  }

  state.isLoggedIn = true;
  state.role = state.loginRole;
  state.activeSection = "dashboard";
  state.currentCompanyId = state.role === "staff"
    ? employees.find((employee) => employee.id === state.currentStaffId)?.companyId || "c1"
    : "c1";
  state.selectedEmployeeId = state.role === "staff" ? state.currentStaffId : "all";
  render();
});

logoutButton.addEventListener("click", () => {
  state.isLoggedIn = false;
  render();
});

employeeForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = document.getElementById("newEmployeeName").value.trim();
  const inviteCode = document.getElementById("newEmployeeCode").value.trim();

  if (!name || !inviteCode) {
    window.alert("请填写完整的员工姓名和邀请码。");
    return;
  }

  const targetCompany = companies.find((company) => company.id === state.currentCompanyId);
  const newEmployee = {
    id: `e${employees.length + 1}`,
    name,
    companyId: targetCompany ? targetCompany.id : "c1",
    companyName: targetCompany ? targetCompany.name : "Nova Reach Media",
    inviteCode,
    status: "pending",
    team: "新增待分组",
  };

  employees.push(newEmployee);
  employeeForm.reset();
  state.activeSection = "employees";
  render();
});

startDateInput.value = state.startDate;
endDateInput.value = state.endDate;
render();
