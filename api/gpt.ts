// /api/gpt.ts
// ✅ GPT Proxy API (Vercel 서버리스 함수)
// - preset: 일반 Chat
// - vision_firefly: 이미지/프롬프트 분석
// - translate_ko: 영문 → 한글 번역
// - raw: 그대로 프롬프트 전달
// ------------------------------------------

export const config = {
  runtime: "edge",
};

export default async function handler(req: Request): Promise<Response> {
  // ✅ CORS 프리플라이트 처리
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const {
    model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
    mode = "preset",
    prompt,
    text,
    messages,
    imageUrl,
    temperature = 0.7,
  } = body;

  if (!process.env.OPENROUTER_API_KEY) {
    return new Response(JSON.stringify({ error: "Missing API key" }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  // ✅ 공통 요청 옵션
  const baseHeaders = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
    "HTTP-Referer": process.env.APP_URL || "https://example.com",
    "X-Title": process.env.APP_NAME || "Framer GPT Console",
  };

  // ==========================================================
  // 모드별 처리
  // ==========================================================

  // ---------- 번역 모드 (영문 → 한글) ----------
  if (mode === "translate_ko") {
    if (!text) {
      return new Response(JSON.stringify({ error: "No text for translate_ko" }), {
        status: 400,
        headers: corsHeaders,
      });
    }
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You are a professional translator. Translate the user's text into KOREAN. Output ONLY the translated Korean text, no extra words.",
          },
          { role: "user", content: String(text) },
        ],
      }),
    });

    const j = await r.json().catch(() => ({}));
    const translated =
      j?.choices?.[0]?.message?.content?.trim?.() ??
      j?.output_text ??
      "";

    return new Response(
      JSON.stringify({
        ok: r.ok,
        status: r.status,
        provider: "openrouter",
        model,
        text: translated,
        error: j?.error?.message,
      }),
      { status: r.status, headers: corsHeaders }
    );
  }

  // ---------- Firefly Vision 모드 ----------
  if (mode === "vision_firefly") {
    if (!imageUrl || !prompt) {
      return new Response(JSON.stringify({ error: "Need imageUrl + prompt" }), {
        status: 400,
        headers: corsHeaders,
      });
    }
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          {
            role: "system",
            content: "You are an AI that analyzes and generates Firefly prompts.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    });

    const j = await r.json().catch(() => ({}));
    const out = j?.choices?.[0]?.message?.content?.trim?.() ?? "";
    return new Response(
      JSON.stringify({ text: out, raw: j }),
      { status: r.status, headers: corsHeaders }
    );
  }

  // ---------- Preset Chat 모드 ----------
  if (mode === "preset") {
    if (!prompt && !messages) {
      return new Response(JSON.stringify({ error: "Need prompt or messages" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({
        model,
        temperature,
        messages:
          messages ??
          [
            {
              role: "system",
              content: "You are a helpful assistant.",
            },
            { role: "user", content: String(prompt) },
          ],
      }),
    });

    const j = await r.json().catch(() => ({}));
    const out = j?.choices?.[0]?.message?.content?.trim?.() ?? "";
    return new Response(
      JSON.stringify({ text: out, raw: j }),
      { status: r.status, headers: corsHeaders }
    );
  }

  // ---------- Raw 프록시 모드 ----------
  if (mode === "raw") {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    return new Response(JSON.stringify(j), {
      status: r.status,
      headers: corsHeaders,
    });
  }

  return new Response(JSON.stringify({ error: "Unknown mode" }), {
    status: 400,
    headers: corsHeaders,
  });
}

// ✅ CORS 헤더
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
