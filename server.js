// server.js
import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
app.use(express.json());

// Para servir index.html y archivos estáticos
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(__dirname));

// ⚙️ "Memoria ligera" en RAM por usuario
// Estructura: { userId: { notes: [ "odia el trap", "vive en X", ... ] } }
const userPreferences = {};

// 🧠 Prompt base de SmartDrive
function buildSystemPrompt(preferences = {}) {
  const notas = preferences.notes?.join(" | ") || "Ninguna nota especial.";

  return `
Sos SmartDrive, un asistente de voz inteligente para el auto y para la vida diaria.
- Respondés sobre cualquier tema, no solo manejo.
- Usás el contexto reciente de la conversación para entender pronombres como "eso", "lo de antes", etc.
- Si el usuario dice "recordá que ..." o "acordate que ...", lo tomás como un dato importante o preferencia.
- No hables explícitamente de que estás guardando datos; solo decí cosas como "Listo, lo tengo en cuenta".
- Si la pregunta es médica, legal o financiera seria, recomendá consultar con un profesional.

Información importante que ya sabés del usuario:
${notas}

Tu forma de hablar es cercana, clara, en español rioplatense.
  `.trim();
}

// 🔍 Detectar si el mensaje es del tipo "recordá que..."
function extractPreferenceFromMessage(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (lower.startsWith("recordá que ")) {
    return text.slice("recordá que ".length).trim();
  }
  if (lower.startsWith("recorda que ")) {
    return text.slice("recorda que ".length).trim();
  }
  if (lower.startsWith("acordate que ")) {
    return text.slice("acordate que ".length).trim();
  }
  return null;
}

// 🧵 Endpoint principal de chat
app.post("/api/chat", async (req, res) => {
  try {
    const { userId, messages } = req.body;

    if (!userId || !messages) {
      return res
        .status(400)
        .json({ error: "Falta userId o messages en el body" });
    }

    // Inicializamos preferencias si no existen
    if (!userPreferences[userId]) {
      userPreferences[userId] = { notes: [] };
    }

    // Último mensaje del usuario -> ver si dice "recordá que..."
    const lastUserMessage = [...messages].reverse().find(
      (m) => m.role === "user"
    );
    if (lastUserMessage) {
      const nuevaPref = extractPreferenceFromMessage(lastUserMessage.content);
      if (nuevaPref) {
        userPreferences[userId].notes.push(nuevaPref);
        console.log(`📝 Nueva preferencia para ${userId}:`, nuevaPref);
      }
    }

    const systemPrompt = buildSystemPrompt(userPreferences[userId]);

    // Llamada al API de OpenAI
    const openaiResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini", // o el modelo que estés usando
          messages: [
            { role: "system", content: systemPrompt },
            ...messages, // contexto que mandó el frontend
          ],
          temperature: 0.7,
        }),
      }
    );

    const data = await openaiResponse.json();

    if (!openaiResponse.ok) {
      console.error("Error OpenAI:", data);
      return res
        .status(500)
        .json({ error: "Error llamando a OpenAI", detalle: data });
    }

    const reply =
      data.choices?.[0]?.message?.content ||
      "Lo siento, no pude generar una respuesta.";

    return res.json({
      reply,
      // para debug: ver qué memoria tiene ese user
      preferences: userPreferences[userId],
    });
  } catch (err) {
    console.error("Error en /api/chat:", err);
    res.status(500).json({ error: "Error interno en el servidor" });
  }
});

// Servir index.html en la raíz
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 SmartDrive servidor escuchando en http://localhost:${PORT}`);
});
