// api/gpt.ts
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { prompt, model = "gpt-4o-mini", mode = "preset" } = req.body || {};
  const system =
    mode === "preset"
      ? "You are a Firefly prompt generator. Return a single English prompt optimized for Adobe Firefly image generation with this structure: [subject] in [place], [time/weather], [style], [color], [composition], [detail]. Use cinematic lighting and clear scene descriptions. No extra commentary."
      : "You are a helpful assistant.";
  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: system },
          { role: "user", content: prompt || "" },
        ],
      }),
    });
    const j = await r.json();
    const text = (j as any)?.output_text || (j as any)?.choices?.[0]?.message?.content || "";
    res.status(200).json({ text });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
