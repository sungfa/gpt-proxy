// /api/gpt.ts — Vercel Serverless Function (CORS + body parse + 429 재시도)

// ---------- 공통 유틸 ----------
function setCors(res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function parseBody(req: any) {
  // Edge(whatwg) | Node | Raw string 모두 대응
  if (typeof req.json === "function") return await req.json();
  if (typeof req.body === "string") return JSON.parse(req.body);
  return req.body || {};
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// OpenAI Chat Completions 호출 + 429 재시도(최대 3회)
async function callOpenAI(payload: any, apiKey: string) {
  let lastJson: any = null;

  for (let i = 0; i < 3; i++) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const j = await r.json().catch(() => ({}));
    lastJson = j;

    // 레이트리밋이면 백오프 후 재시도
    if (r.status === 429) {
      const retryAfter = Number(r.headers.get("retry-after") || "0");
      await sleep(retryAfter ? retryAfter * 1000 : 500 * Math.pow(2, i));
      continue;
    }

    return { r, j };
  }

  // 3회 모두 429면 여기로
  return {
    r: { ok: false, status: 429 } as any,
    j: lastJson || { error: { message: "Rate limited" } },
  };
}

// ---------- 메인 핸들러 ----------
export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET") return res.status(200).json({ ok: true, route: "/api/gpt" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // 바디 파싱
  let body: any;
  try {
    body = await parseBody(req);
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const {
    prompt,
    model = "gpt-4o-mini",      // 필요시 gpt-4o 등으로 교체 가능
    mode  = "preset",            // "preset"은 Firefly용 톤, "raw"는 일반 대화
    temperature = 0.7,           // 선택
  } = body || {};

  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
  if (!prompt)                      return res.status(400).json({ error: "No prompt provided" });

  const system =
    mode === "preset"
      ? "You are a Firefly prompt generator. Return a single English prompt optimized for Adobe Firefly image generation with this structure: [subject] in [place], [time/weather], [style], [color], [composition], [detail]. Use cinematic lighting and clear scene descriptions. No extra commentary."
      : "You are a helpful assistant.";

  const payload = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user",   content: String(prompt) },
    ],
    temperature,
  };

  try {
    const { r, j } = await callOpenAI(payload, process.env.OPENAI_API_KEY!);

    const text =
      j?.choices?.[0]?.message?.content ??
      j?.output_text ?? // 혹시 다른 응답 포맷 대비
      "";

    // 디버깅 편의 위해 status / error 함께 반환
    return res.status((r as any).status || 200).json({
      ok: (r as any).ok ?? true,
      status: (r as any).status ?? 200,
      text,
      error: j?.error?.message,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "OpenAI request failed" });
  }
}
