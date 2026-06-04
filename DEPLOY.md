# Deploy Checklist

This bot is ready to run on either Render or Railway. Render is configured as a Docker web service so it can expose `/healthz` for uptime monitoring while the dashboard stays password-protected.

## Before you deploy

1. Reset the Discord bot token in the Developer Portal if you want a fresh secret.
2. Update local `.env` with the new token if you reset it.
3. Make sure these environment variables are available in your host:
   - `DISCORD_TOKEN`
   - `REMINDER_CHANNEL_ID`
   - `TIMEZONE`
   - `WAKE_HOUR_24`
   - `WAKE_MINUTE`
   - `EVENING_HOUR_24`
   - `EVENING_MINUTE`
   - `WEEKLY_SUMMARY_DAY`
   - `WEEKLY_SUMMARY_HOUR_24`
   - `WEEKLY_SUMMARY_MINUTE`
   - `DASHBOARD_HOST`
   - `ADMIN_PASSWORD`
   - `ADMIN_USER_IDS`
   - `AUTOMATIC_BACKUP_HOURS`
   - `BACKUP_RETENTION_COUNT`
   - `BACKUP_MIRROR_DIR` if your host has a mounted backup volume
   - `MASS_SHIFT_DATA_DIR`
   - `MONITOR_HEARTBEAT_URL`
   - `MONITOR_HEARTBEAT_MINUTES`
4. If you expose the dashboard on a cloud host, require `ADMIN_PASSWORD`, HTTPS, and a private route or firewall rule.
5. Use a persistent disk or volume for `MASS_SHIFT_DATA_DIR`; otherwise state and backups can disappear on redeploy.

## Render

1. Push this folder to a GitHub repo.
2. In Render, create a new Blueprint or Docker web service.
3. Point it at the repo.
4. Use the included `render.yaml` or select Docker manually.
5. Confirm the persistent disk is mounted at `/var/data`.
6. Add the secret environment variables from the list above.
7. Deploy.
8. Confirm `https://<your-render-url>/healthz` returns `ok: true`.

## Railway

1. Push this folder to a GitHub repo.
2. In Railway, create a new project from that repo.
3. Railway will pick up `railway.json` and the `Dockerfile`.
4. Add a Railway Volume and mount it to the service.
5. Add `DASHBOARD_HOST=0.0.0.0`.
6. Add the environment variables from the list above.
7. Deploy.
8. Confirm `https://<your-railway-url>/healthz` returns `ok: true`.

## Monitoring

1. Create an external monitor in Better Stack, UptimeRobot, Healthchecks, or a similar service.
2. For HTTP uptime checks, monitor `/healthz`.
3. For heartbeat checks, paste the provider's ping URL into `MONITOR_HEARTBEAT_URL`.
4. Set `MONITOR_HEARTBEAT_MINUTES` lower than the provider's alert timeout.

## After deploy

1. Open Discord and confirm slash commands still respond.
2. Run `/goals` and `/today`.
3. Confirm reminders are pointed at the right channel with `/set-reminder-channel`.
4. Confirm `/server-status` works only for your `ADMIN_USER_IDS` allowlist and users with Manage Server.
5. Trigger `/backup` and confirm it writes under the persistent data directory.
6. If the bot does not respond, inspect the platform logs first.
