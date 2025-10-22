// server.js
import express from "express";

const app = express();
const PORT = 3000;

app.get("/api/test", (req, res) => {
  res.json({ ok: true, message: "🚀 YucaBot API running locally via Express!" });
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}/api/test`);
});
