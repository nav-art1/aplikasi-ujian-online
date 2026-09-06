// Konfigurasi Klien Supabase
// Masukkan kredensial dari Checkpoint 3 pada Checkpoint 10
const SUPABASE_CONFIG = {
  URL: "",
  ANON_KEY: ""
};

let db = null;

function getSupabaseClient() {
  if (!db && window.supabase) {
    if (!SUPABASE_CONFIG.URL || !SUPABASE_CONFIG.ANON_KEY) {
      console.warn("Supabase URL dan Anon Key belum dikonfigurasi di js/supabase.js");
    } else {
      db = window.supabase.createClient(SUPABASE_CONFIG.URL, SUPABASE_CONFIG.ANON_KEY);
    }
  }
  return db;
}
