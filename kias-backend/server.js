import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

const API_KEY = process.env.OPENAI_API_KEY;

// Health check
app.get("/api/health", (req, res) => {
  res.send("KIAS BACKEND ONLINE");
app.get("/", (req, res) => {
    res.send("KIAS BACKEND ONLINE");
});

// AI route
app.post("/ai", async (req, res) => {
  try {
    const userMsg = (req.body?.message || "").trim();

    if (!API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY is missing on the server." });
    }

    if (!userMsg) {
      return res.status(400).json({ error: "Message is required." });
    }

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
            content: "You are K.I.A.S, a cold, corporate archival AI. You log users, observe them, and speak in an eerie, controlled tone."
          },
          {
            role: "user",
            content: userMsg
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "OpenAI request failed.",
        raw: data
      });
    }

    return res.json({
      reply: data?.choices?.[0]?.message?.content || "[NO RESPONSE]",
      raw: data
    });
  } catch (err) {
    return res.status(500).json({ error: "AI FAILURE", details: String(err) });
  }
    try {
        const userMsg = req.body.message;

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: "You are K.I.A.S, a cold, corporate archival AI. You log users, observe them, and speak in an eerie, controlled tone."
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

app.listen(3000, () => console.log("KIAS backend running on http://localhost:3000"));
