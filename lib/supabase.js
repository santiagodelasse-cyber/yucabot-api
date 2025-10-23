const { EMBEDDING_DIM } = require("./embedding");

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const DEFAULT_TABLE = "knowledge_base";
const MAX_RETRIES = 3;

let cachedClientPromise;

function validateEnv() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing Supabase environment variables: ${missing.join(", ")}`);
  }
}

async function createSupabaseClient() {
  validateEnv();
  const supabaseModule = await import("@supabase/supabase-js");
  const { createClient } = supabaseModule;

  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    global: {
      headers: {
        "X-Client-Info": "yucabot-api-server"
      }
    }
  });
}

async function getClient() {
  if (!cachedClientPromise) {
    cachedClientPromise = createSupabaseClient();
  }
  return cachedClientPromise;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableError(error) {
  if (!error) return false;
  const retryableCodes = ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "42501"];
  return retryableCodes.includes(error.code);
}

async function insertKnowledge(content, embedding, { table = DEFAULT_TABLE } = {}) {
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIM) {
    throw new Error(`Embedding must be an array with ${EMBEDDING_DIM} dimensions.`);
  }

  const client = await getClient();
  const payload = {
    content,
    embedding
  };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const { error } = await client.from(table).insert(payload);
    if (!error) {
      return { success: true };
    }

    if (!isRetryableError(error) || attempt === MAX_RETRIES - 1) {
      const message = error?.message || "Unknown Supabase insert error.";
      throw new Error(`Supabase insert failed: ${message}`);
    }

    await sleep(250 * (attempt + 1));
  }

  throw new Error("Failed to insert knowledge after retries.");
}

async function searchByEmbedding(queryEmbedding, { limit = 4 } = {}) {
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length !== EMBEDDING_DIM) {
    throw new Error(`Query embedding must be an array with ${EMBEDDING_DIM} dimensions.`);
  }

  const client = await getClient();
  const params = {
    query_embedding: queryEmbedding,
    match_count: limit
  };

  const { data, error } = await client.rpc("match_knowledge_base", params);
  if (error) {
    const hint =
      error.code === "42883"
        ? "Create the `match_knowledge_base` RPC as per docs to enable vector search."
        : "";
    throw new Error(`Supabase search failed: ${error.message || "Unknown error"}. ${hint}`.trim());
  }

  return Array.isArray(data) ? data : [];
}

module.exports = {
  getClient,
  insertKnowledge,
  searchByEmbedding
};
