import OpenAI from "openai";
import formidable from "formidable";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: false } };

const allowCors = (fn) => async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  return await fn(req, res);
};

const handler = async (req, res) => {
  try {
    console.log("📩 Ingest request received");

    const form = formidable({});
    const [fields, files] = await form.parse(req);
    const file = files.file?.[0];
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    const fileBuffer = fs.readFileSync(file.filepath);
    const text = fileBuffer.toString("utf8");
    console.log("📜 Extracted text length:", text.length);

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: text,
    });
    console.log("🧠 Embedding created");

    const embedding = embeddingResponse.data[0].embedding;

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    console.log("🚀 Inserting into Supabase...");
    const { data, error } = await supabase.from("knowledge_base").insert([
      { content: text, embedding },
    ]);

    if (error) {
      console.error("❌ Supabase insert error:", error);
      return res.status(500).json({ error: error.message });
    }

    console.log("✅ Insert success:", data);
    return res.status(200).json({ message: "✅ Documento procesado correctamente" });
  } catch (error) {
    console.error("💥 Fatal error in /api/ingest:", error);
    res.status(500).json({ error: error.message });
  }
};

export default allowCors(handler);
