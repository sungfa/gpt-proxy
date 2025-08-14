// api/gpt.ts
import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { prompt } = req.body

  if (!prompt) {
    return res.status(400).json({ error: 'No prompt provided' })
  }

  try {
    const apiRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: prompt
      })
    })

    const data = await apiRes.json()
    res.status(200).json(data)
  } catch (err) {
    res.status(500).json({ error: 'Request failed', details: err })
  }
}
