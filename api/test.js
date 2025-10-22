// api/test.js
export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "🚀 YucaBot API working correctly from Vercel!"
    });
  } else {
    return res.status(405).json({ error: "Method not allowed" });
  }
}
