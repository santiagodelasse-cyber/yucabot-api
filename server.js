// server.js
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/api/test", (req, res) => {
  res.json({ ok: true, message: "🚀 YucaBot API running locally via Express (CommonJS)" });
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}/api/test`);
});
