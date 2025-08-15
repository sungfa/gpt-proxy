// /api/vision-firefly.ts
// (Vercel Serverless Function)
// Requirements:
// - Env: OPENROUTER_API_KEY
// - Optional Env: OPENROUTER_MODEL (default: "openai/gpt-4o-mini")
// - Optional Env: APP_URL, APP_NAME (OpenRouter meta headers)

function setCors(res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function parseBody(req: any) {
  if (typeof req.json === "function") return await req.json(); // Edge runtime
  if (typeof req.body === "string") return JSON.parse(req.body);
  return req.body || {};
}

function buildFinalPrompt(a: any) {
  // 안전하게 빈 값 제거 후 연결
  const parts = [
    a?.subject && `${a.subject}`,
    a?.place && `in ${a.place}`,
    a?.time_weather && `${a.time_weather}`,
    a?.style && `${a.style}`,
    a?.color && `${a.color}`,
    a?.composition && `${a.composition}`,
    a?.camera && `${a.camera}`,
    a?.lighting && `${a.lighting}`,
    a?.details && `${a.details}`,
  ].filter(Boolean);

  // Firefly가 잘 먹는 마무리 품질 태그 (과하면 역효과라 기본만)
  const quality = "ultra detailed, cinematic lighting, 8k resolution";

  return [parts.join(", "), quality].filter(Boolean).join(", ");
}

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      provider: "openrouter",
      route: "/api/vision-firefly",
      expects: {
        image_url: "string (optional)",
        image_base64: "string (optional, raw base64 WITHOUT prefix)",
        memo: "string (optional, ko/en free-form hints)",
        temperature: "number (optional)",
        model: "string (optional)",
      },
    });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const API_KEY = process.env.OPENROUTER_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "Missing OPENROUTER_API_KEY" });

  let body: any;
  try {
    body = await parseBody(req);
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const {
    image_url,
    image_base64,
    memo = "",
    temperature = 0.6,
    model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
  } = body || {};

  if (!image_url && !image_base64) {
    return res.status(400).json({
      error: "Provide either 'image_url' or 'image_base64' (raw base64 without data URL prefix).",
    });
  }

  // OpenRouter 권장 메타(선택)
  const referer = process.env.APP_URL || "https://example.com";
  const title = process.env.APP_NAME || "Firefly Prompt Agent";

  // 이미지 컨텐츠 구성 (OpenAI/OR 호환)
  const imageBlock = image_url
    ? { type: "image_url", image_url: { url: image_url } }
    : { type: "image_url", image_url: { url: `data:image/*;base64,${image_base64}` } };

  // 시스템 프롬프트: JSON만 반환하도록 강하게 가이드
  const system = `
You are an expert visual analyst and a prompt engineer for Adobe Firefly image generation.
Analyze the given image and produce a concise JSON (no extra text) describing the scene.
- Accept user's memo (which may be in Korean) and reflect it appropriately.
- Translate concepts to natural English where needed.
Return ONLY valid JSON with these fields:

{
  "subject": "short subject phrase",
  "place": "location/background in a short phrase",
  "time_weather": "time/weather (e.g., 'at midnight on a rainy night')",
  "style": "art/style keywords (e.g., 'cinematic, cyberpunk, digital illustration')",
  "color": "dominant colors or palette keywords",
  "composition": "framing/composition (e.g., 'close-up portrait, rule-of-thirds')",
  "camera": "camera details if applicable (e.g., '50mm lens, shallow depth of field')",
  "lighting": "lighting mood (e.g., 'moody, neon-lit city lights')",
  "details": "extra scene details",
  "negatives": "things to avoid (optional)"
}
Return strictly JSON with no markdown fences.
`.trim();

  // 사용자 입력(텍스트 + 이미지)
  const content = [
    {
      type: "text",
      text:
        `Analyze this image and produce JSON for Firefly.\n` +
        (memo ? `User memo/hints: ${memo}\n` : "") +
        `Respond in English JSON only.`,
    },
    imageBlock,
  ];

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
        model,
        temperature,
        messages: [
          { role: "system", content: system },
          { role: "user", content },
        ],
      }),
    });

    const j = await r.json().catch(() => ({} as any));

    // 모델/프로바이더 추출
    const modelUsed =
      j?.model || j?.choices?.[0]?.model || model || "unknown";
    const provider = "openrouter";

    // JSON 파싱 시도
    let analysis: any = null;
    let textCandidate =
      j?.choices?.[0]?.message?.content ?? j?.output_text ?? "";

    if (textCandidate) {
      try {
        analysis = JSON.parse(textCandidate);
      } catch {
        // 모델이 JSON 외 텍스트를 섞어버렸을 때 대비: 중괄호만 추출 시도
        const m = textCandidate.match(/\{[\s\S]*\}/);
        if (m) {
          try {
            analysis = JSON.parse(m[0]);
          } catch {
            // 실패하면 null 유지
          }
        }
      }
    }

    // 분석 실패 시 간단한 백업 분석 (아주 러프)
    if (!analysis || typeof analysis !== "object") {
      analysis = {
        subject: "a person",
        place: "",
        time_weather: "",
        style: "cinematic",
        color: "",
        composition: "",
        camera: "",
        lighting: "",
        details: "",
        negatives: "",
      };
    }

    const finalPrompt = buildFinalPrompt(analysis);

    return res.status(r.status || 200).json({
      ok: r.ok,
      status: r.status || 200,
      provider,
      model: modelUsed,
      final_prompt: finalPrompt,
      analysis,
      raw: j,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "OpenRouter request failed" });
  }
}
