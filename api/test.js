// api/test.js — Diagnóstico de conexión
export default async function handler(req, res) {
  // Configuración básica CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Respuesta rápida a preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Respuesta normal
  return res.status(200).json({
    ok: true,
    message: "✅ YucaBot API is alive and CORS is configured correctly!",
    method: req.method,
    time: new Date().toISOString(),
  });
}
