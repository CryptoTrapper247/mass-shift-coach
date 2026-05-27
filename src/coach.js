function isoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function startOfWindow(days) {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function recentItems(items, days) {
  const cutoff = startOfWindow(days);
  return items.filter((item) => new Date(item.at).getTime() >= cutoff);
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function dayItems(items, dateKey) {
  return items.filter((item) => String(item.at).slice(0, 10) === dateKey);
}

function round(value, digits = 1) {
  return Number(value.toFixed(digits));
}

function formatNumber(value, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "not set";
  }

  return `${value}${suffix}`;
}

function updateCheckIn(record, weight, notes, at = new Date().toISOString()) {
  const today = isoDate();
  if (record.lastCheckInDate !== today) {
    const previous = record.lastCheckInDate;
    const yesterday = isoDate(new Date(Date.now() - 86400000));
    record.streak = previous === yesterday ? record.streak + 1 : 1;
  }

  record.lastCheckInDate = today;
  record.checkIns.push({ at, weight, notes: notes || "" });
  return record.streak;
}

function logWorkout(record, note, durationMinutes, at = new Date().toISOString()) {
  record.lastWorkoutAt = at;
  record.workouts.push({
    at,
    note,
    durationMinutes: durationMinutes || null,
  });
  record.planProgressIndex = (record.planProgressIndex || 0) + 1;
}

function logMeal(record, type, calories, protein, note, at = new Date().toISOString()) {
  record.lastMealAt = at;
  record.meals.push({
    at,
    type,
    calories: calories || null,
    protein: protein || null,
    note: note || "",
  });
}

function summarizeWeek(record) {
  const weeklyCheckIns = recentItems(record.checkIns, 7);
  const weeklyWorkouts = recentItems(record.workouts, 7);
  const weeklyMeals = recentItems(record.meals, 7);
  const calories = weeklyMeals
    .map((meal) => Number(meal.calories) || 0)
    .filter((value) => value > 0);
  const protein = weeklyMeals
    .map((meal) => Number(meal.protein) || 0)
    .filter((value) => value > 0);
  const weights = weeklyCheckIns
    .map((entry) => Number(entry.weight))
    .filter((value) => Number.isFinite(value));
  const shakes = weeklyMeals.filter((meal) => meal.type === "shake");
  const avgCalories = calories.length ? round(sum(calories) / calories.length, 0) : null;
  const avgProtein = protein.length ? round(sum(protein) / protein.length, 0) : null;
  const weightDelta =
    weights.length >= 2 ? round(weights[weights.length - 1] - weights[0], 1) : null;

  return {
    checkIns: weeklyCheckIns.length,
    workouts: weeklyWorkouts.length,
    meals: weeklyMeals.length,
    shakes: shakes.length,
    avgCalories,
    avgProtein,
    latestWeight: weights.length ? weights[weights.length - 1] : null,
    weightDelta,
  };
}

function latestWeight(record) {
  const last = [...record.checkIns]
    .reverse()
    .find((entry) => Number.isFinite(Number(entry.weight)));
  return last ? Number(last.weight) : null;
}

function getProgram(record, state) {
  const programName = record.profile.programName || "mass-4-day";
  return state.programs?.[programName] || null;
}

function getNextPlanDay(record, state) {
  const program = getProgram(record, state);
  if (!program || !program.days.length) {
    return null;
  }

  const index = (record.planProgressIndex || 0) % program.days.length;
  return {
    program,
    index,
    day: program.days[index],
  };
}

function coachSignal(record) {
  const summary = summarizeWeek(record);
  const profile = record.profile;
  const wins = [];
  const gaps = [];

  if (record.streak >= 3) {
    wins.push(`streak is alive at ${record.streak} day(s)`);
  }
  if (summary.workouts > 0) {
    wins.push(`${summary.workouts} workout(s) logged this week`);
  }
  if (summary.avgCalories && profile.dailyCalories) {
    const ratio = summary.avgCalories / profile.dailyCalories;
    if (ratio >= 0.9) {
      wins.push(`calories are close to target at ~${summary.avgCalories}/day`);
    } else if (ratio < 0.75) {
      gaps.push(`calories are trailing target at ~${summary.avgCalories}/${profile.dailyCalories}`);
    }
  }
  if (summary.avgProtein && profile.dailyProtein && summary.avgProtein < profile.dailyProtein * 0.8) {
    gaps.push(`protein intake is light at ~${summary.avgProtein}/${profile.dailyProtein}`);
  }
  if (profile.workoutsPerWeek && summary.workouts < profile.workoutsPerWeek) {
    gaps.push(`weekly training pace is ${summary.workouts}/${profile.workoutsPerWeek}`);
  }
  if (profile.shakesPerDay) {
    const weeklyShakeGoal = profile.shakesPerDay * 7;
    if (summary.shakes < weeklyShakeGoal) {
      gaps.push(`shake volume is ${summary.shakes}/${weeklyShakeGoal} for the week`);
    }
  }

  const nextMove = gaps.length
    ? `Next move: ${gaps[0]}. Lock one workout and one calorie-heavy shake today.`
    : "Next move: keep the momentum boring and repeatable. Log the next meal before motivation fades.";

  return {
    wins,
    gaps,
    nextMove,
    summary,
  };
}

function dailySnapshot(record, dateKey = isoDate()) {
  const meals = dayItems(record.meals, dateKey);
  const workouts = dayItems(record.workouts, dateKey);
  const checkIns = dayItems(record.checkIns, dateKey);
  return {
    calories: sum(meals.map((meal) => Number(meal.calories) || 0)),
    protein: sum(meals.map((meal) => Number(meal.protein) || 0)),
    shakes: meals.filter((meal) => meal.type === "shake").length,
    workouts: workouts.length,
    checkIns: checkIns.length,
  };
}

function dailyAudit(record, state, dateKey = isoDate()) {
  const profile = record.profile;
  const today = dailySnapshot(record, dateKey);
  const misses = [];
  const wins = [];
  const nextPlan = getNextPlanDay(record, state);

  if (today.checkIns > 0) {
    wins.push("check-in logged");
  } else {
    misses.push("weight check-in missing");
  }

  if (profile.dailyCalories) {
    if (today.calories >= profile.dailyCalories) {
      wins.push(`calorie target hit at ${today.calories}/${profile.dailyCalories}`);
    } else {
      misses.push(`calories at ${today.calories}/${profile.dailyCalories}`);
    }
  }

  if (profile.dailyProtein) {
    if (today.protein >= profile.dailyProtein) {
      wins.push(`protein target hit at ${today.protein}/${profile.dailyProtein}`);
    } else {
      misses.push(`protein at ${today.protein}/${profile.dailyProtein}`);
    }
  }

  if (profile.shakesPerDay) {
    if (today.shakes >= profile.shakesPerDay) {
      wins.push(`shake target hit at ${today.shakes}/${profile.shakesPerDay}`);
    } else {
      misses.push(`shakes at ${today.shakes}/${profile.shakesPerDay}`);
    }
  }

  const weekly = summarizeWeek(record);
  if (profile.workoutsPerWeek) {
    const daysIntoWeek = Math.max(1, new Date().getDay() + 1);
    const expectedPace = Math.max(
      1,
      Math.floor((profile.workoutsPerWeek / 7) * daysIntoWeek)
    );
    if (weekly.workouts < expectedPace && today.workouts === 0) {
      misses.push(`training pace behind at ${weekly.workouts}/${profile.workoutsPerWeek} this week`);
    }
  }

  const nextMove = misses.length
    ? `Fix first: ${misses[0]}.${nextPlan ? ` Next session is ${nextPlan.day.focus}.` : ""}`
    : `You are on track today.${nextPlan ? ` Stay ahead by preparing ${nextPlan.day.focus} next.` : ""}`;

  return {
    today,
    wins,
    misses,
    nextMove,
    nextPlan,
  };
}

function formatGoals(record) {
  const profile = record.profile;
  return [
    `Target weight: ${formatNumber(profile.targetWeight, " lb")}`,
    `Daily calories: ${formatNumber(profile.dailyCalories, " kcal")}`,
    `Daily protein: ${formatNumber(profile.dailyProtein, " g")}`,
    `Workouts per week: ${formatNumber(profile.workoutsPerWeek)}`,
    `Shakes per day: ${formatNumber(profile.shakesPerDay)}`,
    `Program: ${profile.programName || "mass-4-day"}`,
  ].join("\n");
}

function formatStatus(record, state) {
  const signal = coachSignal(record);
  const summary = signal.summary;
  const currentWeight = latestWeight(record);
  const audit = dailyAudit(record, state);
  const nextPlan = getNextPlanDay(record, state);

  return [
    `Streak: ${record.streak} day(s)`,
    `Latest weight: ${formatNumber(currentWeight, " lb")}`,
    `Weekly workouts: ${summary.workouts}`,
    `Weekly shakes: ${summary.shakes}`,
    `Average calories logged: ${formatNumber(summary.avgCalories, " kcal")}`,
    `Average protein logged: ${formatNumber(summary.avgProtein, " g")}`,
    `Weight change this week: ${formatNumber(summary.weightDelta, " lb")}`,
    `Today's calories: ${audit.today.calories}`,
    `Today's protein: ${audit.today.protein}`,
    `Today's shakes: ${audit.today.shakes}`,
    `Today's workouts: ${audit.today.workouts}`,
    "",
    "Goals:",
    formatGoals(record),
    "",
    "Coaching:",
    audit.nextMove,
    nextPlan ? `Next plan day: ${nextPlan.day.name} - ${nextPlan.day.focus}` : "Next plan day: not set",
  ].join("\n");
}

function formatWeeklySummary(userLabel, record, state) {
  const signal = coachSignal(record);
  const winsLine = signal.wins.length ? signal.wins.join("; ") : "no strong trend yet";
  const gapsLine = signal.gaps.length ? signal.gaps.join("; ") : "no major gaps logged";
  const summary = signal.summary;
  const nextPlan = getNextPlanDay(record, state);

  return [
    `Weekly summary for ${userLabel}`,
    `Weight: ${formatNumber(summary.latestWeight, " lb")} (${formatNumber(summary.weightDelta, " lb")} this week)`,
    `Workouts: ${summary.workouts} | Check-ins: ${summary.checkIns} | Shakes: ${summary.shakes}`,
    `Calories: ${formatNumber(summary.avgCalories, " kcal/day")} | Protein: ${formatNumber(summary.avgProtein, " g/day")}`,
    `Wins: ${winsLine}`,
    `Gaps: ${gapsLine}`,
    nextPlan ? `Up next: ${nextPlan.day.focus}` : "Up next: no plan set",
    signal.nextMove,
  ].join("\n");
}

function getNudge(record) {
  const signal = coachSignal(record);
  const currentWeight = latestWeight(record);
  const targetWeight = record.profile.targetWeight;
  const weightLine =
    currentWeight && targetWeight
      ? `Current read is ${currentWeight} lb and the target is ${targetWeight} lb.`
      : "The mission is still simple: eat enough, train enough, and keep the streak breathing.";

  const nudges = [
    `${weightLine} You do not need a perfect day. You need the next useful rep, meal, and log entry.`,
    `Night shift or not, momentum comes from repetition. ${signal.nextMove}`,
    `Mass is built by boring consistency. Hit the shake, choose the training window, then report back with a check-in.`,
    `You are not chasing hype. You are stacking proof. Log one action right now and let the day get easier after that.`,
  ];

  return nudges[Math.floor(Math.random() * nudges.length)];
}

function formatProgram(programName, state) {
  const program = state.programs?.[programName];
  if (!program) {
    return "Program not found.";
  }

  return [
    `${program.name}`,
    `${program.description}`,
    "",
    ...program.days.map((day) => {
      const lines = [`${day.name}: ${day.focus}`];
      for (const exercise of day.exercises) {
        lines.push(`- ${exercise}`);
      }
      return lines.join("\n");
    }),
  ].join("\n\n");
}

function formatTodayPlan(record, state) {
  const nextPlan = getNextPlanDay(record, state);
  if (!nextPlan) {
    return "No active program is set.";
  }

  return [
    `${nextPlan.program.name}`,
    `${nextPlan.day.name}: ${nextPlan.day.focus}`,
    ...nextPlan.day.exercises.map((exercise) => `- ${exercise}`),
  ].join("\n");
}

function formatDailyAudit(record, state) {
  const audit = dailyAudit(record, state);
  const wins = audit.wins.length ? audit.wins.join("; ") : "none yet";
  const misses = audit.misses.length ? audit.misses.join("; ") : "none right now";

  return [
    "Daily audit",
    `Calories: ${audit.today.calories}`,
    `Protein: ${audit.today.protein}`,
    `Shakes: ${audit.today.shakes}`,
    `Workouts: ${audit.today.workouts}`,
    `Check-ins: ${audit.today.checkIns}`,
    `Wins: ${wins}`,
    `Misses: ${misses}`,
    audit.nextMove,
  ].join("\n");
}

module.exports = {
  coachSignal,
  dailyAudit,
  formatGoals,
  formatDailyAudit,
  formatProgram,
  formatStatus,
  formatTodayPlan,
  formatWeeklySummary,
  getNudge,
  getNextPlanDay,
  isoDate,
  logMeal,
  logWorkout,
  summarizeWeek,
  updateCheckIn,
};
