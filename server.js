// server.js (versión ES Modules)
import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

// Ruta de prueba
app.get("/api/test", (req, res) => {
  res.json({ ok: true, message: "🚀 YucaBot API running locally via Express (ESM)" });
});

// Inicia servidor
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}/api/test`);
});
