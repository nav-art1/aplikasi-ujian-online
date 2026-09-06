// Modul Autentikasi Guru (Supabase Auth)
// Implementasi lengkap akan diaktifkan pada Checkpoint 11
const AuthModule = {
  async loginGuru(email, password) {
    console.log("Login Guru dipicu:", email);
  },
  async logoutGuru() {
    console.log("Logout Guru dipicu");
  },
  async getCurrentTeacher() {
    return null;
  }
};
