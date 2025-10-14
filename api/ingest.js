import formidable from "formidable";
import fs from "fs";
import pdfParse from "pdf-parse-fixed-promise";
import mammoth from "mammoth";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

// 🔧 Evita que Vercel intente parsear el body
export const config = { api: { bodyParser: false } };

// 🧠 Inicializar clientes
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  console.log("📩 Ingest request received");

  const form = formidable({});
  const [fields, files] = await form.parse(req);
  const file = files.file?.[0];

  if (!file) {
    console.error("❌ No file uploaded");
    return res.status(400).json({ error: "No file uploaded" });
  }

  const filePath = file.filepath;
  const fileType = file.mimetype;
  console.log(`📄 Processing file: ${file.originalFilename} (${fileType})`);

  let textContent = "";

  try {
    // 📘 Tipos de archivo admitidos
    if (fileType === "application/pdf") {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(dataBuffer);
      textContent = pdfData.text;
    } else if (
      fileType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const dataBuffer = fs.readFileSync(filePath);
      const result = await mammoth.extractRawText({ buffer: dataBuffer });
      textContent = result.value;
    } else if (fileType === "text/plain") {
      textContent = fs.readFileSync(filePath, "utf8");
    } else {
      throw new Error(`Unsupported file type: ${fileType}`);
    }

    if (!textContent.trim()) {
      throw new Error("File appears to be empty or unreadable.");
    }

    console.log("🧠 Generating embedding...");
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: textContent.slice(0, 8000),
    });

    const [{ embedding }] = embeddingResponse.data;

    console.log("🚀 Saving to Supabase...");
    const { error } = await supabase.from("knowledge_base").insert({
      content: textContent.slice(0, 5000),
      embedding,
      created_at: new Date(),
    });

    if (error) {
      console.error("❌ Supabase insert error:", error);
      throw new Error("Failed to insert into Supabase");
    }

    console.log("✅ Documento procesado correctamente");
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("💥 Fatal ingest error:", error);
    return res.status(500).json({ error: error.message });
  } finally {
    try {
      fs.unlinkSync(filePath); // limpia archivo temporal
    } catch (_) {}
  }
}
