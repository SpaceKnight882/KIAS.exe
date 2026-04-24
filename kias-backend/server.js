import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

const API_KEY = process.env.OPENAI_API_KEY;

// health check
app.get("/", (req, res) => {
    res.send("KIAS BACKEND ONLINE");
});

// AI route
app.post("/ai", async (req, res) => {
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
