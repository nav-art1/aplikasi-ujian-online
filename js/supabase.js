// Konfigurasi Klien Supabase
// Masukkan kredensial dari Checkpoint 3 pada Checkpoint 10
const SUPABASE_CONFIG = {
  URL: "https://gxwqfvjbjzsxkfsmkhnh.supabase.co",
  ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4d3FmdmpianpzeGtmc21raG5oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2OTgxMjcsImV4cCI6MjEwNDI3NDEyN30.G0LmcTU5biVkSGAkVc-FUyZlyWNS7_yDxtf7-Nw-eyg"
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
