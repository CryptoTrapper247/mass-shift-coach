# Mass Shift Coach Bot

Mass Shift Coach is a cleaner Discord bulk-coaching bot built for nightly check-ins, calorie consistency, training accountability, and weekly progress reviews.

## What it does

- Uses slash commands instead of legacy `!` commands
- Tracks bodyweight check-ins and streaks
- Logs workouts, meals, shakes, calories, and protein
- Stores user goals for target weight, calories, protein, training, and shakes
- Includes built-in 3-day, 4-day, and 5-day hypertrophy plans
- Posts daily wake reminders, missed-goal auto-coaching, evening nudges, and weekly progress summaries
- Generates short coaching feedback based on your recent logs
- Includes a local dashboard, CSV export, and JSON backup flow
- Uses macOS Application Support for live state so launchd can run cleanly

## Slash commands

- `/help`
- `/checkin`
- `/workout`
- `/meal`
- `/goals`
- `/plan`
- `/today`
- `/status`
- `/summary`
- `/member-summary`
- `/leaderboard`
- `/coach`
- `/nudge`
- `/server-status`
- `/backup`
- `/export`
- `/set-bot-channel`
- `/set-reminder-channel`

## Setup

1. Copy `.env.example` to `.env`
2. Set `DISCORD_TOKEN`
3. Set `REMINDER_CHANNEL_ID` or use `/set-reminder-channel`
4. Adjust schedule values and `TIMEZONE`
5. Install dependencies with `npm install`
6. Run with `npm start`
7. Wait a few seconds for slash commands to register in the server

## Local run

```bash
npm install
npm start
```

## Deploy-ready options

### Docker

```bash
docker build -t mass-shift-coach .
docker run --env-file .env mass-shift-coach
```

### Any container host

- Push this folder to a Git repo
- Point your host at the included `Dockerfile`
- Add the `.env` values as platform environment variables
- Run one container instance

### Render

- `render.yaml` is included for a worker-style deploy
- Set your environment variables in the Render dashboard
- Deploy this repo as a Docker service

### Railway

- `railway.json` is included for a simple worker deployment
- Create a new project from this folder's Git repo
- Add the same environment variables there

### Keep it alive on your own machine

- A ready-to-install `launchd` file is included at `launchd/com.massshiftcoach.bot.plist`
- Logs are written to `logs/mass-shift-coach.out.log` and `logs/mass-shift-coach.err.log`
- Keep the machine powered on and connected

## Local dashboard

- The bot now starts a dashboard on `http://127.0.0.1:3001`
- Change the port with `DASHBOARD_PORT`
- JSON endpoints:
  - `/api/state`
  - `/api/member/<user_id>`

## Local data location

- Live state is stored at `~/Library/Application Support/MassShiftCoach/state.json`
- Backups are written under `~/Library/Application Support/MassShiftCoach/backups/`
- CSV exports are written under `~/Library/Application Support/MassShiftCoach/exports/`
- If an older `data/state.json` exists, the bot will try to migrate it on first run

## Token safety

- Never share `.env`
- If the token was exposed, reset it in Discord Developer Portal and update `.env`
- Because the bot now uses slash commands, you can disable `Message Content Intent` if you no longer need old-style prefix commands

## Notes

- The launchd bot on macOS should use the Application Support location above for live writes
- Node 18+ is recommended
