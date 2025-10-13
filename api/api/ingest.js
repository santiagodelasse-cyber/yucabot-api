import OpenAI from "openai";
import formidable from "formidable";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: false } };

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    console.log("📩 Request received in /api/ingest");

    const form = formidable({});
    const [fields, files] = await form.parse(req);
    console.log("🧾 Fields:", fields);
    console.log("📂 Files:", files);

    const file = files.file?.[0];
    if (!file) {
      console.error("❌ No file found in request");
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileBuffer = fs.readFileSync(file.filepath);
    const text = fileBuffer.toString("utf8");
    console.log("📜 Extracted text length:", text.length);

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: text,
    });
    console.log("🧠 Embedding generated");

    const embedding = embeddingResponse.data[0].embedding;
    const { error } = await supabase.from("knowledge_base").insert([
      {
        content: text,
        embedding,
      },
    ]);

    if (error) {
      console.error("❌ Supabase insert error:", error);
      throw error;
    }

    console.log("✅ Document processed successfully");
    return res.status(200).json({ message: "✅ Documento procesado correctamente" });
  } catch (error) {
    console.error("💥 Fatal error in /api/ingest:", error);
    return res.status(500).json({
      error: error.message || "Internal Server Error",
      stack: error.stack,
    });
  }
}
