const { AttachmentBuilder, ChannelType, SlashCommandBuilder } = require("discord.js");
const {
  buildLeaderboard,
  exportWeeklyCsv,
  formatDailyAudit,
  formatGoals,
  formatProgram,
  formatStatus,
  formatTodayPlan,
  formatWeeklySummary,
  getNudge,
  logMeal,
  logWorkout,
  updateCheckIn,
} = require("./coach");
const { config } = require("./config");
const {
  buildDevSnapshot,
  formatDevStatus,
  latestDevEvents,
} = require("./devops");
const {
  appendAuditLog,
  getUserRecord,
  readAuditLog,
  readState,
  writeBackup,
  writeState,
  writeTextExport,
} = require("./storage");

const commandBuilders = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show Mass Shift Coach slash commands."),
  new SlashCommandBuilder()
    .setName("checkin")
    .setDescription("Log your daily weight check-in.")
    .addNumberOption((option) =>
      option.setName("weight").setDescription("Current bodyweight in lb.").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("notes").setDescription("Optional context for today.")
    ),
  new SlashCommandBuilder()
    .setName("workout")
    .setDescription("Log a workout session.")
    .addStringOption((option) =>
      option.setName("note").setDescription("What you trained.").setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName("duration").setDescription("Duration in minutes.")
    ),
  new SlashCommandBuilder()
    .setName("meal")
    .setDescription("Log a shake or meal.")
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("Choose what you took in.")
        .setRequired(true)
        .addChoices(
          { name: "Shake", value: "shake" },
          { name: "Meal", value: "meal" }
        )
    )
    .addIntegerOption((option) =>
      option.setName("calories").setDescription("Calories for this meal.")
    )
    .addIntegerOption((option) =>
      option.setName("protein").setDescription("Protein grams for this meal.")
    )
    .addStringOption((option) =>
      option.setName("note").setDescription("What you had.")
    ),
  new SlashCommandBuilder()
    .setName("goals")
    .setDescription("Set or review your mass-gain goals.")
    .addNumberOption((option) =>
      option.setName("target_weight").setDescription("Target bodyweight in lb.")
    )
    .addIntegerOption((option) =>
      option.setName("daily_calories").setDescription("Daily calorie goal.")
    )
    .addIntegerOption((option) =>
      option.setName("daily_protein").setDescription("Daily protein goal in grams.")
    )
    .addIntegerOption((option) =>
      option.setName("workouts_per_week").setDescription("Training sessions per week.")
    )
    .addIntegerOption((option) =>
      option.setName("shakes_per_day").setDescription("Daily shake target.")
    )
    .addStringOption((option) =>
      option
        .setName("program")
        .setDescription("Training split to follow.")
        .addChoices(
          { name: "Mass 3-Day", value: "mass-3-day" },
          { name: "Mass 4-Day", value: "mass-4-day" },
          { name: "Mass 5-Day", value: "mass-5-day" }
        )
    ),
  new SlashCommandBuilder()
    .setName("plan")
    .setDescription("View a training program or your active split.")
    .addStringOption((option) =>
      option
        .setName("program")
        .setDescription("Which training split to display.")
        .addChoices(
          { name: "Mass 3-Day", value: "mass-3-day" },
          { name: "Mass 4-Day", value: "mass-4-day" },
          { name: "Mass 5-Day", value: "mass-5-day" }
        )
    ),
  new SlashCommandBuilder()
    .setName("today")
    .setDescription("Show today's next workout day and daily audit."),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("See your current momentum and goals."),
  new SlashCommandBuilder()
    .setName("summary")
    .setDescription("Get your weekly progress summary."),
  new SlashCommandBuilder()
    .setName("member-summary")
    .setDescription("Review another member's weekly summary.")
    .addUserOption((option) =>
      option.setName("member").setDescription("Server member to review.").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show a server leaderboard.")
    .addStringOption((option) =>
      option
        .setName("metric")
        .setDescription("Ranking metric.")
        .setRequired(true)
        .addChoices(
          { name: "Streak", value: "streak" },
          { name: "Weekly workouts", value: "workouts" },
          { name: "Average calories", value: "calories" },
          { name: "Average protein", value: "protein" },
          { name: "Weekly shakes", value: "shakes" }
        )
    ),
  new SlashCommandBuilder()
    .setName("nudge")
    .setDescription("Get a direct coaching push."),
  new SlashCommandBuilder()
    .setName("coach")
    .setDescription("Get your smartest next move from the bot right now."),
  new SlashCommandBuilder()
    .setName("profile")
    .setDescription("Set or review your Mass Shift display name.")
    .addStringOption((option) =>
      option.setName("display_name").setDescription("Name to show in summaries and dashboard.")
    ),
  new SlashCommandBuilder()
    .setName("delete-log")
    .setDescription("Delete one of your recent log entries.")
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("Which log type to delete.")
        .setRequired(true)
        .addChoices(
          { name: "Check-in", value: "checkin" },
          { name: "Workout", value: "workout" },
          { name: "Meal", value: "meal" }
        )
    )
    .addIntegerOption((option) =>
      option.setName("latest_number").setDescription("1 deletes the latest entry, 2 the previous, etc.")
    )
    .addUserOption((option) =>
      option.setName("member").setDescription("Admin only: delete another member's entry.")
    ),
  new SlashCommandBuilder()
    .setName("admin-activity")
    .setDescription("Show recent Mass Shift admin/audit activity."),
  new SlashCommandBuilder()
    .setName("coach-settings")
    .setDescription("Show server channels and schedule settings."),
  new SlashCommandBuilder()
    .setName("dev-status")
    .setDescription("Admin dev health: uptime, backups, errors, git, and readiness."),
  new SlashCommandBuilder()
    .setName("dev-logs")
    .setDescription("Admin dev log/audit search for important events.")
    .addStringOption((option) =>
      option
        .setName("filter")
        .setDescription("Filter by error, backup, command, login, restart, etc.")
    ),
  new SlashCommandBuilder()
    .setName("set-dev-alert-channel")
    .setDescription("Set the quiet admin channel for important dev alerts.")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Channel for restarts, backup failures, crashes, and login issues.")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("set-bot-channel")
    .setDescription("Point bot chatter to a dedicated text channel.")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Channel for bot posts and admin exports.")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("server-status")
    .setDescription("Admin snapshot of the whole server bot usage."),
  new SlashCommandBuilder()
    .setName("backup")
    .setDescription("Admin backup of the bot state to a JSON file."),
  new SlashCommandBuilder()
    .setName("export")
    .setDescription("Export weekly member stats as CSV."),
  new SlashCommandBuilder()
    .setName("set-reminder-channel")
    .setDescription("Point reminders to a text channel for this server.")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Where reminders and summaries should be posted.")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),
];

function commandData() {
  return commandBuilders.map((builder) => builder.toJSON());
}

function getHelpText() {
  return [
    "`/checkin` log weight and notes",
    "`/workout` log training and duration",
    "`/meal` log shakes, meals, calories, and protein",
    "`/goals` set your bulk targets",
    "`/plan` view your training split",
    "`/today` get today's workout and audit",
    "`/status` get your dashboard",
    "`/summary` get your weekly review",
    "`/member-summary` review another member",
    "`/leaderboard` compare server progress",
    "`/coach` get the smartest next move",
    "`/profile` set your dashboard display name",
    "`/delete-log` remove a mistaken recent log",
    "`/nudge` get a hard push",
    "`/admin-activity` admin audit log",
    "`/coach-settings` admin schedule/channel settings",
    "`/dev-status` admin dev health",
    "`/dev-logs` admin filtered dev events",
    "`/set-dev-alert-channel` admin alert channel",
    "`/server-status` admin summary",
    "`/backup` admin JSON backup",
    "`/export` export weekly CSV",
    "`/set-bot-channel` move bot chatter into a dedicated channel",
    "`/set-reminder-channel` move reminders into a better channel",
  ].join("\n");
}

function requireManageGuild(interaction) {
  return interaction.memberPermissions && interaction.memberPermissions.has("ManageGuild");
}

function adminGuard(interaction) {
  if (config.adminUserIds.length && !config.adminUserIds.includes(interaction.user.id)) {
    return {
      content: "You are not on the Mass Shift Coach admin allowlist.",
      ephemeral: true,
    };
  }

  if (!requireManageGuild(interaction)) {
    return {
      content: "You need Manage Server permission for that command.",
      ephemeral: true,
    };
  }
  return null;
}

function formatServerStatus(state) {
  const memberCount = Object.keys(state.users).length;
  const guildConfigs = Object.keys(state.meta.guilds || {}).length;
  const reminderChannels = Object.values(state.meta.guilds || {}).filter(
    (config) => config.reminderChannelId
  ).length;
  const botChannels = Object.values(state.meta.guilds || {}).filter(
    (config) => config.botChannelId
  ).length;

  return [
    `Tracked members: ${memberCount}`,
    `Guild configs: ${guildConfigs}`,
    `Reminder channels set: ${reminderChannels}`,
    `Bot channels set: ${botChannels}`,
    `Programs available: ${Object.keys(state.programs || {}).length}`,
  ].join("\n");
}

function displayLabel(userId, record) {
  return record.displayName || userId;
}

function collectionFor(type) {
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
    if (dateKey !== cursor.toISOString().slice(0, 10)) {
      break;
    }
    streak += 1;
    cursor = new Date(cursor.getTime() - 86400000);
  }
  record.streak = streak;
}

function formatActivity(limit = 8) {
  const rows = readAuditLog(limit);
  if (!rows.length) {
    return "No audit activity yet.";
  }

  return rows
    .map((entry) => {
      const at = entry.at ? new Date(entry.at).toLocaleString() : "unknown time";
      const action = [entry.source, entry.action].filter(Boolean).join("/");
      return `${at} - ${action}${entry.targetId ? ` - ${entry.targetId}` : ""}`;
    })
    .join("\n");
}

function formatCoachSettings(state, guildId) {
  const guildConfig = state.meta.guilds?.[guildId] || {};
  return [
    `Timezone: ${config.timezone}`,
    `Wake reminder: ${String(config.wakeHour).padStart(2, "0")}:${String(config.wakeMinute).padStart(2, "0")}`,
    `Evening nudge: ${String(config.eveningHour).padStart(2, "0")}:${String(config.eveningMinute).padStart(2, "0")}`,
    `Weekly summary day/hour: ${config.weeklySummaryDay} @ ${config.weeklySummaryHour}:${String(config.weeklySummaryMinute).padStart(2, "0")}`,
    `Bot channel: ${guildConfig.botChannelId ? `<#${guildConfig.botChannelId}>` : "not set"}`,
    `Reminder channel: ${guildConfig.reminderChannelId ? `<#${guildConfig.reminderChannelId}>` : config.reminderChannelId || "not set"}`,
    `Dev alert channel: ${guildConfig.devAlertChannelId ? `<#${guildConfig.devAlertChannelId}>` : config.devAlertChannelId ? `<#${config.devAlertChannelId}>` : "not set"}`,
    `Tracked members: ${Object.keys(state.users || {}).length}`,
  ].join("\n");
}

function formatDevEvents(filter = "", limit = 10) {
  const events = latestDevEvents(filter, limit);
  if (!events.length) {
    return "No matching dev events.";
  }

  return events
    .map((event) => {
      const at = event.at ? new Date(event.at).toLocaleString() : "log";
      const label = [event.source, event.action].filter(Boolean).join("/");
      const detail = event.message || event.targetId || "";
      return `${at} - ${label}${detail ? ` - ${detail}` : ""}`;
    })
    .join("\n");
}

async function handleInteraction(interaction, context = {}) {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  const state = readState();
  const meta = state.meta || {};
  if (!meta.guilds) {
    meta.guilds = {};
  }
  state.meta = meta;
  const userId = interaction.user.id;
  const record = getUserRecord(state, userId);

  switch (interaction.commandName) {
    case "help":
      await interaction.reply({
        content: "Mass Shift Coach commands:\n" + getHelpText(),
        ephemeral: true,
      });
      return;
    case "checkin": {
      const weight = interaction.options.getNumber("weight");
      const notes = interaction.options.getString("notes") || "";
      const streak = updateCheckIn(record, weight, notes);
      writeState(state);
      await interaction.reply(
        `Check-in logged at ${weight} lb. Streak is now ${streak} day(s).`
      );
      return;
    }
    case "workout": {
      const note = interaction.options.getString("note", true);
      const duration = interaction.options.getInteger("duration");
      logWorkout(record, note, duration);
      writeState(state);
      await interaction.reply(
        `Workout logged: ${note}${duration ? ` for ${duration} min` : ""}.`
      );
      return;
    }
    case "meal": {
      const type = interaction.options.getString("type", true);
      const calories = interaction.options.getInteger("calories");
      const protein = interaction.options.getInteger("protein");
      const note = interaction.options.getString("note") || "";
      logMeal(record, type, calories, protein, note);
      writeState(state);
      await interaction.reply(
        `${type === "shake" ? "Shake" : "Meal"} logged${calories ? ` at ${calories} kcal` : ""}${protein ? ` and ${protein} g protein` : ""}.`
      );
      return;
    }
    case "goals": {
      const targetWeight = interaction.options.getNumber("target_weight");
      const dailyCalories = interaction.options.getInteger("daily_calories");
      const dailyProtein = interaction.options.getInteger("daily_protein");
      const workoutsPerWeek = interaction.options.getInteger("workouts_per_week");
      const shakesPerDay = interaction.options.getInteger("shakes_per_day");
      const program = interaction.options.getString("program");

      const hasInput = [
        targetWeight,
        dailyCalories,
        dailyProtein,
        workoutsPerWeek,
        shakesPerDay,
        program,
      ].some((value) => value !== null);

      if (hasInput) {
        if (targetWeight !== null) {
          record.profile.targetWeight = targetWeight;
        }
        if (dailyCalories !== null) {
          record.profile.dailyCalories = dailyCalories;
        }
        if (dailyProtein !== null) {
          record.profile.dailyProtein = dailyProtein;
        }
        if (workoutsPerWeek !== null) {
          record.profile.workoutsPerWeek = workoutsPerWeek;
        }
        if (shakesPerDay !== null) {
          record.profile.shakesPerDay = shakesPerDay;
        }
        if (program !== null) {
          record.profile.programName = program;
        }
        writeState(state);
        await interaction.reply("Goals updated.\n```text\n" + formatGoals(record) + "\n```");
        return;
      }

      await interaction.reply("```text\n" + formatGoals(record) + "\n```");
      return;
    }
    case "plan": {
      const programName = interaction.options.getString("program") || record.profile.programName;
      await interaction.reply("```text\n" + formatProgram(programName, state) + "\n```");
      return;
    }
    case "today":
      await interaction.reply("```text\n" + formatTodayPlan(record, state) + "\n\n" + formatDailyAudit(record, state) + "\n```");
      return;
    case "status":
      await interaction.reply("```text\n" + formatStatus(record, state) + "\n```");
      return;
    case "summary":
      await interaction.reply("```text\n" + formatWeeklySummary(displayLabel(userId, record), record, state) + "\n```");
      return;
    case "member-summary": {
      const guard = adminGuard(interaction);
      if (guard) {
        await interaction.reply(guard);
        return;
      }
      const member = interaction.options.getUser("member", true);
      const targetRecord = getUserRecord(state, member.id);
      writeState(state);
      await interaction.reply("```text\n" + formatWeeklySummary(displayLabel(member.id, targetRecord), targetRecord, state) + "\n```");
      return;
    }
    case "leaderboard": {
      const metric = interaction.options.getString("metric", true);
      const rows = buildLeaderboard(state, metric).slice(0, 10);
      const labelMap = {
        streak: "Streak",
        workouts: "Weekly workouts",
        calories: "Average calories",
        protein: "Average protein",
        shakes: "Weekly shakes",
      };
      const lines = rows.map((row, index) => `${index + 1}. ${displayLabel(row.userId, row.record)} - ${row.value}`);
      await interaction.reply(`**${labelMap[metric]} leaderboard**\n` + lines.join("\n"));
      return;
    }
    case "nudge":
      await interaction.reply(getNudge(record));
      return;
    case "coach":
      await interaction.reply("```text\n" + formatDailyAudit(record, state) + "\n\n" + formatWeeklySummary(displayLabel(userId, record), record, state) + "\n```");
      return;
    case "profile": {
      const displayName = interaction.options.getString("display_name");
      if (displayName !== null) {
        record.displayName = displayName.trim().slice(0, 80);
        writeState(state);
        appendAuditLog({
          source: "discord",
          actorId: interaction.user.id,
          guildId: interaction.guildId,
          action: "profile-update",
          targetId: interaction.user.id,
          details: { displayName: record.displayName },
        });
      }
      await interaction.reply({
        content: `Profile name: ${record.displayName || interaction.user.username}`,
        ephemeral: true,
      });
      return;
    }
    case "delete-log": {
      const type = interaction.options.getString("type", true);
      const member = interaction.options.getUser("member");
      if (member && member.id !== interaction.user.id) {
        const guard = adminGuard(interaction);
        if (guard) {
          await interaction.reply(guard);
          return;
        }
      }
      const targetId = member?.id || interaction.user.id;
      const targetRecord = getUserRecord(state, targetId);
      const collectionName = collectionFor(type);
      const collection = targetRecord[collectionName];
      const latestNumber = Math.max(1, interaction.options.getInteger("latest_number") || 1);
      const sorted = [...collection].sort((a, b) => new Date(b.at) - new Date(a.at));
      const entry = sorted[latestNumber - 1];
      if (!entry) {
        await interaction.reply({ content: `No ${type} entry found at that position.`, ephemeral: true });
        return;
      }
      targetRecord[collectionName] = collection.filter((item) => item.id !== entry.id);
      refreshRecordStats(targetRecord);
      writeState(state);
      appendAuditLog({
        source: "discord",
        actorId: interaction.user.id,
        guildId: interaction.guildId,
        action: `${type}-delete`,
        targetId,
        details: { entryId: entry.id },
      });
      await interaction.reply({ content: `Deleted ${type} entry for ${displayLabel(targetId, targetRecord)}.`, ephemeral: true });
      return;
    }
    case "admin-activity": {
      const guard = adminGuard(interaction);
      if (guard) {
        await interaction.reply(guard);
        return;
      }
      await interaction.reply({ content: "```text\n" + formatActivity(10) + "\n```", ephemeral: true });
      return;
    }
    case "coach-settings": {
      const guard = adminGuard(interaction);
      if (guard) {
        await interaction.reply(guard);
        return;
      }
      await interaction.reply({ content: "```text\n" + formatCoachSettings(state, interaction.guildId) + "\n```", ephemeral: true });
      return;
    }
    case "dev-status": {
      const guard = adminGuard(interaction);
      if (guard) {
        await interaction.reply(guard);
        return;
      }
      const snapshot = buildDevSnapshot(context.getHealth ? context.getHealth() : {});
      await interaction.reply({ content: "```text\n" + formatDevStatus(snapshot) + "\n```", ephemeral: true });
      return;
    }
    case "dev-logs": {
      const guard = adminGuard(interaction);
      if (guard) {
        await interaction.reply(guard);
        return;
      }
      const filter = interaction.options.getString("filter") || "";
      await interaction.reply({ content: "```text\n" + formatDevEvents(filter, 12) + "\n```", ephemeral: true });
      return;
    }
    case "set-dev-alert-channel": {
      const guard = adminGuard(interaction);
      if (guard) {
        await interaction.reply(guard);
        return;
      }
      const channel = interaction.options.getChannel("channel", true);
      state.meta.guilds[interaction.guildId] = {
        ...(state.meta.guilds[interaction.guildId] || {}),
        devAlertChannelId: channel.id,
      };
      writeState(state);
      appendAuditLog({
        source: "discord",
        actorId: interaction.user.id,
        guildId: interaction.guildId,
        action: "set-dev-alert-channel",
        targetId: channel.id,
      });
      await interaction.reply({
        content: `Dev alert channel set to <#${channel.id}>. I will keep alerts important-only.`,
        ephemeral: true,
      });
      return;
    }
    case "set-bot-channel": {
      const guard = adminGuard(interaction);
      if (guard) {
        await interaction.reply(guard);
        return;
      }
      const channel = interaction.options.getChannel("channel", true);
      state.meta.guilds[interaction.guildId] = {
        ...(state.meta.guilds[interaction.guildId] || {}),
        botChannelId: channel.id,
      };
      writeState(state);
      appendAuditLog({
        source: "discord",
        actorId: interaction.user.id,
        guildId: interaction.guildId,
        action: "set-bot-channel",
        targetId: channel.id,
      });
      await interaction.reply(`Bot channel set to <#${channel.id}>.`);
      return;
    }
    case "server-status": {
      const guard = adminGuard(interaction);
      if (guard) {
        await interaction.reply(guard);
        return;
      }
      await interaction.reply("```text\n" + formatServerStatus(state) + "\n```");
      return;
    }
    case "backup": {
      const guard = adminGuard(interaction);
      if (guard) {
        await interaction.reply(guard);
        return;
      }
      const backupPath = writeBackup(state);
      appendAuditLog({
        source: "discord",
        actorId: interaction.user.id,
        guildId: interaction.guildId,
        action: "backup",
        targetId: backupPath,
      });
      await interaction.reply({
        content: `Backup written to ${backupPath}`,
        files: [new AttachmentBuilder(backupPath)],
        ephemeral: true,
      });
      return;
    }
    case "export": {
      const guard = adminGuard(interaction);
      if (guard) {
        await interaction.reply(guard);
        return;
      }
      const csvPath = writeTextExport("weekly-export", exportWeeklyCsv(state));
      appendAuditLog({
        source: "discord",
        actorId: interaction.user.id,
        guildId: interaction.guildId,
        action: "export",
        targetId: csvPath,
      });
      await interaction.reply({
        content: `Weekly export written to ${csvPath}`,
        files: [new AttachmentBuilder(csvPath)],
        ephemeral: true,
      });
      return;
    }
    case "set-reminder-channel": {
      const guard = adminGuard(interaction);
      if (guard) {
        await interaction.reply(guard);
        return;
      }

      const channel = interaction.options.getChannel("channel", true);
      state.meta.guilds[interaction.guildId] = {
        ...(state.meta.guilds[interaction.guildId] || {}),
        reminderChannelId: channel.id,
      };
      writeState(state);
      appendAuditLog({
        source: "discord",
        actorId: interaction.user.id,
        guildId: interaction.guildId,
        action: "set-reminder-channel",
        targetId: channel.id,
      });
      await interaction.reply(`Reminder channel set to <#${channel.id}>.`);
      return;
    }
    default:
      if (!interaction.replied) {
        await interaction.reply({
          content: "That command is not wired up yet.",
          ephemeral: true,
        });
      }
  }
}

module.exports = {
  commandData,
  handleInteraction,
};
