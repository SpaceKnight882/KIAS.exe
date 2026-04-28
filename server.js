import express from "express";
import fs from "fs";
import path from "path";

const app = express();
const PORT = 3000;
const ROOT = process.cwd();
const STORAGE_DIR = path.join(ROOT, "storage");
const INDEX_PATH = path.join(STORAGE_DIR, "index.json");
const CONFIG_PATH = path.join(ROOT, "config.json");

app.use(express.json({ limit: "50mb" }));

function ensureStorage() {
  if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
  if (!fs.existsSync(INDEX_PATH)) fs.writeFileSync(INDEX_PATH, JSON.stringify({ files: [] }, null, 2));
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ main: "index.html", kias: "kias.html" }, null, 2));
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
  const cleaned = String(name).replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned || `file_${Date.now()}`;
}

function getFileType(name = "") {
  const ext = path.extname(name).toLowerCase();
  if ([".html", ".htm"].includes(ext)) return "html";
  if ([".txt", ".md", ".json", ".xml", ".csv", ".js", ".css"].includes(ext)) return "text";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) return "image";
  return "binary";
}

function indexData() {
  ensureStorage();
  const parsed = readJson(INDEX_PATH, { files: [] });
  if (!Array.isArray(parsed.files)) parsed.files = [];
  return parsed;
}

function saveIndex(data) {
  writeJson(INDEX_PATH, data);
}

function configData() {
  ensureStorage();
  const parsed = readJson(CONFIG_PATH, { main: "index.html", kias: "kias.html" });
  return {
    main: typeof parsed.main === "string" ? sanitizeFileName(parsed.main) : "index.html",
    kias: typeof parsed.kias === "string" ? sanitizeFileName(parsed.kias) : "kias.html"
  };
}

function saveConfig(data) {
  writeJson(CONFIG_PATH, {
    main: sanitizeFileName(data.main || "index.html"),
    kias: sanitizeFileName(data.kias || "kias.html")
  });
}

function resolveMetaByName(name) {
  const data = indexData();
  const file = data.files.find((entry) => entry.name === name);
  return { data, file };
}

function resolveStoragePath(name) {
  return path.join(STORAGE_DIR, sanitizeFileName(name));
}

function serveConfiguredFile(type, res) {
  const cfg = configData();
  const fileName = type === "kias" ? cfg.kias : cfg.main;
  const { file } = resolveMetaByName(fileName);
  if (!file || file.type !== "html") {
    return res.status(404).send(`Configured ${type} page is not available.`);
  }

  const absolutePath = resolveStoragePath(file.name);
  if (!fs.existsSync(absolutePath)) {
    return res.status(404).send(`Configured ${type} page file is missing.`);
  }

  return res.sendFile(absolutePath);
}

ensureStorage();

app.get("/", (_req, res) => serveConfiguredFile("main", res));
app.get("/kias", (_req, res) => serveConfiguredFile("kias", res));

app.get("/files", (_req, res) => {
  const data = indexData();
  const files = data.files
    .slice()
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  res.json({ files });
});

app.get("/config", (_req, res) => {
  const cfg = configData();
  res.json(cfg);
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

    const absolutePath = resolveStoragePath(finalName);
    const buffer = Buffer.from(file.content, "base64");
    fs.writeFileSync(absolutePath, buffer);

    const stat = fs.statSync(absolutePath);
    const fileType = getFileType(finalName);
    const metadata = {
      name: finalName,
      originalName: file.name,
      type: fileType,
      mime: file.mime || "application/octet-stream",
      size: stat.size,
      uploadedAt: new Date().toISOString(),
      path: `storage/${finalName}`
    };

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
  const { file } = resolveMetaByName(fileName);
  if (!file) return res.status(404).json({ error: "File not found." });

  const absolutePath = resolveStoragePath(file.name);
  if (!fs.existsSync(absolutePath)) return res.status(404).json({ error: "Stored file is missing." });

  const isText = file.type === "text" || file.type === "html";
  const buffer = fs.readFileSync(absolutePath);

  return res.json({
    file,
    encoding: isText ? "utf8" : "base64",
    content: isText ? buffer.toString("utf8") : buffer.toString("base64")
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

  const absolutePath = resolveStoragePath(file.name);
  if (!fs.existsSync(absolutePath)) return res.status(404).json({ error: "Stored file is missing." });

  fs.writeFileSync(absolutePath, Buffer.from(content, encoding));
  const stat = fs.statSync(absolutePath);

  file.size = stat.size;
  file.updatedAt = new Date().toISOString();
  saveIndex(data);

  return res.json({ message: "File saved.", file });
});

app.delete("/file/:name", (req, res) => {
  const fileName = sanitizeFileName(req.params.name);
  const { data, file } = resolveMetaByName(fileName);
  if (!file) return res.status(404).json({ error: "File not found." });

  const absolutePath = resolveStoragePath(file.name);
  if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);

  data.files = data.files.filter((entry) => entry.name !== fileName);
  saveIndex(data);

  const cfg = configData();
  let changed = false;
  if (cfg.main === fileName) {
    cfg.main = "index.html";
    changed = true;
  }
  if (cfg.kias === fileName) {
    cfg.kias = "kias.html";
    changed = true;
  }
  if (changed) saveConfig(cfg);

  return res.json({ message: "File deleted.", name: fileName });
});

app.post("/set-target", (req, res) => {
  const type = req.body?.type;
  const fileName = sanitizeFileName(req.body?.file || "");

  if (!["main", "kias"].includes(type)) {
    return res.status(400).json({ error: "type must be 'main' or 'kias'." });
  }

  const { file } = resolveMetaByName(fileName);
  if (!file) return res.status(404).json({ error: "Target file not found." });
  if (file.type !== "html") return res.status(400).json({ error: "Target must be an HTML file." });

  const cfg = configData();
  cfg[type] = fileName;
  saveConfig(cfg);

  return res.json({ message: `${type.toUpperCase()} target updated.`, config: cfg });
});

app.use("/storage", express.static(STORAGE_DIR));

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(ROOT, "admin.html"));
});

app.listen(PORT, () => {
  console.log(`K.I.A.S admin system running on port ${PORT}`);
});
