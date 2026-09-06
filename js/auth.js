// ==========================================================================
// MODUL AUTENTIKASI GURU (SUPABASE AUTH)
// ==========================================================================

const AuthModule = {
  // 1. Fungsi Login Guru menggunakan Email & Password
  async loginGuru(email, password) {
    const client = getSupabaseClient();
    if (!client) {
      return { success: false, message: "Klien Supabase belum siap." };
    }

    try {
      const { data, error } = await client.auth.signInWithPassword({
        email: email.trim(),
        password: password
      });

      if (error) {
        return { success: false, message: error.message };
      }

      return { success: true, user: data.user, session: data.session };
    } catch (err) {
      return { success: false, message: `Terjadi kesalahan sistem: ${err.message}` };
    }
  },

  // 2. Fungsi Logout Guru
  async logoutGuru() {
    const client = getSupabaseClient();
    if (!client) return;

    try {
      await client.auth.signOut();
      window.location.reload();
    } catch (err) {
      console.error("Gagal logout:", err);
    }
  },

  // 3. Mengambil Sesi Pengguna Aktif
  async getCurrentTeacher() {
    const client = getSupabaseClient();
    if (!client) return null;

    try {
      const { data: { session }, error: sessionError } = await client.auth.getSession();
      if (sessionError || !session) return null;

      // Ambil detail nama dari tabel teachers
      const { data: teacherProfile, error: profileError } = await client
        .from('teachers')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (profileError || !teacherProfile) {
        return {
          id: session.user.id,
          email: session.user.email,
          full_name: session.user.email.split('@')[0]
        };
      }

      return teacherProfile;
    } catch (err) {
      console.error("Gagal membaca sesi guru:", err);
      return null;
    }
  }
};
