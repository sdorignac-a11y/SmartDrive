// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import chatHandler from "./api/chat.js";

dotenv.config();

const app = express();
app.use(express.json());

// Necesario para __dirname en ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Servir archivos estáticos (index.html, css, etc.)
app.use(express.static(__dirname));

// Ruta de la IA
app.post("/api/chat", chatHandler);

// Fallback: cualquier otra ruta devuelve index.html (opcional)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 SmartDrive escuchando en http://localhost:${PORT}`);
});
