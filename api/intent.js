// api/intent.js
async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8') || '{}';
  try { return JSON.parse(raw); } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { text } = await readJsonBody(req); // <- body parse manual
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Missing text', debug: { got: text } });
  }

  const SYSTEM_PROMPT = `
Eres un asistente de voz para un auto llamado Drive.AI.
Devuelve SIEMPRE SOLO JSON:
{
 "intent": "call" | "message" | "music" | "navigate" | "smalltalk" | "general" | "unknown",
 "slots": {},
 "reply": "respuesta breve y natural en español"
}
Guía:
- call: llamadas ("llamá a...", {contact?, phone?})
- message: mensajes/WhatsApp ({app?, to?, body?})
- music: reproducir/abrir música ({query?, service?})
- navigate: rutas/destinos ({destination})
- smalltalk: saludos/charla
- general: hora, fecha, clima, etc.
- unknown: si no queda claro.
`;

  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        response_format: { type: 'json_object' },
        // En Responses API mandamos prompt completo como string:
        input: `${SYSTEM_PROMPT}\n\nUsuario: ${text}`
      })
    });

    const data = await r.json();

    if (!r.ok) {
      // Propagamos el error para verlo en el front
      return res.status(500).json({ error: 'openai_error', details: data?.error || data });
    }

    const content =
      (typeof data.output_text === 'string' && data.output_text.trim()) ||
      (data.choices?.[0]?.message?.content || '').trim() || '{}';

    let parsed;
    try { parsed = JSON.parse(content); }
    catch { parsed = { intent:'unknown', slots:{}, reply:'No entendí bien.' }; }

    return res.status(200).json(parsed);
  } catch (e) {
    console.error('intent.handler.error', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
