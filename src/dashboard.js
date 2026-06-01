const http = require("http");
const { URL } = require("url");
const {
  exportWeeklyCsv,
  formatDailyAudit,
  formatTodayPlan,
  formatWeeklySummary,
  logMeal,
  logWorkout,
  summarizeWeek,
  updateCheckIn,
} = require("./coach");
const {
  getUserRecord,
  writeBackup,
  writeState,
  writeTextExport,
} = require("./storage");

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function jsonResponse(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function parseOptionalNumber(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function memberView(userId, record, state) {
  const summary = summarizeWeek(record);
  return {
    userId,
    streak: record.streak,
    profile: record.profile,
    summary,
    latest: {
      checkIns: [...record.checkIns].slice(-8).reverse(),
      workouts: [...record.workouts].slice(-8).reverse(),
      meals: [...record.meals].slice(-10).reverse(),
    },
    dailyAudit: formatDailyAudit(record, state),
    todayPlan: formatTodayPlan(record, state),
    weeklySummary: formatWeeklySummary(userId, record, state),
  };
}

function stateView(state) {
  const members = Object.entries(state.users).map(([userId, record]) => memberView(userId, record, state));
  return {
    meta: state.meta,
    programs: state.programs,
    members,
    counts: {
      users: members.length,
      programs: Object.keys(state.programs || {}).length,
      guildConfigs: Object.keys(state.meta.guilds || {}).length,
      checkIns: members.reduce((total, member) => total + (state.users[member.userId]?.checkIns?.length || 0), 0),
      workouts: members.reduce((total, member) => total + (state.users[member.userId]?.workouts?.length || 0), 0),
      meals: members.reduce((total, member) => total + (state.users[member.userId]?.meals?.length || 0), 0),
    },
  };
}

function renderHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mass Shift Coach Dashboard</title>
  <style>
    :root {
      --bg: #0f1110;
      --surface: #171a18;
      --surface-2: #20251f;
      --surface-3: #283026;
      --ink: #f3f0e8;
      --muted: #a9b0a5;
      --line: #3a4237;
      --accent: #c7f464;
      --accent-2: #55c6a6;
      --danger: #ff7a70;
      --warning: #f4bd50;
      --shadow: 0 18px 60px rgba(0, 0, 0, 0.35);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Avenir Next", "Trebuchet MS", Verdana, sans-serif;
      background:
        linear-gradient(135deg, rgba(199, 244, 100, 0.08), transparent 42%),
        repeating-linear-gradient(90deg, rgba(255,255,255,0.025) 0, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 80px),
        var(--bg);
      color: var(--ink);
    }
    button, input, select, textarea {
      font: inherit;
    }
    button {
      border: 1px solid var(--line);
      background: var(--surface-2);
      color: var(--ink);
      min-height: 36px;
      border-radius: 7px;
      padding: 8px 12px;
      cursor: pointer;
    }
    button:hover { border-color: var(--accent); }
    button.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #15180f;
      font-weight: 800;
    }
    button.ghost {
      background: transparent;
    }
    input, select, textarea {
      width: 100%;
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: #101310;
      color: var(--ink);
      padding: 8px 10px;
    }
    textarea {
      min-height: 72px;
      resize: vertical;
    }
    label {
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
    }
    .layout {
      display: grid;
      grid-template-columns: 300px 1fr;
      min-height: 100vh;
    }
    .sidebar {
      border-right: 1px solid var(--line);
      background: rgba(15, 17, 16, 0.88);
      padding: 20px;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow: auto;
    }
    .brand {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 20px;
    }
    .brand h1 {
      font-size: 22px;
      line-height: 1.05;
      margin: 0;
    }
    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--accent);
      box-shadow: 0 0 16px var(--accent);
      flex: 0 0 auto;
    }
    .toolbar {
      display: grid;
      gap: 10px;
      margin-bottom: 18px;
    }
    .members {
      display: grid;
      gap: 8px;
    }
    .member {
      text-align: left;
      display: grid;
      gap: 4px;
      border-radius: 7px;
    }
    .member.active {
      border-color: var(--accent);
      background: rgba(199, 244, 100, 0.1);
    }
    .member strong {
      overflow-wrap: anywhere;
    }
    .member span {
      color: var(--muted);
      font-size: 12px;
    }
    main {
      padding: 22px;
      overflow: hidden;
    }
    .topline {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
    }
    .topline h2 {
      margin: 0;
      font-size: 28px;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .stat, .panel {
      background: rgba(23, 26, 24, 0.92);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
    }
    .stat {
      padding: 14px;
      min-height: 92px;
    }
    .stat span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .stat strong {
      font-size: 26px;
      overflow-wrap: anywhere;
    }
    .panel {
      padding: 16px;
      min-width: 0;
    }
    .span-2 { grid-column: span 2; }
    .span-3 { grid-column: span 3; }
    .span-4 { grid-column: span 4; }
    .span-6 { grid-column: span 6; }
    .panel h3 {
      margin: 0 0 12px;
      font-size: 16px;
    }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .form-grid .full { grid-column: 1 / -1; }
    .split {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .log {
      display: grid;
      gap: 8px;
      max-height: 280px;
      overflow: auto;
    }
    .log-item {
      border: 1px solid var(--line);
      border-radius: 7px;
      padding: 10px;
      background: rgba(0,0,0,0.12);
    }
    .log-item b {
      display: block;
      font-size: 13px;
      margin-bottom: 4px;
    }
    .log-item span, .empty {
      color: var(--muted);
      font-size: 13px;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.45;
      color: #e7eadf;
    }
    .notice {
      min-height: 22px;
      color: var(--accent);
      font-size: 13px;
    }
    @media (max-width: 920px) {
      .layout { grid-template-columns: 1fr; }
      .sidebar {
        position: relative;
        height: auto;
      }
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .span-2, .span-3, .span-4, .span-6 { grid-column: 1 / -1; }
      .topline { align-items: flex-start; flex-direction: column; }
      .actions { justify-content: flex-start; }
    }
    @media (max-width: 560px) {
      main { padding: 14px; }
      .grid, .form-grid, .split { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <h1>Mass Shift Coach</h1>
        <span class="status-dot" title="Dashboard online"></span>
      </div>
      <div class="toolbar">
        <label>Discord user ID
          <input id="newUserId" placeholder="Paste a member/user ID" />
        </label>
        <button id="addMember" class="primary">Add member</button>
        <button id="refresh" class="ghost">Refresh</button>
      </div>
      <div class="notice" id="notice"></div>
      <h3>Members</h3>
      <div class="members" id="members"></div>
    </aside>
    <main>
      <div class="topline">
        <div>
          <h2 id="title">Control Panel</h2>
          <div class="notice" id="subtitle">Loading local state...</div>
        </div>
        <div class="actions">
          <button id="backup">Create backup</button>
          <button id="export">Export CSV</button>
        </div>
      </div>
      <section class="grid">
        <article class="stat"><span>Tracked users</span><strong id="countUsers">0</strong></article>
        <article class="stat"><span>Check-ins</span><strong id="countCheckIns">0</strong></article>
        <article class="stat"><span>Workouts</span><strong id="countWorkouts">0</strong></article>
        <article class="stat"><span>Meals</span><strong id="countMeals">0</strong></article>
        <article class="stat"><span>Programs</span><strong id="countPrograms">0</strong></article>
        <article class="stat"><span>Configs</span><strong id="countConfigs">0</strong></article>

        <section class="panel span-3">
          <h3>Goals</h3>
          <form id="goalsForm" class="form-grid">
            <label>Target weight
              <input name="targetWeight" type="number" step="0.1" />
            </label>
            <label>Daily calories
              <input name="dailyCalories" type="number" step="1" />
            </label>
            <label>Daily protein
              <input name="dailyProtein" type="number" step="1" />
            </label>
            <label>Workouts/week
              <input name="workoutsPerWeek" type="number" step="1" />
            </label>
            <label>Shakes/day
              <input name="shakesPerDay" type="number" step="1" />
            </label>
            <label>Program
              <select name="programName" id="programSelect"></select>
            </label>
            <button class="primary full" type="submit">Save goals</button>
          </form>
        </section>

        <section class="panel span-3">
          <h3>Weekly Summary</h3>
          <pre id="weeklySummary">Select or add a member.</pre>
        </section>

        <section class="panel span-2">
          <h3>Check-In</h3>
          <form id="checkinForm" class="form-grid">
            <label class="full">Weight
              <input name="weight" type="number" step="0.1" required />
            </label>
            <label class="full">Notes
              <textarea name="notes" placeholder="Energy, sleep, soreness, appetite"></textarea>
            </label>
            <button class="primary full" type="submit">Log check-in</button>
          </form>
        </section>

        <section class="panel span-2">
          <h3>Workout</h3>
          <form id="workoutForm" class="form-grid">
            <label class="full">Training note
              <textarea name="note" required placeholder="Upper push, legs, cardio, etc."></textarea>
            </label>
            <label class="full">Duration minutes
              <input name="durationMinutes" type="number" step="1" />
            </label>
            <button class="primary full" type="submit">Log workout</button>
          </form>
        </section>

        <section class="panel span-2">
          <h3>Meal</h3>
          <form id="mealForm" class="form-grid">
            <label>Type
              <select name="type">
                <option value="meal">Meal</option>
                <option value="shake">Shake</option>
              </select>
            </label>
            <label>Calories
              <input name="calories" type="number" step="1" />
            </label>
            <label>Protein
              <input name="protein" type="number" step="1" />
            </label>
            <label>Note
              <input name="note" placeholder="What went in" />
            </label>
            <button class="primary full" type="submit">Log meal</button>
          </form>
        </section>

        <section class="panel span-3">
          <h3>Daily Audit</h3>
          <pre id="dailyAudit">Select or add a member.</pre>
        </section>

        <section class="panel span-3">
          <h3>Today Plan</h3>
          <pre id="todayPlan">Select or add a member.</pre>
        </section>

        <section class="panel span-2">
          <h3>Check-In Log</h3>
          <div class="log" id="checkinLog"></div>
        </section>
        <section class="panel span-2">
          <h3>Workout Log</h3>
          <div class="log" id="workoutLog"></div>
        </section>
        <section class="panel span-2">
          <h3>Meal Log</h3>
          <div class="log" id="mealLog"></div>
        </section>
      </section>
    </main>
  </div>
  <script>
    const state = { data: null, selectedUserId: null };
    const $ = (id) => document.getElementById(id);

    function showNotice(message, isError = false) {
      $("notice").textContent = message;
      $("notice").style.color = isError ? "var(--danger)" : "var(--accent)";
      if (message) {
        setTimeout(() => {
          if ($("notice").textContent === message) $("notice").textContent = "";
        }, 4500);
      }
    }

    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Request failed");
      }
      return payload;
    }

    function formatDate(value) {
      if (!value) return "-";
      return new Date(value).toLocaleString();
    }

    function renderLog(targetId, items, formatter) {
      const target = $(targetId);
      if (!items.length) {
        target.innerHTML = '<div class="empty">No entries yet.</div>';
        return;
      }
      target.innerHTML = items.map((item) => '<div class="log-item">' + formatter(item) + '</div>').join("");
    }

    function selectedMember() {
      return state.data?.members.find((member) => member.userId === state.selectedUserId) || null;
    }

    function fillGoals(member) {
      const form = $("goalsForm");
      const profile = member?.profile || {};
      form.targetWeight.value = profile.targetWeight ?? "";
      form.dailyCalories.value = profile.dailyCalories ?? "";
      form.dailyProtein.value = profile.dailyProtein ?? "";
      form.workoutsPerWeek.value = profile.workoutsPerWeek ?? "";
      form.shakesPerDay.value = profile.shakesPerDay ?? "";
      form.programName.value = profile.programName || "mass-4-day";
    }

    function render() {
      const data = state.data;
      const members = data.members;
      if (!state.selectedUserId && members.length) {
        state.selectedUserId = members[0].userId;
      }

      $("countUsers").textContent = data.counts.users;
      $("countCheckIns").textContent = data.counts.checkIns;
      $("countWorkouts").textContent = data.counts.workouts;
      $("countMeals").textContent = data.counts.meals;
      $("countPrograms").textContent = data.counts.programs;
      $("countConfigs").textContent = data.counts.guildConfigs;

      $("programSelect").innerHTML = Object.entries(data.programs)
        .map(([key, program]) => '<option value="' + escHtml(key) + '">' + escHtml(program.name) + '</option>')
        .join("");

      $("members").innerHTML = members.length
        ? members.map((member) => {
          const active = member.userId === state.selectedUserId ? " active" : "";
          return '<button class="member' + active + '" data-user-id="' + escHtml(member.userId) + '"><strong>' + escHtml(member.userId) + '</strong><span>' + member.summary.workouts + ' workouts | ' + member.summary.shakes + ' shakes | streak ' + member.streak + '</span></button>';
        }).join("")
        : '<div class="empty">No members tracked yet. Add a Discord user ID or use slash commands in Discord.</div>';

      document.querySelectorAll(".member").forEach((button) => {
        button.addEventListener("click", () => {
          state.selectedUserId = button.dataset.userId;
          render();
        });
      });

      const member = selectedMember();
      $("title").textContent = member ? "Member " + member.userId : "Control Panel";
      $("subtitle").textContent = member
        ? "Latest weight " + (member.summary.latestWeight ?? "-") + " lb | weekly workouts " + member.summary.workouts
        : "Add a member or log from Discord to start tracking.";

      fillGoals(member);
      $("weeklySummary").textContent = member ? member.weeklySummary : "Select or add a member.";
      $("dailyAudit").textContent = member ? member.dailyAudit : "Select or add a member.";
      $("todayPlan").textContent = member ? member.todayPlan : "Select or add a member.";

      renderLog("checkinLog", member?.latest.checkIns || [], (item) =>
        '<b>' + escHtml(formatDate(item.at)) + '</b><span>' + escHtml(item.weight) + ' lb' + (item.notes ? ' | ' + escHtml(item.notes) : '') + '</span>'
      );
      renderLog("workoutLog", member?.latest.workouts || [], (item) =>
        '<b>' + escHtml(formatDate(item.at)) + '</b><span>' + escHtml(item.note) + (item.durationMinutes ? ' | ' + escHtml(item.durationMinutes) + ' min' : '') + '</span>'
      );
      renderLog("mealLog", member?.latest.meals || [], (item) =>
        '<b>' + escHtml(formatDate(item.at)) + ' | ' + escHtml(item.type) + '</b><span>' + (item.calories || 0) + ' kcal | ' + (item.protein || 0) + 'g protein' + (item.note ? ' | ' + escHtml(item.note) : '') + '</span>'
      );
    }

    function escHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    async function load() {
      state.data = await api("/api/state");
      render();
    }

    function requireMember() {
      if (!state.selectedUserId) {
        throw new Error("Select or add a member first");
      }
      return state.selectedUserId;
    }

    async function submitForm(form, action) {
      try {
        await action(new FormData(form));
        form.reset();
        await load();
        showNotice("Saved.");
      } catch (error) {
        showNotice(error.message, true);
      }
    }

    $("refresh").addEventListener("click", () => load().catch((error) => showNotice(error.message, true)));
    $("addMember").addEventListener("click", async () => {
      try {
        const userId = $("newUserId").value.trim();
        if (!userId) throw new Error("Enter a Discord user ID");
        await api("/api/member", { method: "POST", body: JSON.stringify({ userId }) });
        state.selectedUserId = userId;
        $("newUserId").value = "";
        await load();
        showNotice("Member added.");
      } catch (error) {
        showNotice(error.message, true);
      }
    });
    $("backup").addEventListener("click", async () => {
      try {
        const result = await api("/api/backup", { method: "POST", body: "{}" });
        showNotice("Backup created: " + result.filePath);
      } catch (error) {
        showNotice(error.message, true);
      }
    });
    $("export").addEventListener("click", async () => {
      try {
        const result = await api("/api/export", { method: "POST", body: "{}" });
        showNotice("CSV exported: " + result.filePath);
      } catch (error) {
        showNotice(error.message, true);
      }
    });
    $("goalsForm").addEventListener("submit", (event) => {
      event.preventDefault();
      submitForm(event.currentTarget, (form) => api("/api/member/" + encodeURIComponent(requireMember()) + "/goals", {
        method: "POST",
        body: JSON.stringify({
          targetWeight: form.get("targetWeight"),
          dailyCalories: form.get("dailyCalories"),
          dailyProtein: form.get("dailyProtein"),
          workoutsPerWeek: form.get("workoutsPerWeek"),
          shakesPerDay: form.get("shakesPerDay"),
          programName: form.get("programName"),
        }),
      }));
    });
    $("checkinForm").addEventListener("submit", (event) => {
      event.preventDefault();
      submitForm(event.currentTarget, (form) => api("/api/member/" + encodeURIComponent(requireMember()) + "/checkin", {
        method: "POST",
        body: JSON.stringify({ weight: form.get("weight"), notes: form.get("notes") }),
      }));
    });
    $("workoutForm").addEventListener("submit", (event) => {
      event.preventDefault();
      submitForm(event.currentTarget, (form) => api("/api/member/" + encodeURIComponent(requireMember()) + "/workout", {
        method: "POST",
        body: JSON.stringify({ note: form.get("note"), durationMinutes: form.get("durationMinutes") }),
      }));
    });
    $("mealForm").addEventListener("submit", (event) => {
      event.preventDefault();
      submitForm(event.currentTarget, (form) => api("/api/member/" + encodeURIComponent(requireMember()) + "/meal", {
        method: "POST",
        body: JSON.stringify({
          type: form.get("type"),
          calories: form.get("calories"),
          protein: form.get("protein"),
          note: form.get("note"),
        }),
      }));
    });

    load().catch((error) => showNotice(error.message, true));
  </script>
</body>
</html>`;
}

async function handleApi(req, res, state, url) {
  if (req.method === "GET" && url.pathname === "/api/state") {
    jsonResponse(res, 200, stateView(state));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/member") {
    const body = await readBody(req);
    const userId = String(body.userId || "").trim();
    if (!userId) {
      jsonResponse(res, 400, { error: "Missing userId" });
      return true;
    }
    getUserRecord(state, userId);
    writeState(state);
    jsonResponse(res, 201, { member: memberView(userId, state.users[userId], state) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/backup") {
    const filePath = writeBackup(state);
    jsonResponse(res, 200, { filePath });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/export") {
    const filePath = writeTextExport("weekly-export", exportWeeklyCsv(state));
    jsonResponse(res, 200, { filePath });
    return true;
  }

  const memberMatch = url.pathname.match(/^\/api\/member\/([^/]+)(?:\/([^/]+))?$/);
  if (!memberMatch) {
    return false;
  }

  const userId = decodeURIComponent(memberMatch[1]);
  const action = memberMatch[2];
  const record = getUserRecord(state, userId);

  if (req.method === "GET" && !action) {
    jsonResponse(res, 200, { member: memberView(userId, record, state) });
    return true;
  }

  if (req.method !== "POST") {
    jsonResponse(res, 405, { error: "Method not allowed" });
    return true;
  }

  const body = await readBody(req);
  if (action === "goals") {
    record.profile.targetWeight = parseOptionalNumber(body.targetWeight);
    record.profile.dailyCalories = parseOptionalNumber(body.dailyCalories);
    record.profile.dailyProtein = parseOptionalNumber(body.dailyProtein);
    record.profile.workoutsPerWeek = parseOptionalNumber(body.workoutsPerWeek);
    record.profile.shakesPerDay = parseOptionalNumber(body.shakesPerDay);
    record.profile.programName = state.programs[body.programName] ? body.programName : "mass-4-day";
  } else if (action === "checkin") {
    const weight = parseOptionalNumber(body.weight);
    if (!weight) {
      jsonResponse(res, 400, { error: "Weight is required" });
      return true;
    }
    updateCheckIn(record, weight, body.notes || "");
  } else if (action === "workout") {
    const note = String(body.note || "").trim();
    if (!note) {
      jsonResponse(res, 400, { error: "Workout note is required" });
      return true;
    }
    logWorkout(record, note, parseOptionalNumber(body.durationMinutes));
  } else if (action === "meal") {
    const type = body.type === "shake" ? "shake" : "meal";
    logMeal(
      record,
      type,
      parseOptionalNumber(body.calories),
      parseOptionalNumber(body.protein),
      body.note || ""
    );
  } else {
    jsonResponse(res, 404, { error: "Unknown member action" });
    return true;
  }

  writeState(state);
  jsonResponse(res, 200, { member: memberView(userId, record, state) });
  return true;
}

function startDashboard(readState, port) {
  const server = http.createServer(async (req, res) => {
    try {
      const state = readState();
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith("/api/")) {
        const handled = await handleApi(req, res, state, url);
        if (!handled) {
          jsonResponse(res, 404, { error: "Not found" });
        }
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderHtml());
    } catch (error) {
      jsonResponse(res, 500, { error: error.message });
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Dashboard listening on http://127.0.0.1:${port}`);
  });

  return server;
}

module.exports = { startDashboard };
