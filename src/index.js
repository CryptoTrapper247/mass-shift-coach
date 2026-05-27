const {
  ChannelType,
  Client,
  GatewayIntentBits,
} = require("discord.js");
const {
  dailyAudit,
  formatWeeklySummary,
  getNudge,
} = require("./coach");
const { commandData, handleInteraction } = require("./commands");
const { config } = require("./config");
const { getUserRecord, readState, writeState } = require("./storage");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

function zonedParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const result = {};
  for (const part of parts) {
    result[part.type] = part.value;
  }

  return {
    dateKey: `${result.year}-${result.month}-${result.day}`,
    hour: Number(result.hour),
    minute: Number(result.minute),
    weekday: result.weekday,
  };
}

function weekdayNumber(label) {
  const weekdays = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return weekdays[label] ?? -1;
}

function schedulerKey(name, guildId) {
  return `${name}:${guildId}`;
}

function getReminderChannel(state, guild) {
  const guildConfig = state.meta.guilds?.[guild.id];
  const channelId = guildConfig?.reminderChannelId || config.reminderChannelId;
  if (!channelId) {
    return null;
  }

  return guild.channels.cache.get(channelId) || null;
}

async function sendWakeReminder(guild, channel, state) {
  const mentions = Object.keys(state.users).map((userId) => `<@${userId}>`);
  const prefix = mentions.length ? `${mentions.join(" ")} ` : "";
  await channel.send(
    `${prefix}Wake-up check: log weight, log calories, and decide your training window. Use /checkin, /meal, and /workout to lock the day in.`
  );
}

function autoCoachLine(userId, record, state) {
  const audit = dailyAudit(record, state);
  if (!audit.misses.length) {
    return `<@${userId}> clean day so far. Stay ahead by logging the next meal before the window closes.`;
  }

  return `<@${userId}> ${audit.nextMove}`;
}

async function sendEveningNudge(guild, channel, state) {
  const userIds = Object.keys(state.users);
  if (!userIds.length) {
    await channel.send("Evening push: get one meal logged and commit to tomorrow's training window.");
    return;
  }

  const lines = userIds.slice(0, 5).map((userId) => {
    const record = getUserRecord(state, userId);
    const audit = dailyAudit(record, state);
    if (audit.misses.length >= 2) {
      return autoCoachLine(userId, record, state);
    }
    return `<@${userId}> ${getNudge(record)}`;
  });
  await channel.send(lines.join("\n\n"));
}

async function sendWeeklySummaries(guild, channel, state) {
  const userIds = Object.keys(state.users);
  if (!userIds.length) {
    return;
  }

    const summaries = userIds.slice(0, 10).map((userId) => {
      const member = guild.members.cache.get(userId);
      const record = getUserRecord(state, userId);
      const name = member?.displayName || member?.user.username || "member";
    return "```text\n" + formatWeeklySummary(name, record, state) + "\n```";
  });
  await channel.send(summaries.join("\n"));
}

async function tickSchedules() {
  const now = zonedParts(new Date(), config.timezone);
  const state = readState();
  if (!state.meta.schedules) {
    state.meta.schedules = {};
  }

  for (const guild of client.guilds.cache.values()) {
    await guild.channels.fetch();

    const channel = getReminderChannel(state, guild);
    if (!channel || channel.type !== ChannelType.GuildText) {
      continue;
    }

    const wakeKey = schedulerKey("wake", guild.id);
    const eveningKey = schedulerKey("evening", guild.id);
    const weeklyKey = schedulerKey("weekly", guild.id);

    if (
      now.hour === config.wakeHour &&
      now.minute === config.wakeMinute &&
      state.meta.schedules[wakeKey] !== now.dateKey
    ) {
      await sendWakeReminder(guild, channel, state);
      state.meta.schedules[wakeKey] = now.dateKey;
    }

    if (
      now.hour === config.eveningHour &&
      now.minute === config.eveningMinute &&
      state.meta.schedules[eveningKey] !== now.dateKey
    ) {
      await sendEveningNudge(guild, channel, state);
      state.meta.schedules[eveningKey] = now.dateKey;
    }

    if (
      weekdayNumber(now.weekday) === config.weeklySummaryDay &&
      now.hour === config.weeklySummaryHour &&
      now.minute === config.weeklySummaryMinute &&
      state.meta.schedules[weeklyKey] !== now.dateKey
    ) {
      await sendWeeklySummaries(guild, channel, state);
      state.meta.schedules[weeklyKey] = now.dateKey;
    }
  }

  writeState(state);
}

function startScheduler() {
  tickSchedules().catch((error) => {
    console.error("Initial schedule tick failed:", error);
  });

  setInterval(() => {
    tickSchedules().catch((error) => {
      console.error("Scheduled tick failed:", error);
    });
  }, 60 * 1000);
}

async function registerCommands() {
  const definitions = commandData();
  await Promise.all(
    client.guilds.cache.map(async (guild) => {
      await guild.commands.set(definitions);
      console.log(`Registered commands for ${guild.name}`);
    })
  );
}

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
  startScheduler();
});

client.on("interactionCreate", async (interaction) => {
  try {
    await handleInteraction(interaction);
  } catch (error) {
    console.error("Interaction failure:", error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "Something broke while handling that command.",
        ephemeral: true,
      });
    }
  }
});

client.login(config.token);
