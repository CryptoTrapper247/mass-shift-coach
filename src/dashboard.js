const http = require("http");
const { URL } = require("url");
const { formatWeeklySummary, summarizeWeek } = require("./coach");

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildRows(state) {
  return Object.entries(state.users).map(([userId, record]) => {
    const summary = summarizeWeek(record);
    return {
      userId,
      streak: record.streak,
      latestWeight: summary.latestWeight ?? "-",
      workouts: summary.workouts,
      shakes: summary.shakes,
      avgCalories: summary.avgCalories ?? "-",
      avgProtein: summary.avgProtein ?? "-",
      program: record.profile.programName || "mass-4-day",
    };
  });
}

function renderHtml(state) {
  const rows = buildRows(state);
  const rowHtml = rows
    .map(
      (row) => `<tr>
        <td>${esc(row.userId)}</td>
        <td>${esc(row.streak)}</td>
        <td>${esc(row.latestWeight)}</td>
        <td>${esc(row.workouts)}</td>
        <td>${esc(row.shakes)}</td>
        <td>${esc(row.avgCalories)}</td>
        <td>${esc(row.avgProtein)}</td>
        <td>${esc(row.program)}</td>
      </tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mass Shift Coach Dashboard</title>
  <style>
    :root {
      --bg: #111318;
      --panel: #191d24;
      --panel-2: #232934;
      --ink: #f4f6f8;
      --muted: #9aa5b1;
      --line: #313946;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: radial-gradient(circle at top, #1d2430, var(--bg) 60%);
      color: var(--ink);
    }
    .wrap {
      max-width: 1100px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }
    .hero, .panel {
      background: rgba(25, 29, 36, 0.92);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 20px;
      backdrop-filter: blur(8px);
    }
    .hero h1 {
      margin: 0 0 8px;
      font-size: 32px;
    }
    .hero p {
      margin: 0;
      color: var(--muted);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin: 20px 0;
    }
    .card {
      background: var(--panel-2);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 16px;
    }
    .card .k {
      display: block;
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 8px;
    }
    .card .v {
      font-size: 28px;
      font-weight: 700;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }
    th, td {
      text-align: left;
      padding: 12px 10px;
      border-bottom: 1px solid var(--line);
      font-size: 14px;
    }
    th {
      color: var(--muted);
      font-weight: 600;
    }
    .footer {
      color: var(--muted);
      margin-top: 16px;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>Mass Shift Coach Dashboard</h1>
      <p>Local control panel for goals, weekly progress, and server activity.</p>
    </section>
    <section class="grid">
      <article class="card"><span class="k">Tracked users</span><span class="v">${rows.length}</span></article>
      <article class="card"><span class="k">Programs</span><span class="v">${Object.keys(state.programs || {}).length}</span></article>
      <article class="card"><span class="k">Reminder configs</span><span class="v">${Object.keys(state.meta.guilds || {}).length}</span></article>
    </section>
    <section class="panel">
      <h2>Members</h2>
      <table>
        <thead>
          <tr>
            <th>User ID</th>
            <th>Streak</th>
            <th>Latest Weight</th>
            <th>Weekly Workouts</th>
            <th>Weekly Shakes</th>
            <th>Avg Calories</th>
            <th>Avg Protein</th>
            <th>Program</th>
          </tr>
        </thead>
        <tbody>${rowHtml}</tbody>
      </table>
      <div class="footer">API: <code>/api/state</code> and <code>/api/member/:userId</code></div>
    </section>
  </div>
</body>
</html>`;
}

function startDashboard(readState, port) {
  const server = http.createServer((req, res) => {
    const state = readState();
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/state") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(state, null, 2));
      return;
    }
    if (url.pathname.startsWith("/api/member/")) {
      const userId = decodeURIComponent(url.pathname.slice("/api/member/".length));
      const record = state.users[userId];
      if (!record) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Member not found" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          {
            userId,
            record,
            weeklySummary: formatWeeklySummary(userId, record, state),
          },
          null,
          2
        )
      );
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderHtml(state));
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Dashboard listening on http://127.0.0.1:${port}`);
  });

  return server;
}

module.exports = { startDashboard };
