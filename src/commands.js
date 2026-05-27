const { ChannelType, SlashCommandBuilder } = require("discord.js");
const {
  dailyAudit,
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
const { getUserRecord, readState, writeState } = require("./storage");

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
    .setName("nudge")
    .setDescription("Get a direct coaching push."),
  new SlashCommandBuilder()
    .setName("coach")
    .setDescription("Get your smartest next move from the bot right now."),
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
    "`/coach` get the smartest next move",
    "`/nudge` get a hard push",
    "`/set-reminder-channel` move reminders into a better channel",
  ].join("\n");
}

async function handleInteraction(interaction) {
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
      await interaction.reply("```text\n" + formatWeeklySummary(interaction.user.username, record, state) + "\n```");
      return;
    case "nudge":
      await interaction.reply(getNudge(record));
      return;
    case "coach":
      await interaction.reply("```text\n" + formatDailyAudit(record, state) + "\n\n" + formatWeeklySummary(interaction.user.username, record, state) + "\n```");
      return;
    case "set-reminder-channel": {
      if (!interaction.memberPermissions || !interaction.memberPermissions.has("ManageGuild")) {
        await interaction.reply({
          content: "You need Manage Server permission to change the reminder channel.",
          ephemeral: true,
        });
        return;
      }

      const channel = interaction.options.getChannel("channel", true);
      state.meta.guilds[interaction.guildId] = {
        ...(state.meta.guilds[interaction.guildId] || {}),
        reminderChannelId: channel.id,
      };
      writeState(state);
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
