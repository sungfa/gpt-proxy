// /api/gpt.ts — OpenRouter Vision + Firefly Prompt Agent

function setCors(res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function parseBody(req: any) {
  if (typeof req.json === "function") return await req.json();
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
      note: "POST { mode, model, prompt, image_url|image_base64 }",
    });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const API_KEY = process.env.OPENROUTER_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "Missing OPENROUTER_API_KEY" });

  let body: any = {};
  try { body = await parseBody(req); } catch { return res.status(400).json({ error: "Invalid JSON body" }); }

  const {
    // 모드: raw(그대로), firefly(텍스트→Firefly), vision_firefly(이미지 분석→Firefly)
    mode = "vision_firefly",
    // Vision 가능한 모델 권장: openai/gpt-4o (또는 openai/gpt-4o-mini)
    model = process.env.OPENROUTER_MODEL || "openai/gpt-4o",
    prompt,                   // 선택: 이미지 + 추가 요구사항
    image_url,                // data:uri or https url
    image_base64,             // 순수 base64 (prefix 없이) 도 허용
    temperature = 0.4,
    top_p = 1,
    seed,                     // 재현성 원하면 숫자
    max_output_tokens = 400,  // 길이 확보
  } = body || {};

  if (mode === "vision_firefly" && !image_url && !image_base64) {
    return res.status(400).json({ error: "image_url or image_base64 is required for vision_firefly" });
  }

  // 메시지 구성
  const messages: any[] = [];

  // 시스템 프롬프트 (Firefly 최적화)
  const SYS_FIREFLY =
    "You analyze images and craft a single, high-quality English prompt optimized for Adobe Firefly image generation." +
    " The prompt MUST be one concise line, no JSON, no extra commentary." +
    " Focus on: [main subject], [place/background], [time/weather], [style], [color palette], [lighting], [composition], [detail level/resolution]." +
    " Prefer cinematic, reproducible descriptions. No camera brands. No subjective opinions.";

  // 이미지 컨텐츠 구성
  function imageContent() {
    if (image_url) {
      return { type: "image_url", image_url: { url: image_url } };
    }
    if (image_base64) {
      return { type: "image_url", image_url: { url: `data:image/png;base64,${image_base64}` } };
    }
    return null;
  }

  if (mode === "vision_firefly") {
    messages.push({ role: "system", content: SYS_FIREFLY });
    const content: any[] = [];
    const img = imageContent();
    if (img) content.push(img);
    if (prompt) content.push({ type: "text", text: String(prompt) });
    else content.push({ type: "text", text: "Analyze the image and craft the Firefly-ready prompt." });
    messages.push({ role: "user", content });
  } else if (mode === "firefly") {
    messages.push({ role: "system", content: SYS_FIREFLY });
    const content: any[] = [];
    if (prompt) content.push({ type: "text", text: String(prompt) });
    messages.push({ role: "user", content });
  } else {
    // raw: 시스템 프롬프트 없이 그대로 전달
    const content: any[] = [];
    if (prompt) content.push({ type: "text", text: String(prompt) });
    const img = imageContent();
    if (img) content.push(img);
    if (!content.length) return res.status(400).json({ error: "No content provided" });
    messages.push({ role: "user", content });
  }

  const referer = process.env.APP_URL  || "https://example.com";
  const title   = process.env.APP_NAME || "Firefly Prompt Agent";

  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${API_KEY}`,
        "HTTP-Referer":  referer,
        "X-Title":       title,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        top_p,
        ...(seed ? { seed } : {}),
        ...(max_output_tokens ? { max_output_tokens } : {}),
      }),
    });

    const j = await r.json().catch(() => ({} as any));
    const text = j?.choices?.[0]?.message?.content ?? j?.output_text ?? "";

    return res.status(r.status).json({
      ok: r.ok,
      status: r.status,
      provider: "openrouter",
      model: j?.model || model,
      text,
      error: j?.error?.message,
      // raw: j, // (디버깅용 필요 시 주석 해제)
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "OpenRouter request failed" });
  }
}
