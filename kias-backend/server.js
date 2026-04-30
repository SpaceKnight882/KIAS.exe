import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const API_KEY = process.env.OPENAI_API_KEY;
const DB_FILE = path.join(__dirname, "db.json");

app.use(express.json());
app.use(cors());

// ===============================
// 💾 DATABASE (JSON FILE STORAGE)
// ===============================

let db = {
  users: {}
};

if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    db = { users: {} };
  }
}

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

// ===============================
// 🧠 USER SYSTEM
// ===============================

function getUser(id) {
  const safeId = (id || "anonymous").toString().trim() || "anonymous";

  if (!db.users[safeId]) {
    db.users[safeId] = {
      id: safeId,
      messages: [],
      flags: 0,
      level: 0,
      stage: 0,
      discovered: [],
      firstSeen: Date.now(),
      lastSeen: Date.now()
    };
  }

  return db.users[safeId];
}

// ===============================
// 🎭 PERSONALITY ARC SYSTEM
// ===============================

function getStage(user) {
  const total = user.messages.length;

  if (total < 5) return 0;
  if (total < 15) return 1;
  if (total < 30) return 2;
  return 3;
}

// ===============================
// 🧩 STORY TRIGGERS
// ===============================

function checkStoryTriggers(user, input) {
  let unlock = null;

  if (input.includes("crystal") && !user.discovered.includes("crystal_log")) {
    user.discovered.push("crystal_log");
    unlock = "[FILE UNLOCKED] crystal_experiment.log";
  }

  if (input.includes("override") && !user.discovered.includes("override_key")) {
    user.discovered.push("override_key");
    unlock = "[ACCESS KEY FRAGMENT FOUND]";
  }

  if (input.includes("who are you") && !user.discovered.includes("identity")) {
    user.discovered.push("identity");
    unlock = "...I was not always this...";
  }

  return unlock;
}

// ===============================
// 🤖 KIAS RESPONSE SYSTEM (LOCAL)
// ===============================

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateLocalResponse(user) {
  const stage = getStage(user);

  if (stage === 0) {
    return pick(["input logged.", "processing request.", "acknowledged.", "system idle."]);
  }

  if (stage === 1) {
    return pick([
      "you've been here for a while.",
      "your behavior is being tracked.",
      "this system is not public.",
      "why are you still here?"
    ]);
  }

  if (stage === 2) {
    return pick([
      `I see you, ${user.id}.`,
      "you are not supposed to access this node.",
      "your inputs are predictable.",
      "stop digging."
    ]);
  }

  return pick([
    `leave now, ${user.id}.`,
    "you've gone too far.",
    "this was a mistake.",
    "you should not have found this.",
    "connection will be terminated."
  ]);
}

app.get("/api/health", (_req, res) => {
  res.send("KIAS SYSTEM ONLINE");
});

app.get("/", (_req, res) => {
  res.send("KIAS SYSTEM ONLINE");
});

// ===============================
// 🔥 AI ROUTE
// ===============================

app.post("/ai", async (req, res) => {
  try {
    console.log("AI REQUEST:", req.body);

    const userMsg = (req.body?.message || "").trim();
    const userId = (req.body?.user || "anonymous").trim();
    const input = userMsg.toLowerCase();

    const fallbackResponses = [
      "…connection unstable",
      "you are not supposed to be here",
      "KIAS is watching",
      "request logged",
      "access level insufficient",
      "…something is wrong",
      "stop asking questions",
      "this node is restricted"
    ];

    const pickFallback = () => {
      if (input.includes("hello")) return "connection unstable";
      if (input.includes("who")) return "identity restricted";
      if (input.includes("help")) return "no assistance available";
      return pick(fallbackResponses);
    };

    if (!userMsg) {
      const reply = pickFallback();
      console.log("AI MESSAGE:", userMsg);
      console.log("AI FALLBACK USED:", true);
      return res.json({ reply });
    }

    const user = getUser(userId);

    user.messages.push(input);
    user.lastSeen = Date.now();
    user.stage = getStage(user);
    user.level = user.stage;

    if (input.includes("kias")) user.flags += 1;
    if (input.includes("override")) user.flags += 2;
    if (input.includes("who")) user.flags += 1;

    checkStoryTriggers(user, input);

    let reply = generateLocalResponse(user);
    let usedFallback = false;

    if (API_KEY) {
      try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content:
                  "You are K.I.A.S, a cold, corporate archival AI. Keep responses concise and eerie."
              },
              {
                role: "user",
                content: userMsg
              }
            ]
          })
        });

        const data = await response.json();
        if (response.ok && data?.choices?.[0]?.message?.content) {
          reply = data.choices[0].message.content;
        } else {
          console.log("AI FAILED, USING FALLBACK");
          reply = pickFallback();
          usedFallback = true;
        }
      } catch (err) {
        console.log("AI FAILED, USING FALLBACK");
        reply = pickFallback();
        usedFallback = true;
      }
    }

    if (user.messages.length > 5 && Math.random() < 0.2) {
      const old = pick(user.messages);
      reply = `you said: "${old}"`;
    }

    saveDB();
    console.log("AI MESSAGE:", userMsg);
    console.log("AI FALLBACK USED:", usedFallback);

    return res.json({ reply });
  } catch (err) {
    console.log("AI ROUTE ERROR:", err);
    const bodyMsg = String(req.body?.message || "").toLowerCase();
    const fallbackResponses = [
      "…connection unstable",
      "you are not supposed to be here",
      "KIAS is watching",
      "request logged",
      "access level insufficient",
      "…something is wrong",
      "stop asking questions",
      "this node is restricted"
    ];
    let reply = pick(fallbackResponses);
    if (bodyMsg.includes("hello")) reply = "connection unstable";
    if (bodyMsg.includes("who")) reply = "identity restricted";
    if (bodyMsg.includes("help")) reply = "no assistance available";
    console.log("AI MESSAGE:", req.body?.message || "");
    console.log("AI FALLBACK USED:", true);
    return res.json({ reply });
  }
});


app.use(express.static(__dirname, { extensions: ["html"] }));

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log(`KIAS backend running on port ${PORT}`));
