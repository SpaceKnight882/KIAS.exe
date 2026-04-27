import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json());
app.use(cors());

const API_KEY = process.env.OPENAI_API_KEY;
const PANEL_USERNAME = process.env.KIAS_PANEL_USER || "kias";
const PANEL_PASSWORD = process.env.KIAS_PANEL_PASSWORD || "<KIAS.exe>";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const parseBasicAuth = (headerValue = "") => {
  if (!headerValue.startsWith("Basic ")) return null;
  const encoded = headerValue.slice(6).trim();
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const index = decoded.indexOf(":");
    if (index < 0) return null;
    return {
      username: decoded.slice(0, index),
      password: decoded.slice(index + 1)
    };
  } catch {
    return null;
  }
};

const requirePanelAuth = (req, res, next) => {
  const protectedPaths = new Set(["/admin", "/admin.html", "/kias", "/kias.html"]);
  if (!protectedPaths.has(req.path)) return next();

  const credentials = parseBasicAuth(req.headers.authorization);
  if (credentials && credentials.username === PANEL_USERNAME && credentials.password === PANEL_PASSWORD) {
    return next();
  }

  res.set("WWW-Authenticate", 'Basic realm="KIAS Restricted Panel"');
  return res.status(401).send("Authentication required.");
};

app.use(requirePanelAuth);
app.use(express.static(__dirname, { extensions: ["html"] }));

// health check
app.get("/api/health", (req, res) => {
  res.send("KIAS BACKEND ONLINE");
});

// backend info page shortcut
app.get("/kias.exe", (req, res) => {
  res.sendFile(path.join(__dirname, "kias.exe.html"));
});

// AI route
app.post("/ai", async (req, res) => {
  try {
    const userMsg = req.body.message;

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
            content: "You are K.I.A.S, a cold corporate archival AI observing users."
          },
          {
            role: "user",
            content: userMsg
          }
        ]
      })
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "AI FAILURE" });
  }
});

app.listen(3000, () => console.log("KIAS backend running"));
