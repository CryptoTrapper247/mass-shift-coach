# Production Readiness

## Required Host Settings

- `DISCORD_TOKEN`
- `ADMIN_PASSWORD`
- `ADMIN_USER_IDS`
- `DASHBOARD_HOST=0.0.0.0`
- `MASS_SHIFT_DATA_DIR=/var/data` on Render or the mounted Railway volume path
- Schedule variables from `.env.example`

## Required Host Features

- HTTPS enabled by the host
- Persistent disk or volume attached
- `/healthz` monitored by the host or an external uptime service
- `MONITOR_HEARTBEAT_URL` set if using heartbeat monitoring
- Backups confirmed inside the persistent data directory

## Local Mac Hardening

- Dashboard stays on `127.0.0.1`
- `.env` remains untracked and owner-only
- Apple Firewall is enabled in System Settings
- Unrelated developer servers are stopped or bound to localhost

## Final Smoke Test

- Bot appears online in Discord
- `/today` responds
- `/server-status` works for an allowed admin
- `/server-status` is denied for non-admins
- `https://<host>/healthz` returns HTTP 200
- Dashboard asks for the admin password
- `/backup` writes a JSON file under persistent storage
