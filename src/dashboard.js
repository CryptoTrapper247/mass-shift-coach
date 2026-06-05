const http = require("http");
const crypto = require("crypto");
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
  appendAuditLog,
  getUserRecord,
  readAuditLog,
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

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function requestActor(req) {
  return {
    ip: req.socket.remoteAddress,
    userAgent: req.headers["user-agent"] || "",
  };
}

function dashboardAuth(req, res, adminPassword) {
  if (!adminPassword) {
    return true;
  }

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) {
    res.writeHead(401, {
      "Content-Type": "text/plain; charset=utf-8",
      "WWW-Authenticate": 'Basic realm="Mass Shift Coach"',
    });
    res.end("Dashboard password required.");
    return false;
  }

  let decoded = "";
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch (error) {
    decoded = "";
  }

  const separator = decoded.indexOf(":");
  const password = separator >= 0 ? decoded.slice(separator + 1) : "";
  if (safeEqual(password, adminPassword)) {
    return true;
  }

  appendAuditLog({
    source: "dashboard",
    action: "auth-failed",
    actor: requestActor(req),
  });
  res.writeHead(401, {
    "Content-Type": "text/plain; charset=utf-8",
    "WWW-Authenticate": 'Basic realm="Mass Shift Coach"',
  });
  res.end("Invalid dashboard password.");
  return false;
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

function memberLabel(userId, record) {
  return record.displayName || `Member ${userId}`;
}

function logCollectionName(type) {
  return {
    checkin: "checkIns",
    workout: "workouts",
    meal: "meals",
  }[type];
}

function refreshRecordStats(record) {
  const checkIns = [...record.checkIns].sort((a, b) => new Date(a.at) - new Date(b.at));
  const workouts = [...record.workouts].sort((a, b) => new Date(a.at) - new Date(b.at));
  const meals = [...record.meals].sort((a, b) => new Date(a.at) - new Date(b.at));

  record.lastCheckInDate = checkIns.length ? String(checkIns[checkIns.length - 1].at).slice(0, 10) : null;
  record.lastWorkoutAt = workouts.length ? workouts[workouts.length - 1].at : null;
  record.lastMealAt = meals.length ? meals[meals.length - 1].at : null;
  record.planProgressIndex = workouts.length;

  const uniqueDates = [...new Set(checkIns.map((entry) => String(entry.at).slice(0, 10)))].sort().reverse();
  let streak = 0;
  let cursor = new Date();
  for (const dateKey of uniqueDates) {
    const expected = cursor.toISOString().slice(0, 10);
    if (dateKey !== expected) {
      break;
    }
    streak += 1;
    cursor = new Date(cursor.getTime() - 86400000);
  }
  record.streak = streak;
}

function memberView(userId, record, state) {
  const summary = summarizeWeek(record);
  return {
    userId,
    displayName: record.displayName || "",
    label: memberLabel(userId, record),
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
    weeklySummary: formatWeeklySummary(memberLabel(userId, record), record, state),
  };
}

function stateView(state) {
  const members = Object.entries(state.users).map(([userId, record]) => memberView(userId, record, state));
  return {
    meta: state.meta,
    programs: state.programs,
    activity: readAuditLog(30),
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

function healthView(health, state) {
  const snapshot = health ? health() : {};
  return {
    ok: Boolean(snapshot.ready),
    ready: Boolean(snapshot.ready),
    botTag: snapshot.botTag || null,
    guilds: snapshot.guilds || 0,
    uptimeSeconds: Math.round(process.uptime()),
    members: Object.keys(state.users || {}).length,
    checkedAt: new Date().toISOString(),
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
      --bg: #050505;
      --surface: #0d120d;
      --surface-2: #152014;
      --surface-3: #20341d;
      --ink: #f4ffe8;
      --muted: #aebca8;
      --line: #30412c;
      --line-strong: #638456;
      --accent: #b8ff3d;
      --accent-2: #50d77a;
      --danger: #ff7a70;
      --warning: #d7ff63;
      --shadow: 0 28px 90px rgba(0, 0, 0, 0.48);
      --soft-shadow: 0 16px 44px rgba(0, 0, 0, 0.32);
      --glow: 0 0 34px rgba(184, 255, 61, 0.2);
      --radius: 20px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Avenir Next", "Trebuchet MS", Verdana, sans-serif;
      background:
        radial-gradient(circle at 16% 10%, rgba(184, 255, 61, 0.18), transparent 26%),
        radial-gradient(circle at 88% 2%, rgba(80, 215, 122, 0.12), transparent 24%),
        linear-gradient(135deg, rgba(184, 255, 61, 0.055), transparent 38%),
        repeating-linear-gradient(135deg, rgba(184, 255, 61, 0.035) 0, rgba(184, 255, 61, 0.035) 1px, transparent 1px, transparent 14px),
        linear-gradient(115deg, transparent 0 46%, rgba(184, 255, 61, 0.035) 46% 48%, transparent 48% 100%),
        repeating-linear-gradient(90deg, rgba(255,255,255,0.018) 0, rgba(255,255,255,0.018) 1px, transparent 1px, transparent 92px),
        var(--bg);
      color: var(--ink);
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(90deg, rgba(184, 255, 61, 0.08), transparent 18%, transparent 82%, rgba(184, 255, 61, 0.06)),
        radial-gradient(circle at 50% -20%, rgba(255,255,255,0.08), transparent 38%);
      mix-blend-mode: screen;
      opacity: 0.55;
    }
    button, input, select, textarea {
      font: inherit;
    }
    button {
      border: 1px solid var(--line);
      background:
        linear-gradient(180deg, rgba(184, 255, 61, 0.08), rgba(0,0,0,0.08)),
        var(--surface-2);
      color: var(--ink);
      min-height: 40px;
      border-radius: 12px;
      padding: 9px 13px;
      cursor: pointer;
      transition: border-color 140ms ease, transform 140ms ease, background 140ms ease, box-shadow 140ms ease;
    }
    button:hover {
      border-color: var(--accent);
      transform: translateY(-1px);
      box-shadow: 0 10px 26px rgba(184, 255, 61, 0.12);
    }
    button.primary {
      background: linear-gradient(135deg, #d8ff78, var(--accent) 54%, #50d77a);
      border-color: var(--accent);
      color: #071007;
      font-weight: 900;
      box-shadow: 0 13px 34px rgba(184, 255, 61, 0.24);
    }
    button.ghost {
      background: transparent;
    }
    input, select, textarea {
      width: 100%;
      min-height: 42px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: rgba(2, 2, 2, 0.76);
      color: var(--ink);
      padding: 10px 12px;
      outline: none;
      transition: border-color 140ms ease, box-shadow 140ms ease;
    }
    input:focus, select:focus, textarea:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(184, 255, 61, 0.16), var(--glow);
    }
    textarea {
      min-height: 72px;
      resize: vertical;
    }
    label {
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .layout {
      display: grid;
      grid-template-columns: 320px 1fr;
      min-height: 100vh;
    }
    .sidebar {
      border-right: 1px solid var(--line);
      background:
        linear-gradient(180deg, rgba(17, 16, 12, 0.96), rgba(5, 5, 5, 0.98)),
        repeating-linear-gradient(135deg, rgba(184, 255, 61, 0.045) 0, rgba(184, 255, 61, 0.045) 1px, transparent 1px, transparent 12px),
        rgba(5, 5, 5, 0.94);
      backdrop-filter: blur(18px);
      padding: 24px;
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
      font-size: 24px;
      line-height: 1.05;
      margin: 0;
      letter-spacing: -0.04em;
    }
    .brand h1::after {
      content: "GROW MODE";
      display: block;
      width: fit-content;
      margin-top: 7px;
      padding: 4px 8px;
      border: 1px solid rgba(184, 255, 61, 0.34);
      border-radius: 999px;
      color: var(--accent);
      font-size: 10px;
      letter-spacing: 0.16em;
    }
    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--accent);
      box-shadow: 0 0 16px var(--accent), 0 0 42px rgba(184, 255, 61, 0.28);
      flex: 0 0 auto;
    }
    .toolbar {
      display: grid;
      gap: 10px;
      margin-bottom: 20px;
    }
    .side-section-title {
      color: var(--muted);
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin: 24px 0 10px;
    }
    .members {
      display: grid;
      gap: 8px;
    }
    .member {
      text-align: left;
      display: grid;
      gap: 4px;
      border-radius: 14px;
      padding: 12px;
      position: relative;
      overflow: hidden;
    }
    .member::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: 4px;
      background: linear-gradient(180deg, var(--accent), transparent);
      opacity: 0;
      transition: opacity 140ms ease;
    }
    .member.active {
      border-color: var(--accent);
      background: rgba(184, 255, 61, 0.12);
    }
    .member.active::before, .member:hover::before {
      opacity: 1;
    }
    .member strong {
      overflow-wrap: anywhere;
    }
    .member span {
      color: var(--muted);
      font-size: 12px;
    }
    main {
      padding: 28px;
      overflow: hidden;
      position: relative;
    }
    main::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: linear-gradient(180deg, rgba(184, 255, 61, 0.065), transparent 220px);
    }
    main > * {
      position: relative;
      z-index: 1;
    }
    .topline {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
    }
    .kicker {
      color: var(--accent);
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      margin-bottom: 7px;
    }
    .topline h2 {
      margin: 0;
      font-size: clamp(30px, 4vw, 54px);
      line-height: 0.94;
      letter-spacing: -0.065em;
      text-shadow: 0 16px 44px rgba(0, 0, 0, 0.42);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 11px;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--muted);
      background: rgba(12, 11, 7, 0.84);
      font-size: 12px;
      font-weight: 800;
    }
    .status-pill.online {
      color: var(--accent);
      border-color: rgba(184, 255, 61, 0.5);
      box-shadow: var(--glow);
    }
    .ops-bar {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 16px;
    }
    .ops-item {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background:
        linear-gradient(145deg, rgba(184, 255, 61, 0.08), rgba(255,255,255,0.01)),
        rgba(12, 11, 7, 0.82);
      padding: 12px 14px;
      box-shadow: var(--soft-shadow);
      transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
    }
    .ops-item:hover {
      transform: translateY(-2px);
      border-color: rgba(184, 255, 61, 0.5);
      box-shadow: var(--shadow), var(--glow);
    }
    .ops-item span {
      display: block;
      color: var(--muted);
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    .ops-item strong {
      font-size: 14px;
      overflow-wrap: anywhere;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .stat, .panel {
      background:
        linear-gradient(145deg, rgba(184, 255, 61, 0.085), rgba(255,255,255,0.012) 42%, rgba(0,0,0,0.18)),
        rgba(12, 11, 7, 0.92);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      transition: transform 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
    }
    .stat:hover, .panel:hover {
      transform: translateY(-2px);
      border-color: rgba(184, 255, 61, 0.46);
      box-shadow: var(--shadow), var(--glow);
    }
    .stat {
      padding: 16px;
      min-height: 92px;
      position: relative;
      overflow: hidden;
    }
    .stat::after {
      content: "";
      position: absolute;
      inset: auto 14px 12px auto;
      width: 44px;
      height: 3px;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--accent), transparent);
      opacity: 0.72;
    }
    .stat::before {
      content: "";
      position: absolute;
      inset: auto 14px 18px 14px;
      height: 1px;
      background: linear-gradient(90deg, rgba(184,255,61,0.86), rgba(184,255,61,0.08));
      opacity: 0.52;
    }
    .stat span {
      display: block;
      color: var(--muted);
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .stat strong {
      font-size: 36px;
      letter-spacing: -0.04em;
      overflow-wrap: anywhere;
    }
    .panel {
      padding: 18px;
      min-width: 0;
      position: relative;
      overflow: hidden;
    }
    .panel::before {
      content: "";
      position: absolute;
      inset: 0 0 auto;
      height: 3px;
      background: linear-gradient(90deg, var(--accent), rgba(80, 215, 122, 0.2), transparent);
      opacity: 0.78;
    }
    .span-2 { grid-column: span 2; }
    .span-3 { grid-column: span 3; }
    .span-4 { grid-column: span 4; }
    .span-6 { grid-column: span 6; }
    .panel h3 {
      margin: 0 0 14px;
      font-size: 17px;
      letter-spacing: -0.025em;
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
      border-radius: 14px;
      padding: 10px;
      background:
        linear-gradient(90deg, rgba(184, 255, 61, 0.06), transparent 32%),
        rgba(0,0,0,0.2);
      transition: border-color 140ms ease, transform 140ms ease;
    }
    .log-item:hover {
      border-color: rgba(184, 255, 61, 0.45);
      transform: translateX(2px);
    }
    .log-item b {
      display: block;
      font-size: 13px;
      margin-bottom: 4px;
    }
    .log-actions {
      display: flex;
      gap: 7px;
      margin-top: 8px;
    }
    .log-actions button {
      min-height: 28px;
      padding: 5px 9px;
      font-size: 12px;
    }
    .danger {
      border-color: rgba(255, 122, 112, 0.42);
      color: var(--danger);
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
      color: #eaffd2;
      font-size: 13px;
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
      .ops-bar { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .span-2, .span-3, .span-4, .span-6 { grid-column: 1 / -1; }
      .topline { align-items: flex-start; flex-direction: column; }
      .actions { justify-content: flex-start; }
    }
    @media (max-width: 560px) {
      main { padding: 14px; }
      .grid, .form-grid, .split, .ops-bar { grid-template-columns: 1fr; }
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
      <div class="side-section-title">Members</div>
      <div class="members" id="members"></div>
    </aside>
    <main>
      <div class="topline">
        <div>
          <div class="kicker">Operations Console</div>
          <h2 id="title">Control Panel</h2>
          <div class="notice" id="subtitle">Loading local state...</div>
        </div>
        <div class="actions">
          <span class="status-pill" id="healthStatus">Checking health</span>
          <button id="backup">Create backup</button>
          <button id="export">Export CSV</button>
        </div>
      </div>
      <section class="ops-bar">
        <article class="ops-item"><span>Bot</span><strong id="opsBot">Checking...</strong></article>
        <article class="ops-item"><span>Uptime</span><strong id="opsUptime">-</strong></article>
        <article class="ops-item"><span>Guilds</span><strong id="opsGuilds">-</strong></article>
        <article class="ops-item"><span>Last check</span><strong id="opsChecked">-</strong></article>
      </section>
      <section class="grid">
        <article class="stat"><span>Tracked users</span><strong id="countUsers">0</strong></article>
        <article class="stat"><span>Check-ins</span><strong id="countCheckIns">0</strong></article>
        <article class="stat"><span>Workouts</span><strong id="countWorkouts">0</strong></article>
        <article class="stat"><span>Meals</span><strong id="countMeals">0</strong></article>
        <article class="stat"><span>Programs</span><strong id="countPrograms">0</strong></article>
        <article class="stat"><span>Configs</span><strong id="countConfigs">0</strong></article>

        <section class="panel span-3">
          <h3>Profile</h3>
          <form id="profileForm" class="form-grid">
            <label class="full">Display name
              <input name="displayName" placeholder="Jordan, Client 1, etc." />
            </label>
            <button class="primary full" type="submit">Save profile</button>
          </form>
        </section>

        <section class="panel span-3">
          <h3>Admin Activity</h3>
          <div class="log" id="activityLog"></div>
        </section>

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
    const state = { data: null, health: null, selectedUserId: null };
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

    function formatUptime(seconds) {
      const value = Number(seconds) || 0;
      const hours = Math.floor(value / 3600);
      const minutes = Math.floor((value % 3600) / 60);
      if (hours) return hours + "h " + minutes + "m";
      return minutes + "m";
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

    function fillProfile(member) {
      $("profileForm").displayName.value = member?.displayName || "";
    }

    function renderActivity(items) {
      const target = $("activityLog");
      if (!items?.length) {
        target.innerHTML = '<div class="empty">No admin activity yet.</div>';
        return;
      }
      target.innerHTML = items.map((item) => {
        const label = [item.source, item.action].filter(Boolean).join(" / ");
        const targetId = item.targetId ? '<span>Target: ' + escHtml(item.targetId) + '</span>' : '';
        return '<div class="log-item"><b>' + escHtml(formatDate(item.at)) + '</b><span>' + escHtml(label) + '</span>' + targetId + '</div>';
      }).join("");
    }

    function render() {
      const data = state.data;
      const health = state.health;
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

      $("healthStatus").textContent = health?.ok ? "Online" : "Needs attention";
      $("healthStatus").className = "status-pill" + (health?.ok ? " online" : "");
      $("opsBot").textContent = health?.botTag || "Unknown";
      $("opsUptime").textContent = health ? formatUptime(health.uptimeSeconds) : "-";
      $("opsGuilds").textContent = health?.guilds ?? "-";
      $("opsChecked").textContent = health?.checkedAt ? new Date(health.checkedAt).toLocaleTimeString() : "-";

      $("programSelect").innerHTML = Object.entries(data.programs)
        .map(([key, program]) => '<option value="' + escHtml(key) + '">' + escHtml(program.name) + '</option>')
        .join("");

      $("members").innerHTML = members.length
        ? members.map((member) => {
          const active = member.userId === state.selectedUserId ? " active" : "";
          return '<button class="member' + active + '" data-user-id="' + escHtml(member.userId) + '"><strong>' + escHtml(member.label) + '</strong><span>' + escHtml(member.userId) + ' | ' + member.summary.workouts + ' workouts | ' + member.summary.shakes + ' shakes | streak ' + member.streak + '</span></button>';
        }).join("")
        : '<div class="empty">No members tracked yet. Add a Discord user ID or use slash commands in Discord.</div>';

      document.querySelectorAll(".member").forEach((button) => {
        button.addEventListener("click", () => {
          state.selectedUserId = button.dataset.userId;
          render();
        });
      });

      const member = selectedMember();
      $("title").textContent = member ? member.label : "Control Panel";
      $("subtitle").textContent = member
        ? "Latest weight " + (member.summary.latestWeight ?? "-") + " lb | weekly workouts " + member.summary.workouts
        : "Add a member or log from Discord to start tracking.";

      fillProfile(member);
      fillGoals(member);
      renderActivity(data.activity);
      $("weeklySummary").textContent = member ? member.weeklySummary : "Select or add a member.";
      $("dailyAudit").textContent = member ? member.dailyAudit : "Select or add a member.";
      $("todayPlan").textContent = member ? member.todayPlan : "Select or add a member.";

      renderLog("checkinLog", member?.latest.checkIns || [], (item) =>
        '<b>' + escHtml(formatDate(item.at)) + '</b><span>' + escHtml(item.weight) + ' lb' + (item.notes ? ' | ' + escHtml(item.notes) : '') + '</span>' + logActions("checkin", item.id)
      );
      renderLog("workoutLog", member?.latest.workouts || [], (item) =>
        '<b>' + escHtml(formatDate(item.at)) + '</b><span>' + escHtml(item.note) + (item.durationMinutes ? ' | ' + escHtml(item.durationMinutes) + ' min' : '') + '</span>' + logActions("workout", item.id)
      );
      renderLog("mealLog", member?.latest.meals || [], (item) =>
        '<b>' + escHtml(formatDate(item.at)) + ' | ' + escHtml(item.type) + '</b><span>' + (item.calories || 0) + ' kcal | ' + (item.protein || 0) + 'g protein' + (item.note ? ' | ' + escHtml(item.note) : '') + '</span>' + logActions("meal", item.id)
      );
    }

    function logActions(type, id) {
      return '<div class="log-actions"><button data-log-action="edit" data-log-type="' + escHtml(type) + '" data-log-id="' + escHtml(id) + '">Edit</button><button class="danger" data-log-action="delete" data-log-type="' + escHtml(type) + '" data-log-id="' + escHtml(id) + '">Delete</button></div>';
    }

    function escHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    async function load() {
      const [data, health] = await Promise.all([
        api("/api/state"),
        fetch("/healthz").then((response) => response.json()).catch(() => null),
      ]);
      state.data = data;
      state.health = health;
      render();
    }

    function requireMember() {
      if (!state.selectedUserId) {
        throw new Error("Select or add a member first");
      }
      return state.selectedUserId;
    }

    function findLogEntry(type, id) {
      const member = selectedMember();
      const key = type === "checkin" ? "checkIns" : type === "workout" ? "workouts" : "meals";
      return member?.latest[key]?.find((entry) => entry.id === id) || null;
    }

    async function editLog(type, id) {
      const item = findLogEntry(type, id);
      if (!item) throw new Error("Log entry not found");
      let payload = {};

      if (type === "checkin") {
        const weight = prompt("Weight", item.weight ?? "");
        if (weight === null) return;
        const notes = prompt("Notes", item.notes || "");
        if (notes === null) return;
        payload = { weight, notes };
      } else if (type === "workout") {
        const note = prompt("Training note", item.note || "");
        if (note === null) return;
        const durationMinutes = prompt("Duration minutes", item.durationMinutes || "");
        if (durationMinutes === null) return;
        payload = { note, durationMinutes };
      } else {
        const calories = prompt("Calories", item.calories || "");
        if (calories === null) return;
        const protein = prompt("Protein", item.protein || "");
        if (protein === null) return;
        const note = prompt("Note", item.note || "");
        if (note === null) return;
        payload = { type: item.type, calories, protein, note };
      }

      await api("/api/member/" + encodeURIComponent(requireMember()) + "/" + type + "/" + encodeURIComponent(id), {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await load();
      showNotice("Log entry updated.");
    }

    async function deleteLog(type, id) {
      if (!confirm("Delete this " + type + " entry?")) return;
      await api("/api/member/" + encodeURIComponent(requireMember()) + "/" + type + "/" + encodeURIComponent(id), {
        method: "DELETE",
      });
      await load();
      showNotice("Log entry deleted.");
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
    $("profileForm").addEventListener("submit", (event) => {
      event.preventDefault();
      submitForm(event.currentTarget, (form) => api("/api/member/" + encodeURIComponent(requireMember()) + "/profile", {
        method: "POST",
        body: JSON.stringify({ displayName: form.get("displayName") }),
      }));
    });
    document.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-log-action]");
      if (!button) return;
      try {
        if (button.dataset.logAction === "edit") {
          await editLog(button.dataset.logType, button.dataset.logId);
        } else {
          await deleteLog(button.dataset.logType, button.dataset.logId);
        }
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

function auditDashboard(req, action, targetId, details = {}) {
  appendAuditLog({
    source: "dashboard",
    action,
    targetId,
    actor: requestActor(req),
    details,
  });
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
    auditDashboard(req, "member-create", userId);
    jsonResponse(res, 201, { member: memberView(userId, state.users[userId], state) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/backup") {
    const filePath = writeBackup(state);
    auditDashboard(req, "backup", filePath);
    jsonResponse(res, 200, { filePath });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/export") {
    const filePath = writeTextExport("weekly-export", exportWeeklyCsv(state));
    auditDashboard(req, "export", filePath);
    jsonResponse(res, 200, { filePath });
    return true;
  }

  const logMatch = url.pathname.match(/^\/api\/member\/([^/]+)\/(checkin|workout|meal)\/([^/]+)$/);
  if (logMatch) {
    const userId = decodeURIComponent(logMatch[1]);
    const type = logMatch[2];
    const entryId = decodeURIComponent(logMatch[3]);
    const record = getUserRecord(state, userId);
    const collectionName = logCollectionName(type);
    const collection = record[collectionName];
    const index = collection.findIndex((entry) => entry.id === entryId);

    if (index < 0) {
      jsonResponse(res, 404, { error: "Log entry not found" });
      return true;
    }

    if (req.method === "DELETE") {
      collection.splice(index, 1);
      refreshRecordStats(record);
      writeState(state);
      auditDashboard(req, `${type}-delete`, userId, { entryId });
      jsonResponse(res, 200, { member: memberView(userId, record, state) });
      return true;
    }

    if (req.method !== "POST") {
      jsonResponse(res, 405, { error: "Method not allowed" });
      return true;
    }

    const body = await readBody(req);
    const entry = collection[index];
    if (type === "checkin") {
      const weight = parseOptionalNumber(body.weight);
      if (!weight) {
        jsonResponse(res, 400, { error: "Weight is required" });
        return true;
      }
      entry.weight = weight;
      entry.notes = body.notes || "";
    } else if (type === "workout") {
      const note = String(body.note || "").trim();
      if (!note) {
        jsonResponse(res, 400, { error: "Workout note is required" });
        return true;
      }
      entry.note = note;
      entry.durationMinutes = parseOptionalNumber(body.durationMinutes);
    } else {
      entry.type = body.type === "shake" ? "shake" : "meal";
      entry.calories = parseOptionalNumber(body.calories);
      entry.protein = parseOptionalNumber(body.protein);
      entry.note = body.note || "";
    }

    refreshRecordStats(record);
    writeState(state);
    auditDashboard(req, `${type}-update`, userId, { entryId });
    jsonResponse(res, 200, { member: memberView(userId, record, state) });
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
  if (action === "profile") {
    record.displayName = String(body.displayName || "").trim().slice(0, 80);
    auditDashboard(req, "profile-update", userId, { displayName: record.displayName });
  } else if (action === "goals") {
    record.profile.targetWeight = parseOptionalNumber(body.targetWeight);
    record.profile.dailyCalories = parseOptionalNumber(body.dailyCalories);
    record.profile.dailyProtein = parseOptionalNumber(body.dailyProtein);
    record.profile.workoutsPerWeek = parseOptionalNumber(body.workoutsPerWeek);
    record.profile.shakesPerDay = parseOptionalNumber(body.shakesPerDay);
    record.profile.programName = state.programs[body.programName] ? body.programName : "mass-4-day";
    auditDashboard(req, "goals-update", userId, {
      programName: record.profile.programName,
    });
  } else if (action === "checkin") {
    const weight = parseOptionalNumber(body.weight);
    if (!weight) {
      jsonResponse(res, 400, { error: "Weight is required" });
      return true;
    }
    updateCheckIn(record, weight, body.notes || "");
    auditDashboard(req, "checkin-log", userId);
  } else if (action === "workout") {
    const note = String(body.note || "").trim();
    if (!note) {
      jsonResponse(res, 400, { error: "Workout note is required" });
      return true;
    }
    logWorkout(record, note, parseOptionalNumber(body.durationMinutes));
    auditDashboard(req, "workout-log", userId);
  } else if (action === "meal") {
    const type = body.type === "shake" ? "shake" : "meal";
    logMeal(
      record,
      type,
      parseOptionalNumber(body.calories),
      parseOptionalNumber(body.protein),
      body.note || ""
    );
    auditDashboard(req, "meal-log", userId, { type });
  } else {
    jsonResponse(res, 404, { error: "Unknown member action" });
    return true;
  }

  writeState(state);
  jsonResponse(res, 200, { member: memberView(userId, record, state) });
  return true;
}

function startDashboard(readState, port, options = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const state = readState();
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname === "/healthz") {
        const health = healthView(options.health, state);
        jsonResponse(res, health.ok ? 200 : 503, health);
        return;
      }

      if (!dashboardAuth(req, res, options.adminPassword)) {
        return;
      }

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

  const host = options.host || "127.0.0.1";
  server.listen(port, host, () => {
    console.log(`Dashboard listening on http://${host}:${port}`);
  });

  return server;
}

module.exports = { startDashboard };
