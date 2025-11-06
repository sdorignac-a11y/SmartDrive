export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'Missing text' });

  const SYSTEM_PROMPT = `
Eres un parser de comandos de voz para auto. Devuelves SOLO JSON válido:
{
 "intent":"call"|"message"|"music"|"navigate"|"smalltalk"|"unknown",
 "slots":{},
 "reply":"string en español"
}
Reglas: call{contact?,phone?} message{app? to? body?} music{query? service?} navigate{destination?}
Si dudas→"unknown". Solo JSON.
`;

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-5',
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text }
        ]
      })
    });

    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content?.trim() || '{}';
    let parsed;
    try { parsed = JSON.parse(content); }
    catch { parsed = { intent:'unknown', slots:{}, reply:'No entendí bien.' }; }

    res.status(200).json({
      intent: parsed.intent ?? 'unknown',
      slots: parsed.slots ?? {},
      reply: parsed.reply ?? 'Listo.'
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ intent:'unknown', slots:{}, reply:'Hubo un error.' });
  }
}
