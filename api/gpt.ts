export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res.status(200).json({ ok: true, route: "/api/gpt" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 🔹 여기 수정: req.body 대신 await req.json()
  const { prompt, model = "gpt-4o-mini", mode = "preset" } = await req.json();

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
  }

  if (!prompt) {
    return res.status(400).json({ error: "No prompt provided" });
  }

  const system = mode === "preset"
    ? "You are a Firefly prompt generator..."
    : "You are a helpful assistant.";

  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
    });

    const j = await r.json();
    const text = j?.output_text || j?.choices?.[0]?.message?.content || "";
    return res.status(200).json({ text });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || "OpenAI request failed" });
  }
}
