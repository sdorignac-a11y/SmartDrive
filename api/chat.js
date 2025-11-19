// api/chat.js

// Memoria ligera en RAM (mientras el serverless esté "caliente")
const userPreferences = {}; 
// { [userId]: { notes: [] } }

// Construye el prompt de sistema en base a las notas guardadas
function buildSystemPrompt(preferences = {}) {
  const notas = preferences.notes?.join(" | ") || "Ninguna nota especial.";

  return `
Sos SmartDrive, un asistente de voz inteligente para el auto y para la vida diaria.

- Respondés sobre cualquier tema, no solo sobre manejo.
- Usás el contexto reciente de la conversación para entender referencias como "eso", "lo de antes", etc.
- Si el usuario dice "recordá que ..." o "acordate que ...", lo tomás como un dato importante o preferencia.
- No hables de que estás guardando datos internamente; solo respondé cosas tipo "Listo, lo tengo en cuenta".
- Si la pregunta es médica, legal o financiera seria, recomendá consultar con un profesional.

Información importante que ya sabés del usuario:
${notas}

Tu forma de hablar: cercana, clara, en español rioplatense.
  `.trim();
}

// Detecta frases tipo "recordá que ..." / "acordate que ..."
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { userId, messages } = req.body || {};

    // 🔴 Validación: esto era lo que te tiraba 400 antes
    if (!userId || !Array.isArray(messages) || messages.length === 0) {
      return res
        .status(400)
        .json({ error: "Faltan campos", reply: "No recibí ningún mensaje." });
    }

    // Inicializamos preferencias si no existen
    if (!userPreferences[userId]) {
      userPreferences[userId] = { notes: [] };
    }

    // Último mensaje del usuario -> ver si hay "recordá que..."
    const lastUserMessage = [...messages].reverse().find(m => m.role === "user");
    if (lastUserMessage) {
      const nuevaPref = extractPreferenceFromMessage(lastUserMessage.content);
      if (nuevaPref) {
        userPreferences[userId].notes.push(nuevaPref);
        console.log(`📝 Nueva preferencia para ${userId}:`, nuevaPref);
      }
    }

    const systemPrompt = buildSystemPrompt(userPreferences[userId]);

    // Llamada a OpenAI
    const openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini", // o el modelo que uses
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        temperature: 0.7,
      }),
    });

    const data = await openaiResp.json();

    if (!openaiResp.ok) {
      console.error("Error OpenAI:", data);
      return res
        .status(500)
        .json({ error: "Error llamando a OpenAI", detalle: data });
    }

    const reply =
      data.choices?.[0]?.message?.content ||
      "Lo siento, no pude generar una respuesta.";

    return res.status(200).json({
      reply,
      // opcional: para debug
      // preferences: userPreferences[userId],
    });
  } catch (err) {
    console.error("Error en /api/chat:", err);
    return res.status(500).json({
      error: "Error interno en el servidor",
    });
  }
}
