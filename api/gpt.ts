// /api/gpt.ts — Firefly 프롬프트 에이전트 + 이미지 분석(비전)
// Vercel Serverless/Edge OK

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

// Firefly 프롬프트 템플릿 생성
function composeFireflyPrompt(a: any, note: string) {
  // 안전하게 문자열화
  const S = (v: any) => (v ?? "").toString().trim();
  const parts = [
    S(a.subject) && `${S(a.subject)}`,
    S(a.place) && `in ${S(a.place)}`,
    S(a.time_weather) && `${S(a.time_weather)}`,
    S(a.style) && `${S(a.style)}`,
    S(a.color) && `${S(a.color)}`,
    S(a.composition) && `${S(a.composition)}`,
    S(a.detail) && `${S(a.detail)}`,
    S(a.camera) && `${S(a.camera)}`,
    S(a.mood) && `${S(a.mood)}`
  ].filter(Boolean);

  // Firefly가 잘 먹는 톤
  const base = parts.join(", ");
  const extra = S(note) ? `, ${S(note)}` : "";
  return `${base}${extra}, ultra detailed, cinematic lighting, 8k resolution`;
}

// 비전 1단계: 이미지를 JSON 속성으로 분석
function visionSystem() {
  return `You are a vision analyst that returns STRICT JSON only.

Extract attributes that help generate high-quality text prompts for Adobe Firefly image generation.

Return a compact JSON with keys:
{
  "subject": "...",            // main subject
  "place": "...",              // e.g., 'a neon-lit city street'
  "time_weather": "...",       // e.g., 'at night, light rain'
  "style": "...",              // e.g., 'digital illustration', 'cyberpunk', 'photorealistic'
  "color": "...",              // e.g., 'glowing blues and pinks'
  "composition": "...",        // e.g., 'close-up, rule of thirds, shallow depth of field'
  "detail": "...",             // e.g., 'reflections on puddles, bokeh city lights'
  "camera": "...",             // e.g., '50mm lens, low-angle shot'
  "mood": "..."                // e.g., 'moody, dramatic'
}

DO NOT include any extra commentary. JSON only.`;
}

// LLM 호출 (OpenRouter 기본, OpenAI 옵션)
async function callLLM(options: {
  provider: "openrouter" | "openai",
  model: string,
  messages: any[],
  temperature?: number
}) {
  const { provider, model, messages, temperature = 0.7 } = options;

  if (provider === "openrouter") {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("Missing OPENROUTER_API_KEY");
    const referer = process.env.APP_URL || "https://example.com";
    const title = process.env.APP_NAME || "Firefly Agent";

    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
        "HTTP-Referer": referer,
        "X-Title": title,
      },
      body: JSON.stringify({ model, temperature, messages }),
    });
    const j = await r.json().catch(() => ({}));
    const text = j?.choices?.[0]?.message?.content || j?.output_text || "";
    return { status: r.status, ok: r.ok, text, raw: j, model: j?.model || model, provider };
  }

  // openai
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_API_KEY");
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({ model, temperature, messages }),
  });
  const j = await r.json().catch(() => ({}));
  const text = j?.choices?.[0]?.message?.content || "";
  return { status: r.status, ok: r.ok, text, raw: j, model: j?.model || model, provider };
}

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, route: "/api/gpt", agent: "firefly-prompt" });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let body: any;
  try { body = await parseBody(req); } catch { return res.status(400).json({ error: "Invalid JSON body" }); }

  const {
    note = "",                // 사용자가 추가로 적는 메모/요구사항(ko/en 모두 OK)
    image,                    // dataURL 또는 http(s) URL
    provider = "openrouter",  // "openrouter" | "openai"
    model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini", // 비전 지원 모델
    temperature = 0.4
  } = body || {};

  // 1) 이미지 분석 → JSON 속성
  let analysis: any = {};
  if (image) {
    // 메시지 구성: 비전 + (옵션) 텍스트 힌트
    const content: any[] = [
      { type: "text", text: "Analyze the image." },
      { type: "image_url", image_url: (typeof image === "string" ? image : "") }
    ];
    if (note) content.unshift({ type: "text", text: `User note (ko/en): ${note}` });

    const { status, ok, text, raw, model: usedModel, provider: usedProvider } = await callLLM({
      provider,
      model,
      temperature,
      messages: [
        { role: "system", content: visionSystem() },
        { role: "user", content }
      ]
    });

    if (!ok) return res.status(status).json({ ok, status, error: raw?.error?.message || "Vision request failed" });

    try { analysis = JSON.parse(text); } catch {
      // 혹시 모델이 JSON 외 텍스트를 섞으면 간단히 정리
      const jsonMatch = text.match(/\{[\s\S]*\}$/);
      analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    }
  }

  // 2) 템플릿으로 Firefly 프롬프트 생성
  const prompt = composeFireflyPrompt(analysis, note);

  return res.status(200).json({
    ok: true,
    provider,
    model,
    analysis,   // 추출된 속성 JSON (미리보기/디버그용)
    prompt      // Firefly에 넣을 최종 영어 프롬프트
  });
}
