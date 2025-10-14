import OpenAI from "openai";
import formidable from "formidable";
import fs from "fs/promises";
import path from "path";
import pdf from "pdf-parse";
import mammoth from "mammoth";
import { createClient } from "@supabase/supabase-js";

export const config = {
  api: { bodyParser: false },
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  console.log("📩 Ingest request received");

  try {
    // 🧾 Parsear archivo subido
    const form = formidable({ multiples: false });
    const [fields, files] = await form.parse(req);
    const file = files.file?.[0];
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    const filePath = file.filepath;
    const ext = path.extname(file.originalFilename || "").toLowerCase();
    let textContent = "";

    console.log(`📄 Processing file: ${file.originalFilename} (${ext})`);

    // 📘 Leer archivo en Buffer (sin rutas relativas)
    const buffer = await fs.readFile(filePath);

    if (ext === ".txt") {
      textContent = buffer.toString("utf8");
    } else if (ext === ".pdf") {
      const pdfData = await pdf(buffer); // ✅ ahora pasa el buffer directo, sin rutas
      textContent = pdfData.text;
    } else if (ext === ".docx") {
      const result = await mammoth.extractRawText({ buffer });
      textContent = result.value;
    } else {
      return res.status(400).json({ error: "Unsupported file type" });
    }

    if (!textContent.trim()) {
      return res.status(400).json({ error: "Empty or invalid file content" });
    }

    console.log("🧠 Generating embedding...");
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: textContent.slice(0, 8000),
    });

    const embedding = embeddingResponse.data[0].embedding;

    console.log("🚀 Saving to Supabase...");
    const { error } = await supabase.from("knowledge_base").insert([
      {
        content: textContent.slice(0, 20000),
        embedding,
      },
    ]);

    if (error) {
      console.error("❌ Supabase insert error:", error);
      return res.status(500).json({ error: "Failed to save to Supabase" });
    }

    console.log("✅ Upload complete!");
    res.status(200).json({ message: "File uploaded and processed successfully" });

  } catch (error) {
    console.error("💥 Fatal ingest error:", error);
    res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
}
