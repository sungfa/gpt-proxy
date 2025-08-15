// /api/gpt.ts — OpenRouter 전용 프록시 (모델명 노출 + CORS/바디파싱)

function setCors(res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function parseBody(req: any) {
  if (typeof req.json === "function") return await req.json(); // Edge/Fetch API
  if (typeof req.body === "string") return JSON.parse(req.body);
  return req.body || {};
}

export default async function handler(req: any, res: any) {
  setCors(res);

  // CORS preflight
  if (req.method === "OPTIONS") return res.status(200).end();

  // 헬스체크
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      provider: "openrouter",
      route: "/api/gpt",
      message: "POST { prompt, model?, mode?, temperature? }",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // 필수 환경변수
  const API_KEY = process.env.OPENROUTER_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ ok: false, error: "Missing OPENROUTER_API_KEY" });
  }

  // 바디 파싱
  let body: any;
  try {
    body = await parseBody(req);
  } catch {
    return res.status(400).json({ ok: false, error: "Invalid JSON body" });
  }

  const {
    prompt,
    model: modelFromClient, // 클라이언트가 보내면 이게 최우선
    mode = "preset",
    temperature = 0.7,
  } = body || {};

  if (!prompt) {
    return res.status(400).json({ ok: false, error: "No prompt provided" });
  }

  // 최종 사용 모델 결정(우선순위: client > env > 기본값)
  const finalModel =
    modelFromClient ||
    process.env.OPENROUTER_MODEL ||
    "meta-llama/llama-3.1-8b-instruct:free";

  // 시스템 프롬프트
  const system =
    mode === "preset"
      ? "You are a Firefly prompt generator. Return a single English prompt optimized for Adobe Firefly image generation with this structure: [subject] in [place], [time/weather], [style], [color], [composition], [detail]. Use cinematic lighting and clear scene descriptions. No extra commentary."
      : "You are a helpful assistant.";

  // OpenRouter 메타(선택)
  const referer = process.env.APP_URL || "https://example.com";
  const title = process.env.APP_NAME || "Framer GPT Console";

  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
        "HTTP-Referer": referer,
        "X-Title": title,
      },
      body: JSON.stringify({
        model: finalModel,
        temperature,
        messages: [
          { role: "system", content: system },
          { role: "user", content: String(prompt) },
        ],
      }),
    });

    const j = await r.json().catch(() => ({} as any));

    // OpenRouter는 모델별로 서로 다른 형태의 필드를 낼 수 있어 안전하게 파싱
    const text =
      j?.choices?.[0]?.message?.content ??
      j?.output_text ??
      "";

    // ✅ 응답에 "사용된 모델 이름"을 명시
    return res.status(r.status).json({
      ok: r.ok,
      status: r.status,
      provider: "openrouter",
      model_used: finalModel,     // ← 실제 사용된 모델
      model_requested: modelFromClient || null, // 클라이언트가 보낸 값(없으면 null)
      mode,
      temperature,
      text,
      error: j?.error?.message || null,
    });
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "OpenRouter request failed",
    });
  }
}
