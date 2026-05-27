const fs = require("fs");
const path = require("path");

const STATE_PATH = path.join(__dirname, "..", "data", "state.json");

function defaultProfile() {
  return {
    targetWeight: null,
    dailyCalories: null,
    dailyProtein: null,
    workoutsPerWeek: null,
    shakesPerDay: null,
    programName: "mass-4-day",
  };
}

function defaultPlanDay(name, focus, exercises) {
  return {
    name,
    focus,
    exercises,
  };
}

function defaultPrograms() {
  return {
    "mass-3-day": {
      name: "Mass 3-Day",
      description: "Three full-body sessions built for recovery and steady size gains.",
      days: [
        defaultPlanDay("Day 1", "Full Body A", [
          "Back squat 4x6",
          "Bench press 4x6",
          "Chest-supported row 4x8",
          "Romanian deadlift 3x8",
          "Lateral raise 3x15",
          "Weighted plank 3 rounds",
        ]),
        defaultPlanDay("Day 2", "Full Body B", [
          "Deadlift 3x5",
          "Incline dumbbell press 4x8",
          "Pull-up or pulldown 4x8",
          "Walking lunge 3x10 each leg",
          "Cable fly 3x12",
          "Hammer curl 3x12",
        ]),
        defaultPlanDay("Day 3", "Full Body C", [
          "Front squat 4x5",
          "Overhead press 4x6",
          "Barbell row 4x8",
          "Hip thrust 3x10",
          "Machine chest press 3x12",
          "Skullcrusher 3x12",
        ]),
      ],
    },
    "mass-4-day": {
      name: "Mass 4-Day",
      description: "Upper/lower split for more volume without destroying recovery.",
      days: [
        defaultPlanDay("Day 1", "Upper Push", [
          "Bench press 4x6",
          "Incline dumbbell press 4x8",
          "Seated overhead press 3x8",
          "Cable fly 3x12",
          "Lateral raise 4x15",
          "Rope pressdown 3x12",
        ]),
        defaultPlanDay("Day 2", "Lower A", [
          "Back squat 4x6",
          "Romanian deadlift 4x8",
          "Leg press 3x12",
          "Leg curl 3x12",
          "Standing calf raise 4x15",
          "Hanging knee raise 3x12",
        ]),
        defaultPlanDay("Day 3", "Upper Pull", [
          "Weighted pull-up or pulldown 4x8",
          "Barbell row 4x8",
          "Chest-supported rear delt raise 3x15",
          "Seated cable row 3x10",
          "EZ-bar curl 3x12",
          "Hammer curl 3x12",
        ]),
        defaultPlanDay("Day 4", "Lower B", [
          "Deadlift 3x5",
          "Front squat 4x6",
          "Bulgarian split squat 3x10 each leg",
          "Hip thrust 3x10",
          "Seated calf raise 4x15",
          "Cable crunch 3x15",
        ]),
      ],
    },
    "mass-5-day": {
      name: "Mass 5-Day",
      description: "Higher-volume split for aggressive hypertrophy when recovery is solid.",
      days: [
        defaultPlanDay("Day 1", "Chest + Triceps", [
          "Bench press 4x6",
          "Incline dumbbell press 4x8",
          "Machine chest press 3x10",
          "Cable fly 3x15",
          "Dip or pressdown 4x12",
        ]),
        defaultPlanDay("Day 2", "Back + Biceps", [
          "Deadlift 3x5",
          "Pulldown 4x8",
          "Barbell row 4x8",
          "Seated cable row 3x12",
          "EZ curl 4x12",
        ]),
        defaultPlanDay("Day 3", "Legs", [
          "Back squat 4x6",
          "Romanian deadlift 4x8",
          "Leg press 3x12",
          "Leg curl 3x12",
          "Calf raise 5x15",
        ]),
        defaultPlanDay("Day 4", "Shoulders", [
          "Overhead press 4x6",
          "Arnold press 3x10",
          "Lateral raise 5x15",
          "Rear delt fly 4x15",
          "Shrug 3x12",
        ]),
        defaultPlanDay("Day 5", "Pump + Arms", [
          "Incline machine press 3x12",
          "Chest-supported row 3x12",
          "Cable curl 3x15",
          "Overhead rope extension 3x15",
          "Loaded carry 4 trips",
        ]),
      ],
    },
  };
}

function defaultUserRecord() {
  return {
    streak: 0,
    lastCheckInDate: null,
    lastWorkoutAt: null,
    lastMealAt: null,
    planProgressIndex: 0,
    profile: defaultProfile(),
    checkIns: [],
    workouts: [],
    meals: [],
  };
}

function defaultState() {
  return {
    meta: {
      schedules: {},
      guilds: {},
    },
    programs: defaultPrograms(),
    users: {},
  };
}

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    return {
      ...defaultState(),
      ...parsed,
      meta: {
        ...defaultState().meta,
        ...(parsed.meta || {}),
        guilds: {
          ...defaultState().meta.guilds,
          ...((parsed.meta && parsed.meta.guilds) || {}),
        },
      },
      programs: {
        ...defaultPrograms(),
        ...(parsed.programs || {}),
      },
      users: parsed.users || {},
    };
  } catch (error) {
    return defaultState();
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function getUserRecord(state, userId) {
  if (!state.users[userId]) {
    state.users[userId] = defaultUserRecord();
  }

  state.users[userId] = {
    ...defaultUserRecord(),
    ...state.users[userId],
    profile: {
      ...defaultProfile(),
      ...(state.users[userId].profile || {}),
    },
    checkIns: state.users[userId].checkIns || [],
    workouts: state.users[userId].workouts || [],
    meals: state.users[userId].meals || [],
  };

  return state.users[userId];
}

module.exports = {
  STATE_PATH,
  defaultState,
  defaultPrograms,
  getUserRecord,
  readState,
  writeState,
};
