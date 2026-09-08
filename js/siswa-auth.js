// ==========================================================================
// MODUL OTENTIKASI & VALIDASI AKSES SISWA (CHECKPOINT 26)
// ==========================================================================

const StudentAuthModule = {
  init() {
    const form = document.getElementById("form-student-login");
    const tokenInput = document.getElementById("exam-token-input");

    if (tokenInput) {
      tokenInput.addEventListener("input", (e) => {
        e.target.value = e.target.value.toUpperCase();
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
      this.showAlert("Koneksi database Supabase belum siap. Periksa konfigurasi berkas js/supabase.js.", "error");
      btnSubmit.disabled = false;
      btnSubmit.innerText = "Masuk Ruang Ujian \u2192";
      return;
    }

    try {
      // 1. Verifikasi Token Ujian di tabel exams
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
          start_time,
          end_time,
          classes ( class_name )
        `)
        .eq('token', token)
        .maybeSingle();

      if (examError) throw examError;

      if (!examData) {
        this.showAlert("Token ujian tidak ditemukan. Pastikan token yang Anda masukkan sesuai.", "error");
        btnSubmit.disabled = false;
        btnSubmit.innerText = "Masuk Ruang Ujian \u2192";
        return;
      }

      if (!examData.is_active) {
        this.showAlert(`Sesi ujian "${examData.title}" saat ini berstatus Ditutup oleh guru.`, "error");
        btnSubmit.disabled = false;
        btnSubmit.innerText = "Masuk Ruang Ujian \u2192";
        return;
      }

      // 2. Verifikasi waktu ujian jika ditentukan
      const now = new Date();
      if (examData.start_time && new Date(examData.start_time) > now) {
        this.showAlert("Sesi ujian belum dibuka sesuai jadwal pengerjaan.", "error");
        btnSubmit.disabled = false;
        btnSubmit.innerText = "Masuk Ruang Ujian \u2192";
        return;
      }

      if (examData.end_time && new Date(examData.end_time) < now) {
        this.showAlert("Batas akhir pengerjaan sesi ujian ini telah berakhir.", "error");
        btnSubmit.disabled = false;
        btnSubmit.innerText = "Masuk Ruang Ujian \u2192";
        return;
      }

      // 3. Verifikasi Nomor Siswa (NISN) di tabel students
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
        this.showAlert(`Nomor siswa "${studentNumber}" tidak terdaftar di sistem. Hubungi guru pengawas.`, "error");
        btnSubmit.disabled = false;
        btnSubmit.innerText = "Masuk Ruang Ujian \u2192";
        return;
      }

      if (!studentData.is_active) {
        this.showAlert(`Akun siswa "${studentData.full_name}" berstatus nonaktif.`, "error");
        btnSubmit.disabled = false;
        btnSubmit.innerText = "Masuk Ruang Ujian \u2192";
        return;
      }

      // 4. Validasi Kelas: Pastikan rombel siswa cocok dengan kelas target ujian
      if (examData.class_id && studentData.class_id !== examData.class_id) {
        const examClassName = examData.classes ? examData.classes.class_name : 'Kelas Lain';
        const studentClassName = studentData.classes ? studentData.classes.class_name : 'Kelas Anda';
        this.showAlert(`Ujian ini ditujukan khusus untuk rombel ${examClassName}. Anda terdaftar di ${studentClassName}.`, "error");
        btnSubmit.disabled = false;
        btnSubmit.innerText = "Masuk Ruang Ujian \u2192";
        return;
      }

      // 5. Simpan sesi login ke sessionStorage
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
          randomize_options: examData.randomize_options
        },
        login_timestamp: new Date().toISOString()
      };

      sessionStorage.setItem("exam_session_data", JSON.stringify(sessionPayload));

      this.showAlert(`Data diverifikasi! Selamat datang, ${studentData.full_name}. Mengalihkan ke ruang tunggu...`, "success");

      setTimeout(() => {
        window.location.href = "konfirmasi.html";
      }, 900);

    } catch (err) {
      console.error("Gagal verifikasi login siswa:", err);
      this.showAlert(`Terjadi kesalahan sistem: ${err.message}`, "error");
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

  // Helper untuk mengambil data sesi aktif di halaman pengerjaan
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
