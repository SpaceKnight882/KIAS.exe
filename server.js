import express from "express";
import fs from "fs";
import path from "path";

const app = express();
const PORT = 3000;
const ROOT = process.cwd();
const STORAGE_DIR = path.join(ROOT, "storage");
const INDEX_PATH = path.join(STORAGE_DIR, "index.json");
const TARGET_PATH = path.join(STORAGE_DIR, "target.json");
const MEMORY_PATH = path.join(ROOT, "db.json");

app.use(express.json({ limit: "50mb" }));

function ensureStorage() {
  if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
  if (!fs.existsSync(INDEX_PATH)) fs.writeFileSync(INDEX_PATH, JSON.stringify({ files: [] }, null, 2));
  if (!fs.existsSync(TARGET_PATH)) fs.writeFileSync(TARGET_PATH, JSON.stringify({ activeTarget: null }, null, 2));
  if (!fs.existsSync(MEMORY_PATH)) {
    fs.writeFileSync(
      MEMORY_PATH,
      JSON.stringify({ users: {}, ai: { responses: [], interactions: [] }, logs: [] }, null, 2)
    );
  }
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function sanitizeFileName(name = "file") {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned || `file_${Date.now()}`;
}

function getFileType(name = "") {
  const ext = path.extname(name).toLowerCase();
  if ([".html", ".htm"].includes(ext)) return "html";
  if ([".txt", ".md", ".json", ".xml", ".csv", ".js", ".css"].includes(ext)) return "text";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) return "image";
  return "binary";
}

function normalizeFile(entry = {}) {
  return {
    name: entry.name || "",
    originalName: entry.originalName || entry.name || "",
    type: entry.type || getFileType(entry.name || ""),
    mime: entry.mime || "application/octet-stream",
    size: Number(entry.size || 0),
    uploadedAt: entry.uploadedAt || new Date().toISOString(),
    path: entry.path || `storage/${entry.name || ""}`,
    corruptionLevel: Number.isInteger(entry.corruptionLevel) ? Math.max(0, Math.min(3, entry.corruptionLevel)) : 0,
    locked: Boolean(entry.locked),
    unlockCondition: typeof entry.unlockCondition === "string" ? entry.unlockCondition : "",
    hint: entry.hint || "Progress further to unlock.",
    updatedAt: entry.updatedAt
  };
}

function indexData() {
  ensureStorage();
  const parsed = readJson(INDEX_PATH, { files: [] });
  if (!Array.isArray(parsed.files)) parsed.files = [];
  parsed.files = parsed.files.map(normalizeFile);
  return parsed;
}

function saveIndex(data) {
  data.files = (data.files || []).map(normalizeFile);
  writeJson(INDEX_PATH, data);
}

function memoryData() {
  ensureStorage();
  const data = readJson(MEMORY_PATH, { users: {}, ai: { responses: [], interactions: [] }, logs: [] });
  if (!data.users || typeof data.users !== "object") data.users = {};
  if (!data.ai || typeof data.ai !== "object") data.ai = { responses: [], interactions: [] };
  if (!Array.isArray(data.ai.responses)) data.ai.responses = [];
  if (!Array.isArray(data.ai.interactions)) data.ai.interactions = [];
  if (!Array.isArray(data.logs)) data.logs = [];
  return data;
}

function saveMemory(data) {
  writeJson(MEMORY_PATH, data);
}

function addSystemLog(message, event = "system") {
  const memory = memoryData();
  const entry = { timestamp: new Date().toISOString(), event, message };
  memory.logs.unshift(entry);
  memory.logs = memory.logs.slice(0, 500);
  saveMemory(memory);
  return entry;
}

function resolveMetaByName(name) {
  const data = indexData();
  const file = data.files.find((entry) => entry.name === name);
  return { data, file };
}

function getUserProgression(userId) {
  const safeId = String(userId || "guest");
  const memory = memoryData();
  if (!memory.users[safeId]) {
    memory.users[safeId] = { id: safeId, stage: 0, discoveredItems: [], flagged: false, unlockedFiles: [] };
    saveMemory(memory);
  }
  const user = memory.users[safeId];
  user.stage = Number(user.stage || 0);
  if (!Array.isArray(user.discoveredItems)) user.discoveredItems = [];
  if (!Array.isArray(user.unlockedFiles)) user.unlockedFiles = [];
  return { memory, user, userId: safeId };
}

function isFileUnlocked(file, user) {
  if (!file.locked) return true;
  const condition = (file.unlockCondition || "").trim();
  if (!condition) return !file.locked;
  if (condition.startsWith("stage_")) {
    const required = Number(condition.replace("stage_", ""));
    if (Number.isFinite(required) && user.stage >= required) return true;
  }
  if (user.discoveredItems.includes(condition)) return true;
  if (user.unlockedFiles.includes(file.name)) return true;
  return false;
}

function redactFileMeta(file) {
  return {
    ...file,
    redactedName: "REDACTED",
    access: "locked",
    hint: file.hint || `Requires unlock condition: ${file.unlockCondition || "unknown"}`
  };
}

function randomGlyph() {
  const chars = "#$%&@?/\\*+=_~<>[]{};:!";
  return chars[Math.floor(Math.random() * chars.length)];
}

function applyCorruption(content, level = 0) {
  const safeLevel = Math.max(0, Math.min(3, Number(level) || 0));
  if (safeLevel === 0 || typeof content !== "string") return content;

  const lines = content.split("\n");
  const mutateChars = (input, ratio) => input
    .split("")
    .map((ch) => {
      if (ch === " " || ch === "\n") return ch;
      return Math.random() < ratio ? randomGlyph() : ch;
    })
    .join("");

  if (safeLevel === 1) {
    return mutateChars(content, 0.06);
  }

  if (safeLevel === 2) {
    const markers = ["###DATA LOST###", "////ERROR////"];
    const transformed = lines
      .map((line) => {
        if (Math.random() < 0.18) return "";
        if (Math.random() < 0.2) return line.split("").reverse().join("");
        return mutateChars(line, 0.14);
      })
      .filter((line) => line.length || Math.random() > 0.3);

    const insertCount = Math.max(1, Math.floor(transformed.length * 0.1));
    for (let i = 0; i < insertCount; i += 1) {
      const at = Math.floor(Math.random() * (transformed.length + 1));
      transformed.splice(at, 0, markers[Math.floor(Math.random() * markers.length)]);
    }
    return transformed.join("\n");
  }

  const heavilyCorrupted = lines
    .map((line) => {
      if (Math.random() < 0.4) return "█".repeat(Math.max(5, Math.floor(line.length * 0.7)));
      return mutateChars(line, 0.4);
    })
    .filter((line) => Math.random() > 0.15 || line.includes("█"));

  return heavilyCorrupted.join("\n");
}

ensureStorage();

app.get("/files", (req, res) => {
  const userId = req.query.user;
  const data = indexData();
  const files = data.files
    .slice()
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

  if (!userId) {
    return res.json({ files, mode: "admin" });
  }

  const { user } = getUserProgression(userId);
  const visible = files.map((file) => {
    const unlocked = isFileUnlocked(file, user);
    if (!unlocked) return redactFileMeta(file);
    return { ...file, access: "open" };
  });

  return res.json({ files: visible, user: { stage: user.stage, discoveredItems: user.discoveredItems }, mode: "user" });
});

app.get("/logs", (_req, res) => {
  const memory = memoryData();
  res.json({ logs: memory.logs });
});

app.get("/kias/monitor", (_req, res) => {
  const memory = memoryData();
  res.json({
    responses: memory.ai.responses.slice(0, 50),
    interactions: memory.ai.interactions.slice(0, 50),
    users: memory.users
  });
});

app.post("/kias/inject", (req, res) => {
  const { userId = "broadcast", message, actor = "ADMIN" } = req.body || {};
  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Message is required." });
  }
  const memory = memoryData();
  const entry = {
    timestamp: new Date().toISOString(),
    userId: String(userId),
    actor,
    message: message.trim(),
    source: "manual_override"
  };
  memory.ai.responses.unshift(entry);
  memory.ai.responses = memory.ai.responses.slice(0, 200);
  saveMemory(memory);
  addSystemLog(`[AI INJECT]: ${entry.userId} :: ${entry.message}`, "ai_response_generated");
  return res.json({ message: "Injection accepted.", entry });
});

app.post("/kias/flag", (req, res) => {
  const { userId, flagged = true, reason = "manual" } = req.body || {};
  if (!userId) return res.status(400).json({ error: "userId is required." });
  const { memory, user, userId: safeId } = getUserProgression(userId);
  user.flagged = Boolean(flagged);
  user.flagReason = reason;
  memory.users[safeId] = user;
  memory.ai.interactions.unshift({
    timestamp: new Date().toISOString(),
    userId: safeId,
    type: "flag",
    payload: { flagged: user.flagged, reason }
  });
  saveMemory(memory);
  addSystemLog(`[USER FLAGGED]: ${safeId} => ${user.flagged ? "FLAGGED" : "CLEARED"}`, "user_flagged");
  return res.json({ message: "User flag updated.", user });
});

app.post("/kias/set-stage", (req, res) => {
  const { userId, stage } = req.body || {};
  if (!userId) return res.status(400).json({ error: "userId is required." });
  const numericStage = Number(stage);
  if (!Number.isFinite(numericStage) || numericStage < 0) {
    return res.status(400).json({ error: "stage must be a positive number." });
  }
  const { memory, user, userId: safeId } = getUserProgression(userId);
  user.stage = Math.floor(numericStage);
  memory.users[safeId] = user;
  memory.ai.interactions.unshift({
    timestamp: new Date().toISOString(),
    userId: safeId,
    type: "stage_update",
    payload: { stage: user.stage }
  });
  saveMemory(memory);
  addSystemLog(`[STAGE UPDATE]: ${safeId} -> stage_${user.stage}`, "stage_updated");
  return res.json({ message: "Stage updated.", user });
});

app.post("/kias/unlock-file", (req, res) => {
  const { userId, fileName } = req.body || {};
  if (!userId || !fileName) return res.status(400).json({ error: "userId and fileName are required." });
  const safeName = sanitizeFileName(fileName);
  const { file } = resolveMetaByName(safeName);
  if (!file) return res.status(404).json({ error: "File not found." });

  const { memory, user, userId: safeId } = getUserProgression(userId);
  if (!user.unlockedFiles.includes(safeName)) user.unlockedFiles.push(safeName);
  memory.users[safeId] = user;
  saveMemory(memory);
  addSystemLog(`[FILE UNLOCKED]: ${safeName}`, "file_unlocked");
  return res.json({ message: "File unlocked for user.", user, fileName: safeName });
});

app.post("/upload", (req, res) => {
  const incoming = req.body?.files;
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return res.status(400).json({ error: "No files provided." });
  }

  const data = indexData();
  const saved = [];

  for (const file of incoming) {
    if (!file?.name || typeof file.content !== "string") continue;

    const safeName = sanitizeFileName(file.name);
    const existing = data.files.find((entry) => entry.name === safeName);
    const finalName = existing ? `${Date.now()}_${safeName}` : safeName;

    const absolutePath = path.join(STORAGE_DIR, finalName);
    const buffer = Buffer.from(file.content, "base64");

    fs.writeFileSync(absolutePath, buffer);

    const stat = fs.statSync(absolutePath);
    const fileType = getFileType(finalName);
    const metadata = normalizeFile({
      name: finalName,
      originalName: file.name,
      type: fileType,
      mime: file.mime || "application/octet-stream",
      size: stat.size,
      uploadedAt: new Date().toISOString(),
      path: `storage/${finalName}`,
      corruptionLevel: Number(file.corruptionLevel || 0),
      locked: Boolean(file.locked),
      unlockCondition: file.unlockCondition || "",
      hint: file.hint || "Progress further to unlock."
    });

    data.files = data.files.filter((entry) => entry.name !== finalName);
    data.files.push(metadata);
    saved.push(metadata);
  }

  saveIndex(data);

  if (!saved.length) {
    return res.status(400).json({ error: "No valid files were uploaded." });
  }

  return res.json({ message: "Upload successful.", files: saved });
});

app.get("/file/:name", (req, res) => {
  const fileName = sanitizeFileName(req.params.name);
  const userId = req.query.user;
  const mode = req.query.mode === "corrupted" ? "corrupted" : "raw";
  const { file } = resolveMetaByName(fileName);
  if (!file) return res.status(404).json({ error: "File not found." });

  if (userId) {
    const { user } = getUserProgression(userId);
    if (!isFileUnlocked(file, user)) {
      return res.status(403).json({ error: "File is locked.", hint: file.hint, unlockCondition: file.unlockCondition });
    }
  }

  const absolutePath = path.join(ROOT, file.path);
  if (!fs.existsSync(absolutePath)) return res.status(404).json({ error: "Stored file is missing." });

  const isText = file.type === "text" || file.type === "html";
  const buffer = fs.readFileSync(absolutePath);
  const rawContent = isText ? buffer.toString("utf8") : buffer.toString("base64");
  const content = isText && mode === "corrupted" ? applyCorruption(rawContent, file.corruptionLevel) : rawContent;

  if (mode === "corrupted" && file.corruptionLevel > 0) {
    addSystemLog(`[CORRUPTION TRIGGERED]: ${file.name} @ L${file.corruptionLevel}`, "corruption_triggered");
  }

  return res.json({
    file,
    viewMode: mode,
    encoding: isText ? "utf8" : "base64",
    content,
    rawContent: isText ? rawContent : undefined
  });
});

app.post("/file/:name", (req, res) => {
  const fileName = sanitizeFileName(req.params.name);
  const content = req.body?.content;
  const encoding = req.body?.encoding === "base64" ? "base64" : "utf8";

  if (typeof content !== "string") {
    return res.status(400).json({ error: "Invalid content." });
  }

  const { data, file } = resolveMetaByName(fileName);
  if (!file) return res.status(404).json({ error: "File not found." });

  const absolutePath = path.join(ROOT, file.path);
  if (!fs.existsSync(absolutePath)) return res.status(404).json({ error: "Stored file is missing." });

  fs.writeFileSync(absolutePath, Buffer.from(content, encoding));
  const stat = fs.statSync(absolutePath);

  file.size = stat.size;
  file.updatedAt = new Date().toISOString();
  if (Number.isInteger(req.body?.corruptionLevel)) file.corruptionLevel = Math.max(0, Math.min(3, req.body.corruptionLevel));
  if (typeof req.body?.locked === "boolean") file.locked = req.body.locked;
  if (typeof req.body?.unlockCondition === "string") file.unlockCondition = req.body.unlockCondition;
  if (typeof req.body?.hint === "string") file.hint = req.body.hint;
  saveIndex(data);

  return res.json({ message: "File saved.", file });
});

app.patch("/file/:name/meta", (req, res) => {
  const fileName = sanitizeFileName(req.params.name);
  const { data, file } = resolveMetaByName(fileName);
  if (!file) return res.status(404).json({ error: "File not found." });

  if (Number.isInteger(req.body?.corruptionLevel)) file.corruptionLevel = Math.max(0, Math.min(3, req.body.corruptionLevel));
  if (typeof req.body?.locked === "boolean") file.locked = req.body.locked;
  if (typeof req.body?.unlockCondition === "string") file.unlockCondition = req.body.unlockCondition;
  if (typeof req.body?.hint === "string") file.hint = req.body.hint;
  file.updatedAt = new Date().toISOString();
  saveIndex(data);

  return res.json({ message: "Metadata updated.", file });
});

app.delete("/file/:name", (req, res) => {
  const fileName = sanitizeFileName(req.params.name);
  const { data, file } = resolveMetaByName(fileName);
  if (!file) return res.status(404).json({ error: "File not found." });

  const absolutePath = path.join(ROOT, file.path);
  if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);

  data.files = data.files.filter((entry) => entry.name !== fileName);
  saveIndex(data);

  const target = readJson(TARGET_PATH, { activeTarget: null });
  if (target.activeTarget === fileName) {
    target.activeTarget = null;
    writeJson(TARGET_PATH, target);
  }

  return res.json({ message: "File deleted.", name: fileName });
});

app.get("/target", (_req, res) => {
  const target = readJson(TARGET_PATH, { activeTarget: null });
  if (!target.activeTarget) return res.json({ activeTarget: null, html: "" });

  const { file } = resolveMetaByName(target.activeTarget);
  if (!file) return res.json({ activeTarget: null, html: "" });

  const absolutePath = path.join(ROOT, file.path);
  if (!fs.existsSync(absolutePath)) return res.json({ activeTarget: null, html: "" });

  const html = fs.readFileSync(absolutePath, "utf8");
  return res.json({ activeTarget: file.name, html, file });
});

app.post("/target", (req, res) => {
  const name = sanitizeFileName(req.body?.name || "");
  const { file } = resolveMetaByName(name);

  if (!file) return res.status(404).json({ error: "Target file not found." });
  if (file.type !== "html") return res.status(400).json({ error: "Target must be an HTML file." });

  writeJson(TARGET_PATH, { activeTarget: name });
  return res.json({ message: "Active target updated.", activeTarget: name });
});

app.use("/storage", express.static(STORAGE_DIR));
app.use(express.static(ROOT));

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(ROOT, "admin.html"));
});

app.listen(PORT, () => {
  console.log(`K.I.A.S admin system running on port ${PORT}`);
});
