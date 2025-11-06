// api/intent.js — Vercel serverless

// Parseo manual del body (en funciones serverless de Vercel req.body no viene parseado)
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
Devuelves SIEMPRE SOLO JSON válido:
{
 "intent": "call" | "message" | "music" | "navigate" | "smalltalk" | "general" | "unknown",
 "slots": {},
 "reply": "respuesta breve y natural en español"
}
Reglas:
- Si el usuario pide la HORA o la FECHA, NO inventes valores. Devuelve:
  "intent":"general" y en "slots":{"topic":"time"} o {"topic":"date"} y una reply neutra (ej.: "Te digo la hora.").
- "call": llamadas → slots { contact?, phone? }
- "message": enviar mensajes/WhatsApp → slots { app?, to?, body? }
- "music": reproducir/abrir música → slots { query?, service? }
- "navigate": rutas/destinos → slots { destination }
- "smalltalk": saludos/agradecimientos
- "general": preguntas informativas no cubiertas (hora/fecha/clima, etc.)
- "unknown": cuando no queda claro.

Responde SOLO el JSON, sin texto adicional.
`;

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',          // estable y barato; luego podés cambiar a gpt-5
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
