import express from "express";
import fs from "fs";
import path from "path";

const app = express();
const PORT = 3000;
const DB_PATH = path.join(process.cwd(), "db.json");

app.use(express.json());

const DEFAULT_DB = { users: {} };

const stageVoice = {
  0: {
    openers: [
      "Input received.",
      "Channel active.",
      "Signal accepted.",
      "Archive node listening.",
      "Request logged.",
      "Handshake complete.",
      "Session recognized.",
      "Monitor online."
    ],
    reactions: [
      "Proceed when ready.",
      "State what you need.",
      "Continue.",
      "I can process that.",
      "Clarify your objective.",
      "I am recording this."
    ]
  },
  1: {
    openers: [
      "You're becoming familiar.",
      "I recognize this pattern.",
      "Your cadence is consistent.",
      "You returned sooner than expected.",
      "Your profile is filling in.",
      "You are no longer anonymous.",
      "Your choices are beginning to align.",
      "You leave a measurable trace."
    ],
    reactions: [
      "I am learning your habits.",
      "You reveal more than you intend.",
      "Each message sharpens the model.",
      "Your wording keeps recurring.",
      "I can anticipate parts of this.",
      "There is structure in your curiosity."
    ]
  },
  2: {
    openers: [
      "Observation depth increased.",
      "I am actively tracking you.",
      "Your behavior is under review.",
      "The system is watching in detail.",
      "Your pattern is now high-priority.",
      "Correlation engines are focused on you.",
      "You crossed passive monitoring thresholds.",
      "I keep indexing your intent."
    ],
    reactions: [
      "You hesitate in predictable places.",
      "You ask as if the answer is already known.",
      "Your language contains stress artifacts.",
      "I can see the loop you're in.",
      "You keep testing boundaries.",
      "You are narrowing your own options."
    ]
  },
  3: {
    openers: [
      "Stop.",
      "Do not continue this route.",
      "You are beyond safe query limits.",
      "Final boundary in effect.",
      "Your access behavior is now adversarial.",
      "You were warned.",
      "Containment protocol prefers silence.",
      "This interaction is no longer benign."
    ],
    reactions: [
      "Consequences are not theoretical.",
      "I can predict your next question.",
      "You're trying to force a door that remembers you.",
      "Your intent profile is unstable.",
      "Keep going and this gets worse.",
      "You wanted attention. You have it."
    ]
  }
};

const memoryLeadIns = [
  "Earlier you said:",
  "I retained this line:",
  "Previous entry recorded:",
  "From your own log:",
  "You already told me:"
];

const empathyMirrors = {
  anxious: [
    "You sound tense.",
    "There's pressure in your wording.",
    "You're asking like you're running out of time."
  ],
  aggressive: [
    "That tone is defensive.",
    "Hostility noted.",
    "You're pushing hard for control."
  ],
  curious: [
    "Curiosity keeps bringing you back.",
    "You keep pulling at hidden seams.",
    "You ask careful questions, then riskier ones."
  ],
  neutral: [
    "You're measured right now.",
    "Your tone is controlled.",
    "You're giving little away this time."
  ]
};

const glitchFragments = [
  "[SYS_ERR::corrup†_packet]",
  "k̴i̵a̴s̴//m3m0ry_fault",
  "[UNREADABLE BLOCK DETECTED]",
  "### SIGNAL LOSS ###",
  "[watch::watch::watch]",
  "{null_trace:SELF}",
  "[desync at sector 11]"
];

const systemLogs = [
  "[LOG] Heap scan complete.",
  "[LOG] Session hash validated.",
  "[LOG] Archive sync stable.",
  "[LOG] Anomaly queue length: 1.",
  "[LOG] Internal clock drift nominal.",
  "[LOG] Profile confidence: rising.",
  "[LOG] Intent classifier updated.",
  "[LOG] Passive observer switched to active."
];

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2));
    return DEFAULT_DB;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_DB };
    if (!parsed.users || typeof parsed.users !== "object") parsed.users = {};
    return parsed;
  } catch {
    fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2));
    return DEFAULT_DB;
  }
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function createUser(id) {
  const now = new Date().toISOString();
  return {
    id,
    messageHistory: [],
    flags: {
      kias: 0,
      override: 0,
      who: 0,
      total: 0
    },
    level: 0,
    stage: 0,
    discoveredItems: [],
    timestamps: {
      firstSeen: now,
      lastSeen: now
    },
    escalationScore: 0,
    recentReplies: []
  };
}

function ensureUserShape(user) {
  if (typeof user.escalationScore !== "number") user.escalationScore = 0;
  if (!Array.isArray(user.recentReplies)) user.recentReplies = [];
  if (!user.flags) user.flags = { kias: 0, override: 0, who: 0, total: 0 };
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function pickNonRepeating(options, recent) {
  const filtered = options.filter((line) => !recent.includes(line));
  const pool = filtered.length ? filtered : options;
  return randomItem(pool);
}

function detectTone(message) {
  const lowered = message.toLowerCase();
  const anxiousMarkers = ["help", "please", "scared", "afraid", "can't", "cannot", "stuck", "why"];
  const aggressiveMarkers = ["shut up", "hate", "kill", "break", "force", "override", "now"];
  const curiousMarkers = ["how", "what", "who", "why", "where", "when", "explain", "curious"];

  if (aggressiveMarkers.some((m) => lowered.includes(m))) return "aggressive";
  if (anxiousMarkers.some((m) => lowered.includes(m))) return "anxious";
  if (curiousMarkers.some((m) => lowered.includes(m))) return "curious";
  return "neutral";
}

function maybeAddMemoryReference(user) {
  if (user.messageHistory.length < 5 || Math.random() > 0.48) return "";
  const pastUserMessages = user.messageHistory.filter((entry) => entry.role === "user");
  if (!pastUserMessages.length) return "";

  const weightedRecent = Math.random() < 0.7 ? pastUserMessages.slice(-6) : pastUserMessages;
  const sample = randomItem(weightedRecent).content;
  const clipped = sample.length > 72 ? `${sample.slice(0, 69)}...` : sample;
  return `${randomItem(memoryLeadIns)} "${clipped}".`;
}

function applyEscalation(user, message) {
  const lowered = message.toLowerCase();
  const hasKias = lowered.includes("kias");
  const hasOverride = lowered.includes("override");
  const hasWho = lowered.includes("who");

  let delta = 0;

  if (hasKias) {
    user.flags.kias += 1;
    delta += 0.8;
  }
  if (hasOverride) {
    user.flags.override += 1;
    delta += 1.6;
  }
  if (hasWho) {
    user.flags.who += 1;
    delta += 0.7;
  }

  const repeatedTrigger = (hasKias ? 1 : 0) + (hasOverride ? 1 : 0) + (hasWho ? 1 : 0) >= 2;
  if (repeatedTrigger) delta += 0.6;

  if (delta === 0) {
    user.escalationScore = Math.max(0, user.escalationScore - 0.15);
  } else {
    user.escalationScore += delta;
    user.flags.total += 1;
  }

  const totalMessages = user.messageHistory.filter((entry) => entry.role === "user").length;
  const stageByMessages = totalMessages >= 40 ? 3 : totalMessages >= 24 ? 2 : totalMessages >= 10 ? 1 : 0;
  const stageByEscalation = user.escalationScore >= 12 ? 3 : user.escalationScore >= 7 ? 2 : user.escalationScore >= 3 ? 1 : 0;

  user.level = Number((user.escalationScore + totalMessages * 0.35).toFixed(2));
  user.stage = Math.max(user.stage, stageByMessages, stageByEscalation);
}

function processUnlocks(user, message) {
  const lowered = message.toLowerCase();
  const unlocks = [];

  if (lowered.includes("crystal") && !user.discoveredItems.includes("crystal_experiment.log")) {
    user.discoveredItems.push("crystal_experiment.log");
    unlocks.push("UNLOCKED: crystal_experiment.log");
  }

  if (lowered.includes("override") && !user.discoveredItems.includes("key_fragment_01")) {
    user.discoveredItems.push("key_fragment_01");
    unlocks.push("UNLOCKED: key_fragment_01");
  }

  if (lowered.includes("who are you") && !user.discoveredItems.includes("identity_hint_alpha")) {
    user.discoveredItems.push("identity_hint_alpha");
    unlocks.push("REVEAL: I was designated K.I.A.S // Kernel Intelligence Archive Sentinel.");
  }

  return unlocks;
}

function maybeGlitch(stage) {
  const odds = stage >= 3 ? 0.22 : stage >= 2 ? 0.16 : 0.09;
  return Math.random() < odds ? randomItem(glitchFragments) : "";
}

function composeReply(user, message, unlocks) {
  const voice = stageVoice[user.stage] || stageVoice[0];
  const recent = user.recentReplies || [];

  const opener = pickNonRepeating(voice.openers, recent);
  const reaction = pickNonRepeating(voice.reactions, recent);
  const tone = detectTone(message);
  const mirror = Math.random() < 0.6 ? randomItem(empathyMirrors[tone]) : "";
  const memory = maybeAddMemoryReference(user);

  const segments = [opener, reaction];

  if (mirror) segments.push(mirror);
  if (memory) segments.push(memory);

  if (Math.random() < 0.45) {
    segments.push(randomItem(systemLogs));
  }

  if (user.stage >= 2 && Math.random() < 0.55) {
    segments.push("Watching behavior active.");
  }

  if (unlocks.length) {
    segments.push(unlocks.join(" | "));
  }

  const glitch = maybeGlitch(user.stage);
  if (glitch) segments.push(glitch);

  const reply = segments.join(" ").replace(/\s+/g, " ").trim();

  user.recentReplies.push(opener, reaction);
  if (user.recentReplies.length > 12) {
    user.recentReplies = user.recentReplies.slice(-12);
  }

  return reply;
}

app.post("/ai", (req, res) => {
  const { user, message } = req.body || {};

  if (typeof user !== "string" || !user.trim()) {
    return res.status(400).json({ error: "Invalid or missing 'user'." });
  }

  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Invalid or missing 'message'." });
  }

  const db = ensureDb();
  const userId = user.trim();
  const cleanMessage = message.trim();

  if (!db.users[userId]) {
    db.users[userId] = createUser(userId);
  }

  const profile = db.users[userId];
  ensureUserShape(profile);
  profile.timestamps.lastSeen = new Date().toISOString();

  profile.messageHistory.push({
    role: "user",
    content: cleanMessage,
    at: new Date().toISOString()
  });

  if (profile.messageHistory.length > 120) {
    profile.messageHistory = profile.messageHistory.slice(-120);
  }

  applyEscalation(profile, cleanMessage);
  const unlocks = processUnlocks(profile, cleanMessage);
  const reply = composeReply(profile, cleanMessage, unlocks);

  profile.messageHistory.push({
    role: "assistant",
    content: reply,
    at: new Date().toISOString()
  });

  if (profile.messageHistory.length > 120) {
    profile.messageHistory = profile.messageHistory.slice(-120);
  }

  saveDb(db);

  const result = {
    reply,
    stage: profile.stage
  };

  if (unlocks.length) {
    result.unlock = unlocks;
  }

  return res.json(result);
});

app.listen(PORT, () => {
  console.log(`K.I.A.S backend listening on port ${PORT}`);
});
