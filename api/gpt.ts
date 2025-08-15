// /api/gpt.ts — OpenRouter 전용 프록시 (CORS/바디파싱/에러표시 포함)

function setCors(res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function parseBody(req: any) {
  if (typeof req.json === "function") return await req.json(); // Edge
  if (typeof req.body === "string") return JSON.parse(req.body);
  return req.body || {};
}

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      provider: "openrouter",
      route: "/api/gpt",
    });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // 환경변수 체크
  const API_KEY = process.env.OPENROUTER_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "Missing OPENROUTER_API_KEY" });

  let body: any;
  try {
    body = await parseBody(req);
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const {
    prompt,
    // OpenRouter에서 지원하는 모델명 사용. 기본값은 env → 없으면 무료/저가 후보
    model = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct:free",
    mode = "preset",
    temperature = 0.7,
  } = body || {};

  if (!prompt) return res.status(400).json({ error: "No prompt provided" });

  // Firefly 프리셋 / 일반 대화
  const system =
    mode === "preset"
      ? "You are a Firefly prompt generator. Return a single English prompt optimized for Adobe Firefly image generation with this structure: [subject] in [place], [time/weather], [style], [color], [composition], [detail]. Use cinematic lighting and clear scene descriptions. No extra commentary."
      : "You are a helpful assistant.";

  // OpenRouter 권장 메타(선택)
  const referer = process.env.APP_URL || "https://example.com";
  const title = process.env.APP_NAME || "Framer GPT Console";

  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
        "HTTP-Referer": referer,
        "X-Title": title,
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          { role: "system", content: system },
          { role: "user", content: String(prompt) },
        ],
      }),
    });

    const j = await r.json().catch(() => ({} as any));
    const text =
      j?.choices?.[0]?.message?.content ??
      j?.output_text ?? "";

return res.status(r.status).json({
  ok: r.ok,
  status: r.status,
  provider: "openrouter",
  model, // ✅ 여기에 현재 사용된 모델 이름 포함
  text,
  error: j?.error?.message,
});
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "OpenRouter request failed" });
  }
}
