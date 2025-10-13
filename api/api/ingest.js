import OpenAI from "openai";
import formidable from "formidable";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

export const config = {
  api: { bodyParser: false },
};

// 🔥 Nuevo CORS robusto compatible con Lovable
const allowCors = (fn) => async (req, res) => {
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  );
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  return await fn(req, res);
};

const handler = async (req, res) => {
  try {
    if (req.method !== "POST")
      return res.status(405).json({ error: "Method not allowed" });

    console.log("📩 Request received in /api/ingest");

    const form = formidable({});
    const [fields, files] = await form.parse(req);
    const file = files.file?.[0];
    if (!file) {
      console.error("❌ No file uploaded");
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileBuffer = fs.readFileSync(file.filepath);
    const text = fileBuffer.toString("utf8");

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: text,
    });

    const embedding = embeddingResponse.data[0].embedding;
    const { error } = await supabase.from("knowledge_base").insert([
      {
        content: text,
        embedding,
      },
    ]);

    if (error) throw error;

    return res.status(200).json({ message: "✅ Documento procesado correctamente" });
  } catch (error) {
    console.error("💥 Error in /api/ingest:", error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};

export default allowCors(handler);


