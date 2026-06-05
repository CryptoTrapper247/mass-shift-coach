const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { config } = require("./config");
const {
  APP_DATA_DIR,
  AUDIT_LOG_PATH,
  BACKUP_DIR,
  readAuditLog,
} = require("./storage");

const PROJECT_ROOT = path.join(__dirname, "..");
const LOG_DIR = path.join(PROJECT_ROOT, "logs");
const OUT_LOG_PATH = path.join(LOG_DIR, "mass-shift-coach.out.log");
const ERR_LOG_PATH = path.join(LOG_DIR, "mass-shift-coach.err.log");

function fileInfo(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return {
      path: filePath,
      exists: true,
      mtime: stat.mtime.toISOString(),
      ageMinutes: Math.max(0, Math.round((Date.now() - stat.mtimeMs) / 60000)),
      sizeBytes: stat.size,
    };
  } catch (error) {
    return {
      path: filePath,
      exists: false,
      mtime: null,
      ageMinutes: null,
      sizeBytes: 0,
    };
  }
}

function latestBackupInfo() {
  if (!fs.existsSync(BACKUP_DIR)) {
    return {
      ok: false,
      latest: null,
      count: 0,
      mirrorLatest: config.backupMirrorDir ? fileInfo(path.join(config.backupMirrorDir, "state-latest.json")) : null,
    };
  }

  const backups = fs
    .readdirSync(BACKUP_DIR)
    .filter((name) => name.startsWith("state-backup-") && name.endsWith(".json"))
    .map((name) => {
      const filePath = path.join(BACKUP_DIR, name);
      const info = fileInfo(filePath);
      return { ...info, name };
    })
    .sort((a, b) => new Date(b.mtime || 0) - new Date(a.mtime || 0));

  const latest = backups[0] || null;
  return {
    ok: Boolean(latest && latest.ageMinutes !== null && latest.ageMinutes <= config.automaticBackupHours * 90),
    latest,
    count: backups.length,
    mirrorLatest: config.backupMirrorDir ? fileInfo(path.join(config.backupMirrorDir, "state-latest.json")) : null,
  };
}

function gitCommit() {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const branch = execFileSync("git", ["branch", "--show-current"], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return { sha, branch: branch || "detached" };
  } catch (error) {
    return { sha: "unknown", branch: "unknown" };
  }
}

function readLogTail(filePath, limit = 20) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .slice(-limit)
    .map((message) => ({ at: null, source: "app-log", action: path.basename(filePath), message }));
}

function latestDevEvents(filter = "", limit = 12) {
  const needle = String(filter || "").trim().toLowerCase();
  const auditRows = readAuditLog(120).map((entry) => ({
    at: entry.at || null,
    source: entry.source || "audit",
    action: entry.action || "event",
    targetId: entry.targetId || "",
    message: entry.details?.message || entry.details?.type || "",
  }));

  const logRows = [
    ...readLogTail(ERR_LOG_PATH, 40),
    ...readLogTail(OUT_LOG_PATH, 25),
  ];

  return [...auditRows, ...logRows]
    .filter((entry) => {
      if (!needle) {
        return true;
      }
      return [
        entry.source,
        entry.action,
        entry.targetId,
        entry.message,
      ].join(" ").toLowerCase().includes(needle);
    })
    .slice(0, limit);
}

function lastError() {
  return latestDevEvents("error", 1)[0] || latestDevEvents("failed", 1)[0] || null;
}

function buildDevSnapshot(healthSnapshot = {}) {
  const backup = latestBackupInfo();
  return {
    ready: Boolean(healthSnapshot.ready),
    botTag: healthSnapshot.botTag || null,
    guilds: healthSnapshot.guilds || 0,
    uptimeSeconds: Math.round(process.uptime()),
    dashboard: {
      host: config.dashboardHost,
      port: config.dashboardPort,
      authEnabled: Boolean(config.dashboardAdminPassword),
    },
    backup,
    git: gitCommit(),
    lastError: lastError(),
    appDataDir: APP_DATA_DIR,
    auditLog: fileInfo(AUDIT_LOG_PATH),
    devAlertChannelId: config.devAlertChannelId || "",
  };
}

function formatAge(minutes) {
  if (minutes === null || minutes === undefined) {
    return "missing";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  return `${Math.round(minutes / 60)}h ago`;
}

function formatDevStatus(snapshot) {
  const backup = snapshot.backup.latest;
  const mirror = snapshot.backup.mirrorLatest;
  const lastError = snapshot.lastError;
  return [
    `Bot ready: ${snapshot.ready ? "yes" : "no"}`,
    `Bot tag: ${snapshot.botTag || "not logged in"}`,
    `Uptime: ${formatAge(Math.round(snapshot.uptimeSeconds / 60))}`,
    `Dashboard: ${snapshot.dashboard.host}:${snapshot.dashboard.port} (${snapshot.dashboard.authEnabled ? "auth on" : "auth off"})`,
    `Backup fresh: ${snapshot.backup.ok ? "yes" : "no"}`,
    `Last backup: ${backup ? `${backup.name} (${formatAge(backup.ageMinutes)})` : "none"}`,
    `Mirror latest: ${mirror ? `${mirror.exists ? "present" : "missing"} (${formatAge(mirror.ageMinutes)})` : "not configured"}`,
    `Git: ${snapshot.git.branch}@${snapshot.git.sha}`,
    `Last error: ${lastError ? `${lastError.source}/${lastError.action} ${lastError.message || lastError.targetId || ""}`.trim() : "none found"}`,
  ].join("\n");
}

module.exports = {
  buildDevSnapshot,
  formatDevStatus,
  latestDevEvents,
};
