import OpenAI from "openai";
import formidable from "formidable";
import fs from "fs/promises";
import path from "path";
import mammoth from "mammoth";
import { createClient } from "@supabase/supabase-js";
// 👇 este import usa la versión que sí funciona en serverless
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import "pdfjs-dist/build/pdf.worker.mjs";

export const config = {
  api: { bodyParser: false },
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  console.log("📩 Ingest request received");

  try {
    const form = formidable({ multiples: false });
    const [fields, files] = await form.parse(req);
    const file = files.file?.[0];
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    const filePath = file.filepath;
    const ext = path.extname(file.originalFilename || "").toLowerCase();
    let textContent = "";

    console.log(`📄 Processing file: ${file.originalFilename} (${ext})`);

    const buffer = await fs.readFile(filePath);

    if (ext === ".txt") {
      textContent = buffer.toString("utf8");
    } else if (ext === ".pdf") {
     const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((item) => item.str).join(" ") + "\n";
      }
      textContent = text;
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
      { content: textContent.slice(0, 20000), embedding },
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
