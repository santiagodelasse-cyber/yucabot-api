const EMBEDDING_MODEL = "mixedbread-ai/mxbai-embed-large-v1";
const EMBEDDING_DIM = 1024;
const DEFAULT_TIMEOUT_MS = 20000;
const MAX_TEXT_LENGTH = 20000;
const MAX_RETRIES = 2;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchCompat =
  typeof fetch === "function"
    ? fetch
    : (...args) => import("node-fetch").then(({ default: fetchFn }) => fetchFn(...args));

function normalizeText(input) {
  if (!input) return "";
  return input.replace(/\0/g, "").replace(/\s+/g, " ").trim();
}

function truncateForEmbedding(text) {
  if (!text) return "";
  if (text.length <= MAX_TEXT_LENGTH) return text;
  return text.slice(0, MAX_TEXT_LENGTH);
}

function normalizeEmbedding(vector, dim = EMBEDDING_DIM) {
  const result = new Array(dim).fill(0);
  if (!Array.isArray(vector)) return result;
  const limit = Math.min(vector.length, dim);
  for (let i = 0; i < limit; i += 1) {
    const value = Number(vector[i]);
    result[i] = Number.isFinite(value) ? value : 0;
  }
  return result;
}

async function requestEmbedding(text, { retries = MAX_RETRIES } = {}) {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) {
    throw new Error("HUGGINGFACE_API_KEY is not configured.");
  }

  const payload = {
    inputs: text,
    options: { wait_for_model: true }
  };

  const endpoint = `https://api-inference.huggingface.co/models/${EMBEDDING_MODEL}`;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetchCompat(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(`Hugging Face error ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      let vector;

      if (Array.isArray(data)) {
        vector = Array.isArray(data[0]) ? data[0] : data;
      } else if (Array.isArray(data?.data)) {
        vector = data.data;
      } else if (Array.isArray(data?.embeddings)) {
        vector = data.embeddings;
      } else {
        throw new Error("Unexpected embedding response format from Hugging Face.");
      }

      return normalizeEmbedding(vector);
    } catch (error) {
      if (attempt === retries || error.name === "AbortError") {
        throw error;
      }

      const backoff = 500 * Math.pow(2, attempt);
      await sleep(backoff);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Failed to obtain embedding after retries.");
}

async function generateEmbedding(rawText) {
  const cleaned = normalizeText(rawText);
  if (!cleaned) {
    throw new Error("Cannot generate embedding for empty text.");
  }
  const truncated = truncateForEmbedding(cleaned);
  return requestEmbedding(truncated);
}

module.exports = {
  EMBEDDING_MODEL,
  EMBEDDING_DIM,
  MAX_TEXT_LENGTH,
  normalizeText,
  truncateForEmbedding,
  normalizeEmbedding,
  generateEmbedding
};
