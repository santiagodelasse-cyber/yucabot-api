import formidable from "formidable";
import fs from "fs";
import mammoth from "mammoth";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import PDFParser from "pdf2json"; // 🔧 librería ligera, sin canvas

export const config = { api: { bodyParser: false } };

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function extractTextFromPDF(filePath) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();

    pdfParser.on("pdfParser_dataError", (err) => reject(err.parserError));
    pdfParser.on("pdfParser_dataReady", (pdfData) => {
      const text = pdfData.Pages.map((page) =>
        page.Texts.map((t) =>
          decodeURIComponent(t.R[0].T)
        ).join(" ")
      ).join("\n");
      resolve(text);
    });

    pdfParser.loadPDF(filePath);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  console.log("📩 Ingest request received");

  const form = formidable({});
  const [fields, files] = await form.parse(req);
  const file = files.file?.[0];

  if (!file) return res.status(400).json({ error: "No file uploaded" });

  const filePath = file.filepath;
  const fileType = file.mimetype;
  console.log(`📄 Processing file: ${file.originalFilename} (${fileType})`);

  let textContent = "";

  try {
    if (fileType === "application/pdf") {
      textContent = await extractTextFromPDF(filePath);
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

    if (error) throw error;

    console.log("✅ Documento procesado correctamente");
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("💥 Fatal ingest error:", error);
    return res.status(500).json({ error: error.message });
  } finally {
    try {
      fs.unlinkSync(filePath);
    } catch (_) {}
  }
}
