// api/gpt.ts  — robust CORS + body parse (Node/Edge 호환)
export default async function handler(req: any, res: any) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  // 헬스체크 (GET)
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, route: "/api/gpt" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // --- Body parse (req.json() / req.body 모두 지원) ---
  let body: any = {};
  try {
    if (typeof req.json === "function") {
      body = await req.json();                 // Edge/whatwg
    } else if (typeof req.body === "string") {
      body = JSON.parse(req.body);             // raw string
    } else {
      body = req.body || {};                   // Node/Next API
    }
  } catch (e) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const { prompt, model = "gpt-4o-mini", mode = "preset" } = body;
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
  }
  if (!prompt) {
    return res.status(400).json({ error: "No prompt provided" });
  }

  const system =
    mode === "preset"
      ? "You are a Firefly prompt generator. Return a single English prompt optimized for Adobe Firefly image generation with this structure: [subject] in [place], [time/weather], [style], [color], [composition], [detail]. Use cinematic lighting and clear scene descriptions. No extra commentary."
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
          { role: "system", content: [{ type: "text", text: system }] },
          { role: "user",  content: [{ type: "text", text: String(prompt) }] },
        ],
      }),
    });

    const j = await r.json();
    const text = j?.output_text ?? j?.choices?.[0]?.message?.content ?? "";
    return res.status(200).json({ text, ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "OpenAI request failed" });
  }
}
