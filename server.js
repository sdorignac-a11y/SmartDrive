// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';

const app = express();
app.use(cors());
app.use(bodyParser.json());

/**
 * Prompt para que GPT-5 devuelva SIEMPRE JSON válido con:
 * intent: "call" | "message" | "music" | "navigate" | "smalltalk" | "unknown"
 * slots: objeto con los parámetros relevantes
 * reply: texto breve para TTS (lo que el asistente dirá)
 */
const SYSTEM_PROMPT = `
Eres un parser de comandos de voz para auto. Devuelves SOLO JSON válido.
Esquema:
{
  "intent": "call" | "message" | "music" | "navigate" | "smalltalk" | "unknown",
  "slots": { ... },
  "reply": "string breve y natural en español"
}

Reglas:
- "call": slots: { contact?: string, phone?: string }
- "message": slots: { app?: "whatsapp"|"sms", to?: string, body?: string }
- "music": slots: { query?: string, service?: "spotify"|"apple_music" }
- "navigate": slots: { destination?: string }
- "smalltalk": slots: {}
- Si no estás seguro, "unknown".
- Nunca incluyas comentarios, solo JSON. 
- Idioma de salida: español.
`;

async function gptParse(text) {
  // Usa la API de OpenAI (SDK v4 fetch directo)
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-5', // o el alias que uses
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text }
      ]
    })
  });

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content?.trim() || '{}';

  // Parse seguro
  try {
    return JSON.parse(content);
  } catch {
    return { intent: 'unknown', slots: {}, reply: 'No entendí bien.' };
  }
}

app.post('/api/intent', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text' });

    const parsed = await gptParse(text);

    // Sanitización mínima
    const out = {
      intent: parsed.intent ?? 'unknown',
      slots: parsed.slots ?? {},
      reply: parsed.reply ?? 'Listo.'
    };

    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ intent: 'unknown', slots: {}, reply: 'Hubo un error.' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('Voice backend on :' + PORT));
