import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ error: "Missing query" });
    }

    // Llama al modelo GPT para generar la respuesta
    const completion = await client.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        { role: "system", content: "You are YucaBot, a helpful business assistant." },
        { role: "user", content: query },
      ],
    });

    const answer = completion.choices[0].message.content;

    return res.status(200).json({ answer });
  } catch (error) {
    console.error("Error in /api/query:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
