import express from "express";
import fs from "fs";
import path from "path";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ROOT = process.cwd();
const STORAGE_DIR = path.join(ROOT, "storage");
const INDEX_PATH = path.join(STORAGE_DIR, "index.json");
const CONFIG_PATH = path.join(ROOT, "config.json");
const MEMORY_PATH = path.join(ROOT, "db.json");

app.use(express.json({ limit: "50mb" }));

function ensureStorage() {
  if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
  if (!fs.existsSync(INDEX_PATH)) fs.writeFileSync(INDEX_PATH, JSON.stringify({ files: [] }, null, 2));
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ main: "index.html", kias: "kias.html" }, null, 2));
  }
  if (!fs.existsSync(MEMORY_PATH)) {
    fs.writeFileSync(MEMORY_PATH, JSON.stringify({ users: {}, ai: { responses: [], interactions: [] }, logs: [] }, null, 2));
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

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function sanitizeFileName(name = "") {
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

function normalizeFile(file = {}) {
  return {
    id: file.id || `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    name: sanitizeFileName(file.name || "file"),
    originalName: file.originalName || file.name || "",
    destination: ["main", "kias", "assets"].includes(file.destination) ? file.destination : "assets",
    type: file.type || getFileType(file.name || ""),
    mime: file.mime || "application/octet-stream",
    size: Number(file.size || 0),
    uploadedAt: file.uploadedAt || new Date().toISOString(),
    path: file.path || `storage/${sanitizeFileName(file.name || "file")}`,
    updatedAt: file.updatedAt || null
  };
}

function indexData() {
  ensureStorage();
  const data = readJson(INDEX_PATH, { files: [] });
  if (!Array.isArray(data.files)) data.files = [];
  data.files = data.files.map(normalizeFile);
  return data;
}

function saveIndex(data) {
  data.files = (data.files || []).map(normalizeFile);
  writeJson(INDEX_PATH, data);
}

function configData() {
  ensureStorage();
  const cfg = readJson(CONFIG_PATH, { main: "index.html", kias: "kias.html" });
  return {
    main: sanitizeFileName(cfg.main || "index.html"),
    kias: sanitizeFileName(cfg.kias || "kias.html")
  };
}

function saveConfig(config) {
  writeJson(CONFIG_PATH, {
    main: sanitizeFileName(config.main || "index.html"),
    kias: sanitizeFileName(config.kias || "kias.html")
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

function ensureUniqueName(files, safeName) {
  if (!files.some((file) => file.name === safeName)) return safeName;
  return `${Date.now()}_${safeName}`;
}

function setTargetConfig(type, fileName) {
  if (!["main", "kias"].includes(type)) {
    return { status: 400, error: "type must be 'main' or 'kias'." };
  }

  const { file } = resolveMetaByName(fileName);
  if (!file) return { status: 404, error: "Target file not found." };
  if (file.type !== "html") return { status: 400, error: "Target must be an HTML file." };

  const config = configData();
  config[type] = fileName;
  saveConfig(config);
  return { config };
}

function serveConfiguredFile(type, res) {
  const config = configData();
  const fileName = type === "kias" ? config.kias : config.main;
  const { file } = resolveMetaByName(fileName);

  if (file) {
    const storagePath = resolveStoragePath(file.name);
    if (fs.existsSync(storagePath)) return res.sendFile(storagePath);
  }

  const storageFallback = resolveStoragePath(fileName);
  if (fs.existsSync(storageFallback)) return res.sendFile(storageFallback);

  const rootFallback = path.join(ROOT, fileName);
  if (fs.existsSync(rootFallback)) return res.sendFile(rootFallback);

  return res.status(404).send(`Configured ${type} page is not available.`);
}

ensureStorage();

app.get("/", (_req, res) => serveConfiguredFile("main", res));
app.get("/kias", (_req, res) => serveConfiguredFile("kias", res));

app.get("/files", (_req, res) => {
  const data = indexData();
  const files = data.files
    .slice()
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  return res.json({ files, mode: "admin" });
});

app.get("/config", (_req, res) => {
  res.json(configData());
});

app.post("/upload", (req, res) => {
  const incoming = req.body?.files;
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return res.status(400).json({ error: "No files provided." });
  }

  const data = indexData();
  const saved = [];
  const config = configData();

  for (const file of incoming) {
    if (!file?.name || typeof file.content !== "string") continue;

    const safeName = sanitizeFileName(file.name);
    const finalName = ensureUniqueName(data.files, safeName);
    const destination = ["main", "kias", "assets"].includes(file.destination) ? file.destination : "assets";

    const absolutePath = resolveStoragePath(finalName);
    fs.writeFileSync(absolutePath, Buffer.from(file.content, "base64"));

    const stat = fs.statSync(absolutePath);
    const meta = normalizeFile({
      name: finalName,
      originalName: file.name,
      destination,
      type: getFileType(finalName),
      mime: file.mime || "application/octet-stream",
      size: stat.size,
      uploadedAt: new Date().toISOString(),
      path: `storage/${finalName}`
    });

    data.files = data.files.filter((entry) => entry.name !== finalName);
    data.files.push(meta);
    saved.push(meta);

    if (meta.type === "html") {
      if (destination === "main") config.main = meta.name;
      if (destination === "kias") config.kias = meta.name;
    }
  }

  saveIndex(data);
  saveConfig(config);

  if (!saved.length) return res.status(400).json({ error: "No valid files were uploaded." });
  return res.json({ message: "Upload successful.", files: saved, config });
});

app.get("/file/:name", (req, res) => {
  const name = sanitizeFileName(req.params.name);
  const { file } = resolveMetaByName(name);
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
  const name = sanitizeFileName(req.params.name);
  const { data, file } = resolveMetaByName(name);
  if (!file) return res.status(404).json({ error: "File not found." });

  const content = req.body?.content;
  const encoding = req.body?.encoding === "base64" ? "base64" : "utf8";
  if (typeof content !== "string") return res.status(400).json({ error: "Invalid content." });

  const absolutePath = resolveStoragePath(file.name);
  if (!fs.existsSync(absolutePath)) return res.status(404).json({ error: "Stored file is missing." });

  fs.writeFileSync(absolutePath, Buffer.from(content, encoding));
  const stat = fs.statSync(absolutePath);
  file.size = stat.size;
  file.updatedAt = new Date().toISOString();

  if (typeof req.body?.destination === "string" && ["main", "kias", "assets"].includes(req.body.destination)) {
    file.destination = req.body.destination;
  }

  saveIndex(data);
  return res.json({ message: "File saved.", file });
});

app.patch("/file/:name/meta", (req, res) => {
  const name = sanitizeFileName(req.params.name);
  const { data, file } = resolveMetaByName(name);
  if (!file) return res.status(404).json({ error: "File not found." });

  if (typeof req.body?.destination === "string" && ["main", "kias", "assets"].includes(req.body.destination)) {
    file.destination = req.body.destination;
  }
  file.updatedAt = new Date().toISOString();

  saveIndex(data);
  return res.json({ message: "Metadata updated.", file });
});

app.delete("/file/:name", (req, res) => {
  const name = sanitizeFileName(req.params.name);
  const { data, file } = resolveMetaByName(name);
  if (!file) return res.status(404).json({ error: "File not found." });

  const absolutePath = resolveStoragePath(file.name);
  if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);

  data.files = data.files.filter((entry) => entry.name !== name);
  saveIndex(data);

  const config = configData();
  let changed = false;
  if (config.main === name) {
    config.main = "index.html";
    changed = true;
  }
  if (config.kias === name) {
    config.kias = "kias.html";
    changed = true;
  }
  if (changed) saveConfig(config);

  return res.json({ message: "File deleted.", name });
});

app.get("/target", (_req, res) => {
  const config = configData();
  return res.json({ activeTarget: config.main, config });
});

app.post("/target", (req, res) => {
  const name = sanitizeFileName(req.body?.name || "");
  const result = setTargetConfig("main", name);
  if (result.error) return res.status(result.status).json({ error: result.error });
  return res.json({ message: "Main target updated.", activeTarget: result.config.main, config: result.config });
});

app.post("/set-target", (req, res) => {
  const type = req.body?.type;
  const file = sanitizeFileName(req.body?.file || "");
  const result = setTargetConfig(type, file);
  if (result.error) return res.status(result.status).json({ error: result.error });
  return res.json({ message: `${type.toUpperCase()} target updated.`, config: result.config });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, storage: STORAGE_DIR });
});

app.use("/storage", express.static(STORAGE_DIR));
app.get("/admin", (_req, res) => res.sendFile(path.join(ROOT, "admin.html")));

app.listen(PORT, () => {
  console.log(`K.I.A.S admin system running on port ${PORT}`);
});
