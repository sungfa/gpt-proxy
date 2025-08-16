// /api/gpt.ts  (또는 /api/vision-firefly.ts)
// OpenRouter Vision + Firefly Prompt Agent + Korean Translation
// Env (필수): OPENROUTER_API_KEY
// Env (선택): OPENROUTER_MODEL (기본 "openai/gpt-4o-mini")
//             OPENROUTER_TRANSLATE_MODEL (번역 전용 모델. 없으면 폴백 순서 사용)
//             APP_URL, APP_NAME

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

// "n/a" 등 불필요 값 제거
function clean(val?: string) {
  if (!val) return "";
  const s = String(val).trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  if (lower === "n/a" || lower === "na" || lower === "none") return "";
  return s;
}

// Firefly 최종 프롬프트 구성 (영문 한 줄)
function buildFinalPrompt(a: any) {
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
  const quality = "ultra detailed, cinematic lighting, 8k resolution"; // 필요 없으면 지우세요
  return [parts.join(", "), quality].filter(Boolean).join(", ").replace(/\s+,/g, ",").trim();
}

async function callOpenRouterChat(payload: any, apiKey: string, meta: { referer: string; title: string }) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": meta.referer,
      "X-Title": meta.title,
    },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({} as any));
  return { r, j };
}

// 번역(영→한) – 실패 대비 폴백 모델 & 간단 재시도
async function translateToKorean({
  text,
  apiKey,
  modelPrimary,
  meta,
}: {
  text: string;
  apiKey: string;
  modelPrimary: string;
  meta: { referer: string; title: string };
}) {
  if (!text?.trim()) {
    return { ok: true, status: 200, translated: "", error: null, modelUsed: modelPrimary };
  }

  const candidates = [
    process.env.OPENROUTER_TRANSLATE_MODEL,                       // 1) 환경변수로 지정한 번역전용 모델
    modelPrimary,                                                 // 2) 같은 모델로 번역 시도
    "meta-llama/llama-3.1-8b-instruct:free",                      // 3) 무료/저가 후보
    "google/gemini-flash-1.5",                                    // 4) 접근 가능할 때
  ].filter(Boolean) as string[];

  let lastErr: string | null = null;

  for (const mdl of candidates) {
    // 최대 2회 재시도(429 대비)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { r, j } = await callOpenRouterChat(
          {
            model: mdl,
            temperature: 0.2,
            messages: [
              {
                role: "system",
                content:
                  "You are a professional translator. Translate the user's text into Korean. Output ONLY the translated Korean text.",
              },
              { role: "user", content: String(text) },
            ],
          },
          apiKey,
          meta
        );

        const out = j?.choices?.[0]?.message?.content?.trim?.() ?? j?.output_text ?? "";
        if (r.ok && out) {
          return { ok: true, status: r.status, translated: out, error: null, modelUsed: mdl };
        }

        lastErr = j?.error?.message || `Bad response (${r.status})`;
        // 429 등은 한 번 더 시도
        if (r.status === 429) {
          await new Promise((res) => setTimeout(res, 600));
          continue;
        }
        // 그 외엔 다음 모델
        break;
      } catch (e: any) {
        lastErr = e?.message || "translate failed";
      }
    }
  }

  // 전부 실패 → 영문 그대로 폴백
  return { ok: false, status: 500, translated: text, error: lastErr, modelUsed: candidates[0] || modelPrimary };
}

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      provider: "openrouter",
      route: "/api/gpt (vision-firefly + translate_ko)",
      expects: {
        // vision-firefly
        image_url: "string (optional)",
        image_base64: "string (optional, raw base64 WITHOUT prefix)",
        memo: "string (optional, ko/en free-form hints)",
        temperature: "number (optional)",
        model: "string (optional)",
        // translate_ko (호환)
        mode: "translate_ko (optional for separate call)",
        text: "string (the english prompt to translate)",
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
    // 공통
    model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
    temperature = 0.6,
    // vision-firefly
    image_url,
    image_base64, // (data: prefix 없이 순수 base64)
    memo = "",
    // 호환용 별도 번역 호출
    mode,
    text,
  } = body || {};

  const referer = process.env.APP_URL || "https://example.com";
  const title = process.env.APP_NAME || "Firefly Prompt Agent";

  // ---------------------------------------
  // (호환) 별도 번역 모드 호출 지원: mode === "translate_ko"
  // 프론트가 예전 방식이면 이 분기로 처리됩니다.
  // ---------------------------------------
  if (mode === "translate_ko") {
    if (!text) return res.status(400).json({ error: "No text for translate_ko" });
    const tr = await translateToKorean({ text, apiKey: API_KEY, modelPrimary: model, meta: { referer, title } });
    return res.status(tr.ok ? 200 : tr.status).json({
      ok: tr.ok,
      status: tr.ok ? 200 : tr.status,
      provider: "openrouter",
      model,
      text: tr.translated,
      translation_ok: tr.ok,
      translation_status: tr.status,
      translation_error: tr.error,
    });
  }

  // ---------------------------------------
  // vision-firefly: 이미지 분석 → JSON → final_prompt 생성 → 한글 번역까지 포함
  // ---------------------------------------
  if (!image_url && !image_base64) {
    return res.status(400).json({
      error: "Provide either 'image_url' or 'image_base64' (raw base64 without data URL prefix).",
    });
  }

  // 이미지 블록
  const imageBlock = image_url
    ? { type: "image_url", image_url: { url: image_url } }
    : { type: "image_url", image_url: { url: `data:image/png;base64,${image_base64}` } };

  // JSON만 출력하게 강하게 가이드
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
    // 1) 분석 호출
    const { r, j } = await callOpenRouterChat(
      { model, temperature, messages: [{ role: "system", content: system }, { role: "user", content: userContent }] },
      API_KEY,
      { referer, title }
    );

    const modelUsed = j?.model || j?.choices?.[0]?.model || model || "unknown";
    let textCandidate = j?.choices?.[0]?.message?.content ?? j?.output_text ?? "";

    // 2) JSON 파싱
    let analysis: any = null;
    if (textCandidate) {
      try {
        analysis = JSON.parse(textCandidate);
      } catch {
        const m = textCandidate.match(/\{[\s\S]*\}/);
        if (m) {
          try { analysis = JSON.parse(m[0]); } catch {}
        }
      }
    }
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

    // 3) Final prompt (영문)
    const final_prompt = buildFinalPrompt(analysis);

    // 4) 번역
    const tr = await translateToKorean({ text: final_prompt, apiKey: API_KEY, modelPrimary: model, meta: { referer, title } });

    // 5) 응답
    return res.status(r.status || 200).json({
      ok: r.ok,
      status: r.status || 200,
      provider: "openrouter",
      model: modelUsed,
      final_prompt,
      final_prompt_ko: tr.translated,          // 한글 결과 (실패 시 영문 폴백)
      translation_ok: tr.ok,
      translation_status: tr.status,
      translation_error: tr.error || null,
      analysis,
      // raw: j,  // 디버깅 시 주석 해제
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "OpenRouter request failed" });
  }
}
