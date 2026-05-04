import express from "express";
import fs from "fs";
import path from "path";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ROOT = process.cwd();
const STORAGE_DIR = path.join(ROOT, "storage");
const INDEX_PATH = path.join(STORAGE_DIR, "index.json");
const PAGES_PATH = path.join(STORAGE_DIR, "pages.json");
const MEMORY_PATH = path.join(ROOT, "db.json");

const TARGETS = [
  "home", "about", "divisions", "innovation", "careers", "investors", "newsroom", "contact",
  "company_info", "lab_reports", "testing", "containment", "watchlist", "journal", "kias", "nothing_is_lost_forever"
];

const ROUTE_TARGET_MAP = {
  "/": "home",
  "/about": "about",
  "/divisions": "divisions",
  "/innovation": "innovation",
  "/careers": "careers",
  "/investors": "investors",
  "/newsroom": "newsroom",
  "/contact": "contact",
  "/company-info": "company_info",
  "/lab-reports": "lab_reports",
  "/testing": "testing",
  "/containment": "containment",
  "/watchlist": "watchlist",
  "/journal": "journal",
  "/kias": "kias",
  "/nothing-is-lost-forever": "nothing_is_lost_forever"
};

app.use(express.json({ limit: "50mb" }));

function ensureStorage() {
  if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
  if (!fs.existsSync(INDEX_PATH)) fs.writeFileSync(INDEX_PATH, JSON.stringify({ files: [] }, null, 2));
  if (!fs.existsSync(PAGES_PATH)) fs.writeFileSync(PAGES_PATH, JSON.stringify({ home: "" }, null, 2));
  if (!fs.existsSync(MEMORY_PATH)) {
    fs.writeFileSync(MEMORY_PATH, JSON.stringify({ users: {}, ai: { responses: [], interactions: [] }, logs: [] }, null, 2));
  }
}

const readJson = (filePath, fallback) => {
  try { return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : fallback; } catch { return fallback; }
};
const writeJson = (filePath, data) => fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
const sanitizeFileName = (name = "") => String(name).replace(/[^a-zA-Z0-9._-]/g, "_") || `file_${Date.now()}`;

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
    target: TARGETS.includes(file.target) ? file.target : null,
    type: file.type || getFileType(file.name || ""),
    mime: file.mime || "application/octet-stream",
    size: Number(file.size || 0),
    uploadedAt: file.uploadedAt || new Date().toISOString(),
    path: file.path || `storage/${sanitizeFileName(file.name || "file")}`,
    description: typeof file.description === "string" ? file.description : "",
    tags: Array.isArray(file.tags) ? file.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
    encoding: file.encoding || "base64",
    updatedAt: file.updatedAt || null
  };
}

const indexData = () => ({ files: (readJson(INDEX_PATH, { files: [] }).files || []).map(normalizeFile) });
const saveIndex = (data) => writeJson(INDEX_PATH, { files: (data.files || []).map(normalizeFile) });
const pagesData = () => readJson(PAGES_PATH, {});
const savePages = (pages) => writeJson(PAGES_PATH, pages);

function validateTarget(target) { return TARGETS.includes(target); }

function resolveStoragePath(name) { return path.join(STORAGE_DIR, sanitizeFileName(name)); }

function ensureUniqueName(files, safeName) {
  if (!files.some((file) => file.name === safeName)) return safeName;
  return `${Date.now()}_${safeName}`;
}

ensureStorage();

Object.entries(ROUTE_TARGET_MAP).forEach(([route, target]) => {
  app.get(route, (_req, res, next) => {
    if (route === "/" && _req.path !== "/") return next();
    const pages = pagesData();
    const content = pages[target];
    if (typeof content === "string" && content.trim()) return res.type("html").send(content);

    const fallbackFile = target === "home" ? "index.html" : target === "kias" ? "kias.html" : target === "nothing_is_lost_forever" ? "nothing-is-lost-forever.html" : `${target.replace("_", "-")}.html`;
    const rootFallback = path.join(ROOT, fallbackFile);
    if (fs.existsSync(rootFallback)) return res.sendFile(rootFallback);
    return res.status(404).send(`No content found for target '${target}'.`);
  });
});

app.get("/api/targets", (_req, res) => res.json({ targets: TARGETS }));
app.get("/api/pages", (_req, res) => res.json({ pages: pagesData(), targets: TARGETS }));
app.get("/api/pages/:target", (req, res) => {
  const target = req.params.target;
  if (!validateTarget(target)) return res.status(400).json({ error: "Invalid target." });
  const pages = pagesData();
  return res.json({ target, content: pages[target] || "" });
});

app.post("/api/pages", (req, res) => {
  const target = req.body?.target;
  const content = req.body?.content;
  if (!validateTarget(target)) return res.status(400).json({ error: "Invalid target." });
  if (typeof content !== "string" || !content.trim()) return res.status(400).json({ error: "Content cannot be empty." });
  const pages = pagesData();
  pages[target] = content;
  savePages(pages);
  return res.json({ message: "Page saved.", target });
});

app.get("/files", (_req, res) => {
  const files = indexData().files.slice().sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  res.json({ files });
});

app.post("/upload", (req, res) => {
  const incoming = req.body?.files;
  if (!Array.isArray(incoming) || !incoming.length) return res.status(400).json({ error: "No files provided." });

  const data = indexData();
  const pages = pagesData();
  const saved = [];

  for (const file of incoming) {
    if (!file?.name || typeof file.content !== "string") continue;
    const target = file.target ?? null;
    if (target !== null && !validateTarget(target)) return res.status(400).json({ error: `Invalid target '${target}'.` });

    const safeName = sanitizeFileName(file.name);
    const finalName = ensureUniqueName(data.files, safeName);
    const absolutePath = resolveStoragePath(finalName);
    const bytes = Buffer.from(file.content, "base64");
    fs.writeFileSync(absolutePath, bytes);

    const meta = normalizeFile({
      name: finalName, originalName: file.name, target,
      type: getFileType(finalName), mime: file.mime || "application/octet-stream",
      size: bytes.length, uploadedAt: new Date().toISOString(), path: `storage/${finalName}`,
      description: file.description || "",
      tags: Array.isArray(file.tags) ? file.tags : [],
      encoding: file.encoding || "base64"
    });

    data.files = data.files.filter((entry) => entry.name !== finalName);
    data.files.push(meta);
    saved.push(meta);

    if (target && (meta.type === "html" || meta.type === "text")) {
      pages[target] = Buffer.from(file.content, "base64").toString("utf8");
    }
  }

  saveIndex(data);
  savePages(pages);
  if (!saved.length) return res.status(400).json({ error: "No valid files were uploaded." });
  return res.json({ message: "Upload successful.", files: saved });
});

app.put("/file/:name", (req, res) => {
  const name = sanitizeFileName(req.params.name);
  const data = indexData();
  const file = data.files.find((entry) => entry.name === name);
  if (!file) return res.status(404).json({ error: "File not found." });

  const description = typeof req.body?.description === "string" ? req.body.description : file.description || "";
  const tags = Array.isArray(req.body?.tags) ? req.body.tags.map((tag) => String(tag).trim()).filter(Boolean) : (file.tags || []);
  file.description = description;
  file.tags = tags;

  if (typeof req.body?.target === "string") {
    if (!validateTarget(req.body.target)) return res.status(400).json({ error: "Invalid target." });
    file.target = req.body.target;
  }

  if (typeof req.body?.content === "string" && req.body.content.trim()) {
    const absolutePath = resolveStoragePath(file.name);
    const bytes = Buffer.from(req.body.content, "base64");
    fs.writeFileSync(absolutePath, bytes);
    file.size = bytes.length;
    file.mime = req.body?.mime || file.mime;
    file.encoding = req.body?.encoding || "base64";
  }

  file.updatedAt = new Date().toISOString();
  saveIndex(data);
  return res.json({ message: "File updated.", file: normalizeFile(file) });
});

app.delete("/file/:name", (req, res) => {
  const name = sanitizeFileName(req.params.name);
  const data = indexData();
  const file = data.files.find((entry) => entry.name === name);
  if (!file) return res.status(404).json({ error: "File not found." });
  const absolutePath = resolveStoragePath(file.name);
  if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
  data.files = data.files.filter((entry) => entry.name !== name);
  saveIndex(data);
  return res.json({ message: "File deleted." });
});

app.get("/health", (_req, res) => res.json({ ok: true, storage: STORAGE_DIR }));
app.use("/storage", express.static(STORAGE_DIR));
app.get("/admin", (_req, res) => res.sendFile(path.join(ROOT, "admin.html")));

app.listen(PORT, () => console.log(`K.I.A.S admin system running on port ${PORT}`));
