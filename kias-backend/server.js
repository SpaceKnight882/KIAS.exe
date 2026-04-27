import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

const API_KEY = process.env.OPENAI_API_KEY;

const normalizeMessage = (body = {}) => {
  if (typeof body.message === "string") return body.message.trim();
  if (typeof body.prompt === "string") return body.prompt.trim();

  if (Array.isArray(body.messages)) {
    const latestUserMessage = [...body.messages].reverse().find((entry) => entry?.role === "user" && typeof entry?.content === "string");
    return latestUserMessage?.content?.trim() || "";
  }

  return "";
};

const extractAssistantText = (data = {}) => {
  const maybeText = data?.choices?.[0]?.message?.content;
  return typeof maybeText === "string" ? maybeText : "";
};

// health check
app.get("/", (req, res) => {
  res.send("KIAS BACKEND ONLINE");
});

// AI route
app.post("/ai", async (req, res) => {
  const userMsg = normalizeMessage(req.body);

  if (!API_KEY) {
    return res.status(500).json({
      error: "OPENAI_API_KEY is not configured on the server."
    });
  }

  if (!userMsg) {
    return res.status(400).json({
      error: "Request must include a non-empty 'message' string (or 'prompt'/'messages')."
    });
  }

  try {
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

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "OpenAI request failed.",
        details: data?.error || null
      });
    }

    return res.json({
      reply: extractAssistantText(data),
      model: data.model,
      id: data.id,
      usage: data.usage,
      raw: data
    });
  } catch {
    return res.status(500).json({ error: "AI FAILURE" });
  }
});

app.listen(3000, () => console.log("KIAS backend running"));
