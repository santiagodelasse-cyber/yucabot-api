import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  try {
    const { data, error } = await supabase.from("knowledge_base").select("id").limit(1);
    if (error) throw error;
    return res.status(200).json({ ok: true, message: "✅ Conectado correctamente a Supabase" });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
}
