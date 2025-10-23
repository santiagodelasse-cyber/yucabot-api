const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const BODY_LIMIT = "10mb";

// Core middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

// Lightweight request logging
app.use((req, res, next) => {
  const start = Date.now();
  const startedAt = new Date().toISOString();
  console.log(`[${startedAt}] → ${req.method} ${req.originalUrl}`);

  res.on("finish", () => {
    const finishedAt = new Date().toISOString();
    const ms = Date.now() - start;
    console.log(`[${finishedAt}] ← ${req.method} ${req.originalUrl} ${res.statusCode} (${ms}ms)`);
  });

  next();
});

// Basic health check
app.get("/", (req, res) => {
  res.json({ ok: true, message: "🚀 YucaBot backend operational" });
});

// auto-mount route modules in /routes
["test", "ingest", "query"].forEach((name) => {
  const mountPath = `/api/${name}`;
  try {
    const handler = require(path.join(__dirname, "routes", `${name}.js`));
    app.use(mountPath, handler);
    console.log(`✓ Mounted ${name}.js at ${mountPath}`);
  } catch (error) {
    console.error(`⚠️ Failed to mount ${name}.js at ${mountPath}: ${error.message}`);
  }
});

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("💥 Uncaught error:", err);
  res.status(500).json({ success: false, error: "Internal Server Error" });
});

app.listen(PORT, () => {
  console.log(`▶ Server running at http://localhost:${PORT}`);
});
