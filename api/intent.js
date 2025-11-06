// api/intent.js — versión chat/completions + parseo de body en Vercel

async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8') || '{}';
  try { return JSON.parse(raw); } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { text } = await readJsonBody(req);
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Missing text', debug: { got: text } });
  }

  const SYSTEM_PROMPT = `
Eres un asistente de voz para auto (Drive.AI).
Devuelve SIEMPRE SOLO JSON:
{
 "intent": "call" | "message" | "music" | "navigate" | "smalltalk" | "general" | "unknown",
 "slots": {},
 "reply": "respuesta breve y natural en español"
}
Guía:
- call: "llamá a..." {contact?, phone?}
- message: "mandale un WhatsApp..." {app?, to?, body?}
- music: "poné..." {query?, service?}
- navigate: "llevame a..." {destination}
- smalltalk: saludos
- general: hora/fecha/clima
- unknown: si no queda claro
`;

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',           // estable y barato; luego podés cambiar a gpt-5
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text }
        ]
      })
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(500).json({ error: 'openai_error', details: data?.error || data });
    }

    const content = data?.choices?.[0]?.message?.content?.trim?.() || '{}';

    let parsed;
    try { parsed = JSON.parse(content); }
    catch { parsed = { intent:'unknown', slots:{}, reply:'No entendí bien.' }; }

    return res.status(200).json(parsed);
  } catch (e) {
    console.error('intent.handler.error', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
