export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'Missing text' });

  const SYSTEM_PROMPT = `
Eres un asistente de voz para un auto llamado Drive.AI.
Debes analizar el mensaje del usuario y devolver un JSON con:
{
 "intent": "call" | "message" | "music" | "navigate" | "smalltalk" | "general" | "unknown",
 "slots": {},
 "reply": "respuesta corta y natural en español"
}

Guía:
- "call": si quiere hacer una llamada
- "message": si quiere enviar un mensaje o WhatsApp
- "music": si pide reproducir música
- "navigate": si pide ir a un lugar
- "smalltalk": saludos o conversación informal
- "general": si pregunta la hora, el clima, o algo general
- "unknown": si no se entiende
`;

  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        response_format: { type: "json_object" },
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text }
        ]
      })
    });

    const data = await r.json();

    const content =
      data?.output_text?.trim?.() ||
      data?.choices?.[0]?.message?.content?.trim?.() ||
      "{}";

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { intent: "unknown", slots: {}, reply: "No entendí bien." };
    }

    res.status(200).json(parsed);
  } catch (e) {
    console.error(e);
    res.status(500).json({ intent: "unknown", slots: {}, reply: "Hubo un error." });
  }
}

