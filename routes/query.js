const express = require("express");

const { searchByEmbedding } = require("../lib/supabase");
const {
  generateEmbedding,
  normalizeText,
  EMBEDDING_DIM,
  EMBEDDING_MODEL
} = require("../lib/embedding");

const router = express.Router();
const DEFAULT_LIMIT = 4;

router.post("/", async (req, res, next) => {
  try {
    const rawQuery = req.body?.query;
    const cleanedQuery = normalizeText(typeof rawQuery === "string" ? rawQuery : "");

    if (!cleanedQuery) {
      return res.status(400).json({ error: "Field 'query' is required and must be a non-empty string." });
    }

    const embedding = await generateEmbedding(cleanedQuery);
    const matches = await searchByEmbedding(embedding, { limit: DEFAULT_LIMIT });

    return res.json({
      matches,
      usage: {
        model: EMBEDDING_MODEL,
        dims: EMBEDDING_DIM
      },
      answer: null
    });
  } catch (error) {
    if (error.message?.startsWith("Supabase search failed")) {
      return res.status(503).json({ error: error.message });
    }

    if (error.message?.includes("HUGGINGFACE_API_KEY")) {
      return res.status(500).json({ error: "Embedding service not configured. Set HUGGINGFACE_API_KEY." });
    }

    return next(error);
  }
});

module.exports = router;
