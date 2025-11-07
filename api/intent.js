// /api/intent.js — parser de órdenes (call/message/music/navigate)
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'Missing text' });

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const OPENAI_MODEL   = process.env.OPENAI_MODEL || 'gpt-5';

    const SYSTEM_PROMPT = `
Eres un parser de comandos de voz para auto. Devuelves SOLO JSON válido.
Esquema:
{ "intent": "call"|"message"|"music"|"navigate"|"smalltalk"|"unknown",
  "slots": { }, "reply": "string breve y natural en español" }
Reglas:
- "call": slots: { contact?: string, phone?: string }
- "message": slots: { app?: "whatsapp"|"sms", to?: string, body?: string }
- "music": slots: { query?: string, service?: "spotify"|"apple_music" }
- "navigate": slots: { destination?: string }
- "smalltalk": slots: {}
- Si la orden no aplica conduciendo, responde "unknown".
- Nunca incluyas comentarios, SOLO JSON. Idioma: español.
`;

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: text }
        ]
      })
    });
    if (!resp.ok) throw new Error(await resp.text());
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content?.trim() || '{}';
    const parsed = JSON.parse(content);
    res.status(200).json({
      intent: parsed.intent ?? 'unknown',
      slots:  parsed.slots  ?? {},
      reply:  parsed.reply  ?? 'Listo.'
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ intent: 'unknown', slots: {}, reply: 'Hubo un error.' });
  }
}
