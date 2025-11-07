// server.js
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';

// Si no usás node-fetch en Node 18+, podés eliminar esto; aquí mantengo compat:
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Sirve archivos estáticos (index.html en /public)
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Prompt para que el modelo devuelva SIEMPRE JSON válido:
 */
const SYSTEM_PROMPT = `
Eres un parser de comandos de voz para auto. Devuelves SOLO JSON válido.
Esquema:
{
  "intent": "call" | "message" | "music" | "navigate" | "smalltalk" | "unknown",
  "slots": { },
  "reply": "string breve y natural en español"
}
Reglas:
- "call": slots: { contact?: string, phone?: string }
- "message": slots: { app?: "whatsapp"|"sms", to?: string, body?: string }
- "music": slots: { query?: string, service?: "spotify"|"apple_music" }
- "navigate": slots: { destination?: string }
- "smalltalk": slots: {}
- Si la orden no aplica conduciendo, responde "unknown".
- Nunca incluyas comentarios, SOLO JSON. Idioma: español.
`;

/** Llama a OpenAI para extraer intent/slots */
async function gptParse(text) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-5',           // usa tu modelo disponible
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text }
      ]
    })
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(()=> '');
    throw new Error(`OpenAI error ${resp.status}: ${errText}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content?.trim() || '{}';
  try { return JSON.parse(content); }
  catch { return { intent: 'unknown', slots: {}, reply: 'No entendí bien.' }; }
}

app.post('/api/intent', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'Missing text' });

    const parsed = await gptParse(text);
    res.json({
      intent: parsed.intent ?? 'unknown',
      slots: parsed.slots ?? {},
      reply: parsed.reply ?? 'Listo.'
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ intent: 'unknown', slots: {}, reply: 'Hubo un error.' });
  }
});

// Fallback para SPA (si abrís / directamente)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('SmartDrive backend on :' + PORT));
