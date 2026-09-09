// ==========================================================================
// MODUL OTENTIKASI & VALIDASI AKSES SISWA BESERTA PARAMETER ANTI-CURANG
// ==========================================================================

const StudentAuthModule = {
  init() {
    const form = document.getElementById("form-student-login");
    const tokenInput = document.getElementById("exam-token-input");

    if (tokenInput) {
      tokenInput.addEventListener("input", (e) => {
        e.target.value = e.target.value.toUpperCase().replace(/\s/g, '');
      });
    }

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handleLogin();
      });
    }
  },

  async handleLogin() {
    const nisnInput = document.getElementById("student-nisn");
    const tokenInput = document.getElementById("exam-token-input");
    const btnSubmit = document.getElementById("btn-submit-student-login");
    const alertEl = document.getElementById("student-login-alert");

    const studentNumber = nisnInput.value.trim();
    const token = tokenInput.value.trim().toUpperCase();

    alertEl.classList.add("d-none");
    btnSubmit.disabled = true;
    btnSubmit.innerText = "Memverifikasi Akses...";

    const client = getSupabaseClient();
    if (!client) {
      this.showAlert("Koneksi Supabase belum siap. Periksa berkas js/supabase.js.", "error");
      btnSubmit.disabled = false;
      btnSubmit.innerText = "Masuk Ruang Ujian \u2192";
      return;
    }

    try {
      // 1. Ambil data sesi ujian termasuk kolom anti_cheat dan max_violations
      const { data: examData, error: examError } = await client
        .from('exams')
        .select(`
          id,
          title,
          subject,
          duration_minutes,
          token,
          is_active,
          class_id,
          randomize_questions,
          randomize_options,
          anti_cheat,
          max_violations,
          classes ( class_name )
        `)
        .ilike('token', token)
        .maybeSingle();

      if (examError) throw examError;

      if (!examData) {
        this.showAlert(`Token ujian "${token}" tidak ditemukan. Pastikan token yang diketik sesuai.`, "error");
        btnSubmit.disabled = false;
        btnSubmit.innerText = "Masuk Ruang Ujian \u2192";
        return;
      }

      if (!examData.is_active) {
        this.showAlert(`Ujian "${examData.title}" saat ini berstatus DITUTUP oleh guru.`, "error");
        btnSubmit.disabled = false;
        btnSubmit.innerText = "Masuk Ruang Ujian \u2192";
        return;
      }

      // 2. Ambil data siswa
      const { data: studentData, error: studentError } = await client
        .from('students')
        .select(`
          id,
          student_number,
          full_name,
          class_id,
          is_active,
          classes ( class_name )
        `)
        .eq('student_number', studentNumber)
        .maybeSingle();

      if (studentError) throw studentError;

      if (!studentData) {
        this.showAlert(`Nomor siswa "${studentNumber}" tidak terdaftar di sistem.`, "error");
        btnSubmit.disabled = false;
        btnSubmit.innerText = "Masuk Ruang Ujian \u2192";
        return;
      }

      if (!studentData.is_active) {
        this.showAlert(`Akun siswa "${studentData.full_name}" dinonaktifkan. Hubungi pengawas.`, "error");
        btnSubmit.disabled = false;
        btnSubmit.innerText = "Masuk Ruang Ujian \u2192";
        return;
      }

      // 3. Validasi kesesuaian rombel/kelas
      if (examData.class_id && studentData.class_id !== examData.class_id) {
        const targetClass = examData.classes ? examData.classes.class_name : 'Rombel Lain';
        const myClass = studentData.classes ? studentData.classes.class_name : 'Tanpa Kelas';
        this.showAlert(`Sesi ujian ini khusus untuk rombel ${targetClass}. Anda terdaftar di ${myClass}.`, "error");
        btnSubmit.disabled = false;
        btnSubmit.innerText = "Masuk Ruang Ujian \u2192";
        return;
      }

      // 4. Simpan ke sessionStorage lengkap dengan konfigurasi proteksi ujian
      const sessionPayload = {
        student: {
          id: studentData.id,
          student_number: studentData.student_number,
          full_name: studentData.full_name,
          class_name: studentData.classes ? studentData.classes.class_name : '-'
        },
        exam: {
          id: examData.id,
          title: examData.title,
          subject: examData.subject,
          duration_minutes: examData.duration_minutes,
          token: examData.token,
          randomize_questions: examData.randomize_questions,
          randomize_options: examData.randomize_options,
          anti_cheat: examData.anti_cheat !== false,
          max_violations: examData.max_violations || 3
        },
        login_timestamp: new Date().toISOString()
      };

      sessionStorage.setItem("exam_session_data", JSON.stringify(sessionPayload));

      this.showAlert(`Identitas terverifikasi: ${studentData.full_name}. Mengalihkan...`, "success");

      setTimeout(() => {
        window.location.href = "konfirmasi.html";
      }, 600);

    } catch (err) {
      console.error("Gagal verifikasi siswa:", err);
      this.showAlert(`Kendala sistem: ${err.message}`, "error");
      btnSubmit.disabled = false;
      btnSubmit.innerText = "Masuk Ruang Ujian \u2192";
    }
  },

  showAlert(message, type = "error") {
    const alertEl = document.getElementById("student-login-alert");
    if (!alertEl) return;

    alertEl.className = type === "success" ? "alert alert-success" : "alert alert-error";
    alertEl.innerText = message;
    alertEl.classList.remove("d-none");
  },

  getActiveSession() {
    const raw = sessionStorage.getItem("exam_session_data");
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  clearSession() {
    sessionStorage.removeItem("exam_session_data");
    window.location.href = "index.html";
  }
};
