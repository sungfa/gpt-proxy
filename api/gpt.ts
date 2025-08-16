// /api/vision-firefly.ts  (원하시면 /api/gpt.ts로 이름만 바꾸세요)
// OpenRouter Vision + Firefly Prompt Agent (+ Korean translation)
// Env: OPENROUTER_API_KEY (required)
// Optional Env: OPENROUTER_MODEL (default "openai/gpt-4o-mini"), APP_URL, APP_NAME

function setCors(res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function parseBody(req: any) {
  if (typeof req.json === "function") return await req.json(); // Edge 호환
  if (typeof req.body === "string") return JSON.parse(req.body);
  return req.body || {};
}

// 빈값/“n/a” 제거해서 Firefly용 최종 한 줄 프롬프트 구성
function buildFinalPrompt(a: any) {
  const clean = (v?: string) => {
    if (!v) return "";
    const s = String(v).trim();
    if (!s) return "";
    const lower = s.toLowerCase();
    if (lower === "n/a" || lower === "na" || lower === "none") return "";
    return s;
  };

  const parts = [
    clean(a?.subject),
    clean(a?.place) && `in ${clean(a?.place)}`,
    clean(a?.time_weather),
    clean(a?.style),
    clean(a?.color),
    clean(a?.composition),
    clean(a?.camera),
    clean(a?.lighting),
    clean(a?.details),
  ].filter(Boolean);

  // 품질 태그는 최소만 유지(필요 없으면 제거 가능)
  const quality = "ultra detailed, cinematic lighting, 8k resolution";

  // 빈값 나오면 품질 태그만이라도 들어가게
  return [parts.join(", "), quality].filter(Boolean).join(", ").replace(/\s+,/g, ",").trim();
}

// 한국어 번역(영문 → 한글) 호출
async function translateToKorean(text: string, apiKey: string, model: string, meta: { referer: string; title: string; }) {
  if (!text?.trim()) return "";
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": meta.referer,
      "X-Title": meta.title,
    },
    body: JSON.stringify({
      // 같은 모델로 번역해도 되지만, 번역만은 가벼운 모델을 쓰고 싶으면 여기를 바꾸세요.
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "You are a professional translator. Translate the user's text into Korean. Output ONLY the translated Korean text.",
        },
        { role: "user", content: text }
      ],
    }),
  });

  const j = await r.json().catch(() => ({} as any));
  const ko = j?.choices?.[0]?.message?.content?.trim?.() ?? j?.output_text ?? "";
  return ko || "";
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
        model: "string (optional, default: openai/gpt-4o-mini)",
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
    // 이미지 + 분석 + Firefly 프롬프트 생성
    image_url,
    image_base64,          // 순수 base64 (data: prefix 없이)
    memo = "",
    temperature = 0.6,
    model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
  } = body || {};

  if (!image_url && !image_base64) {
    return res.status(400).json({
      error: "Provide either 'image_url' or 'image_base64' (raw base64 without data URL prefix).",
    });
  }

  // 이미지 content block 만들기
  const imageBlock = image_url
    ? { type: "image_url", image_url: { url: image_url } }
    : { type: "image_url", image_url: { url: `data:image/png;base64,${image_base64}` } };

  // Firefly 분석 시스템 프롬프트(결과는 JSON만 반환하도록 가이드)
  const system = `
You are an expert visual analyst and a prompt engineer for Adobe Firefly image generation.
Analyze the given image and produce a concise JSON (no extra text) describing the scene.
- Accept user's memo (maybe in Korean) and reflect it appropriately.
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

  const referer = process.env.APP_URL || "https://example.com";
  const title = process.env.APP_NAME || "Firefly Prompt Agent";

  // User content(텍스트 + 이미지)
  const userContent = [
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
    // 1) 이미지 분석 → JSON 출력 받기
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
          { role: "user", content: userContent },
        ],
      }),
    });

    const j = await r.json().catch(() => ({} as any));

    // 모델/상태/문구 추출
    const modelUsed = j?.model || j?.choices?.[0]?.model || model || "unknown";
    let textCandidate = j?.choices?.[0]?.message?.content ?? j?.output_text ?? "";

    // 2) JSON 파싱
    let analysis: any = null;
    if (textCandidate) {
      try {
        analysis = JSON.parse(textCandidate);
      } catch {
        // 모델이 텍스트와 섞어서 줄 수도 있으니 중괄호만 추출
        const m = textCandidate.match(/\{[\s\S]*\}/);
        if (m) {
          try {
            analysis = JSON.parse(m[0]);
          } catch {
            // 무시
          }
        }
      }
    }

    // 3) 실패 시 최소 안전값
    if (!analysis || typeof analysis !== "object") {
      analysis = {
        subject: "a subject",
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

    // 4) 최종 영어 프롬프트 구성(공란/n-a 삭제)
    const finalPrompt = buildFinalPrompt(analysis);

    // 5) 한국어 번역 추가
    const finalPromptKo = await translateToKorean(finalPrompt, API_KEY, model, { referer, title });

    return res.status(r.status || 200).json({
      ok: r.ok,
      status: r.status || 200,
      provider: "openrouter",
      model: modelUsed,
      final_prompt: finalPrompt,       // 영어
      final_prompt_ko: finalPromptKo,  // 한국어 번역
      analysis,
      raw: j,                          // (디버깅용: 필요 없으면 제거하세요)
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "OpenRouter request failed" });
  }
}
