import http from "http";

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url === "/api/test") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, message: "YucaBot API running locally!" }));
  } else {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}/api/test`);
});
