export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'Missing text' });

  const SYSTEM_PROMPT = `
Eres un asistente de voz para un auto, llamado Drive.AI.
Tu tarea es analizar el texto del usuario y devolver SIEMPRE un JSON con:
{
 "intent": "call" | "message" | "music" | "navigate" | "smalltalk" | "general" | "unknown",
 "slots": {},
 "reply": "respuesta corta en español, hablada naturalmente"
}

Guía:
- "call": llamadas telefónicas ("llamá a", "quiero hablar con")
- "message": mensajes ("mandale un mensaje", "enviar whatsapp")
- "music": música ("poné música", "abrí Spotify")
- "navigate": navegación ("llevame a", "cómo llegar a")
- "smalltalk": frases casuales ("hola", "gracias", "cómo estás")
- "general": preguntas informativas ("qué hora es", "qué día es", "cómo está el clima")
- "unknown": si no entendés qué hacer

Ejemplo:
Usuario: "Qué hora es"
→ {
  "intent": "general",
  "slots": {},
  "reply": "Son las 3:45 de la tarde."
}
Usuario: "Llevame a la estación de servicio"
→ {
  "intent": "navigate",
  "slots": {"destination":"estación de servicio"},
  "reply": "Abriendo ruta hacia la estación de servicio."
}
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
        temperature: 0.3,
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
