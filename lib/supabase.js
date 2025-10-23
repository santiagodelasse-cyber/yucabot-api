const { createClient } = require("@supabase/supabase-js");

const requiredEnv = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = requiredEnv.filter((name) => !process.env[name]);
if (missing.length) {
  console.error("Missing Supabase environment variables:", missing.join(", "));
  throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before using the Supabase client");
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

async function insertData(table, data) {
  const { error } = await supabase.from(table).insert(data);
  if (error) {
    console.error(`Error inserting into ${table}:`, error.message);
    throw error;
  }
  return true;
}

async function fetchLatest(table, limit = 5) {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`Error querying ${table}:`, error.message);
    throw error;
  }

  return data;
}

module.exports = {
  supabase,
  insertData,
  fetchLatest
};
