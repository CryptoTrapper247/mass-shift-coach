const dotenv = require("dotenv");

dotenv.config();

function readNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const config = {
  token: process.env.DISCORD_TOKEN || "",
  reminderChannelId: process.env.REMINDER_CHANNEL_ID || "",
  timezone: process.env.TIMEZONE || "America/Toronto",
  wakeHour: readNumber(process.env.WAKE_HOUR_24, 13),
  wakeMinute: readNumber(process.env.WAKE_MINUTE, 0),
  eveningHour: readNumber(process.env.EVENING_HOUR_24, 20),
  eveningMinute: readNumber(process.env.EVENING_MINUTE, 0),
  weeklySummaryDay: readNumber(process.env.WEEKLY_SUMMARY_DAY, 0),
  weeklySummaryHour: readNumber(process.env.WEEKLY_SUMMARY_HOUR_24, 18),
  weeklySummaryMinute: readNumber(process.env.WEEKLY_SUMMARY_MINUTE, 0),
  dashboardPort: readNumber(process.env.DASHBOARD_PORT || process.env.PORT, 3001),
  dashboardHost: process.env.DASHBOARD_HOST || "127.0.0.1",
  dashboardAdminPassword: process.env.ADMIN_PASSWORD || "",
  adminUserIds: readList(process.env.ADMIN_USER_IDS),
  automaticBackupHours: readNumber(process.env.AUTOMATIC_BACKUP_HOURS, 24),
  backupRetentionCount: readNumber(process.env.BACKUP_RETENTION_COUNT, 14),
  backupMirrorDir: process.env.BACKUP_MIRROR_DIR || "",
  monitorHeartbeatUrl: process.env.MONITOR_HEARTBEAT_URL || "",
  monitorHeartbeatMinutes: readNumber(process.env.MONITOR_HEARTBEAT_MINUTES, 5),
  devAlertChannelId: process.env.DEV_ALERT_CHANNEL_ID || "",
};

if (!config.token) {
  throw new Error("Missing DISCORD_TOKEN in .env");
}

module.exports = { config };
