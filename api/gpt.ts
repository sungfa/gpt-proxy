// /api/gpt.ts  — Vercel 서버리스용(의존성 없음, CORS/바디파싱/에러 포함)

// CORS 공통 처리
function setCors(res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET")   return res.status(200).json({ ok: true, route: "/api/gpt" });
  if (req.method !== "POST")  return res.status(405).json({ error: "Method not allowed" });

  // 바디 안전 파싱 (Edge/Node 모두 대응)
  let body: any = {};
  try {
    if (typeof req.json === "function") body = await req.json();
    else if (typeof req.body === "string") body = JSON.parse(req.body);
    else body = req.body || {};
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const {
    prompt,
    model = "gpt-4o-mini",
    mode  = "preset"            // "preset"이면 Firefly 프롬프트 생성 톤, "raw"면 일반 대화
  } = body;

  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
  if (!prompt)                      return res.status(400).json({ error: "No prompt provided" });

  const system =
    mode === "preset"
      ? "You are a Firefly prompt generator. Return a single English prompt optimized for Adobe Firefly image generation with this structure: [subject] in [place], [time/weather], [style], [color], [composition], [detail]. Use cinematic lighting and clear scene descriptions. No extra commentary."
      : "You are a helpful assistant.";

  try {
    // ✅ Chat Completions로 안정 호출 (Responses API 대신)
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user",   content: String(prompt) },
        ],
        temperature: 0.7,
      }),
    });

    const j = await r.json();

    // ✅ 텍스트 추출
    const text =
      j?.choices?.[0]?.message?.content ??
      j?.output_text ?? // (혹시 Responses 형식으로 올 경우 대비)
      "";

    // 디버깅이 필요하면 raw도 함께 보내면 됨
    return res.status(r.status).json({ ok: r.ok, status: r.status, text, /* raw: j */ });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "OpenAI request failed" });
  }
}
