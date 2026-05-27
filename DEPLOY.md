# Deploy Checklist

This bot is ready to run on either Render or Railway as a background worker.

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

## Render

1. Push this folder to a GitHub repo.
2. In Render, create a new `Worker`.
3. Point it at the repo.
4. Use the included `render.yaml` or select `Docker` manually.
5. Add the environment variables from the list above.
6. Deploy.

## Railway

1. Push this folder to a GitHub repo.
2. In Railway, create a new project from that repo.
3. Railway will pick up `railway.json` and the `Dockerfile`.
4. Add the environment variables from the list above.
5. Deploy.

## After deploy

1. Open Discord and confirm slash commands still respond.
2. Run `/goals` and `/today`.
3. Confirm reminders are pointed at the right channel with `/set-reminder-channel`.
4. If the bot does not respond, inspect the platform logs first.
