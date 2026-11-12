// ==========================================================================
// MODUL OTENTIKASI SISWA: LOGIN NOMOR ABSEN & FIX PARAMETER PENGACAKAN
// ==========================================================================

// ==========================================================================
// PENYIMPANAN SESI: sessionStorage + localStorage (cadangan)
// sessionStorage hilang bila halaman berikutnya dibuka di tab/konteks baru
// (umum pada browser dalam aplikasi WhatsApp/Classroom, WebView, mode tamu
// Chromebook). localStorage dipakai sebagai cadangan agar sesi tetap terbawa.
// ==========================================================================
const SessionStore = {
  set(key, value) {
    const json = JSON.stringify(value);
    let ok = false;
    try { sessionStorage.setItem(key, json); ok = true; } catch (e) {}
    try { localStorage.setItem(key, json); ok = true; } catch (e) {}
    return ok;
  },
  get(key) {
    let raw = null;
    try { raw = sessionStorage.getItem(key); } catch (e) {}
    if (!raw) { try { raw = localStorage.getItem(key); } catch (e) {} }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },
  remove(key) {
    try { sessionStorage.removeItem(key); } catch (e) {}
    try { localStorage.removeItem(key); } catch (e) {}
  }
};

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
    const absenInput = document.getElementById("student-attendance-num");
    const tokenInput = document.getElementById("exam-token-input");
    const btnSubmit = document.getElementById("btn-submit-student-login");
    const alertEl = document.getElementById("student-login-alert");

    const attendanceNumber = parseInt(absenInput.value, 10);
    const token = tokenInput.value.trim().toUpperCase();

    if (!attendanceNumber || attendanceNumber <= 0) {
      this.showAlert("Silakan masukkan nomor absen yang valid.", "error");
      return;
    }

    alertEl.classList.add("d-none");
    btnSubmit.disabled = true;
    btnSubmit.innerText = "Memverifikasi...";

    const client = getSupabaseClient();
    if (!client) {
      this.showAlert("Koneksi Supabase belum siap.", "error");
      btnSubmit.disabled = false;
      btnSubmit.innerText = "Masuk Ruang Ujian \u2192";
      return;
    }

    try {
      const fail = (msg) => {
        this.showAlert(msg, "error");
        btnSubmit.disabled = false;
        btnSubmit.innerText = "Masuk Ruang Ujian \u2192";
      };

      // 1. Ambil data sesi ujian berdasarkan Token (pencocokan persis; token disimpan huruf besar)
      const examSelect = 'id, title, subject, duration_minutes, token, is_active, class_id, randomize_questions, randomize_options, anti_cheat, max_violations, spreadsheet_url, classes(class_name)';

      let { data: examRows, error: examError } = await client
        .from('exams')
        .select(examSelect)
        .eq('token', token)
        .limit(5);

      if (examError) throw examError;

      if (!examRows || examRows.length === 0) {
        // Cadangan untuk token lama yang tersimpan huruf kecil/campuran.
        // Karakter \, % dan _ di-escape agar dibaca apa adanya, bukan wildcard.
        const literalToken = token.replace(/[\\%_]/g, '\\$&');
        const fallback = await client
          .from('exams')
          .select(examSelect)
          .ilike('token', literalToken)
          .limit(5);
        if (fallback.error) throw fallback.error;
        examRows = fallback.data || [];
      }

      let examData = null;
      if (examRows.length === 1) {
        examData = examRows[0];
      } else if (examRows.length > 1) {
        const activeExams = examRows.filter(e => e.is_active);
        if (activeExams.length === 1) {
          examData = activeExams[0];
        } else if (activeExams.length === 0) {
          examData = examRows[0]; // semuanya ditutup, tampilkan pesan "ditutup"
        } else {
          fail(`Token "${token}" dipakai oleh lebih dari satu ujian yang aktif. Hubungi guru pengawas.`);
          return;
        }
      }

      if (!examData) {
        this.showAlert(`Token "${token}" tidak ditemukan. Pastikan token sesuai.`, "error");
        btnSubmit.disabled = false;
        btnSubmit.innerText = "Masuk Ruang Ujian \u2192";
        return;
      }

      if (!examData.is_active) {
        this.showAlert(`Ujian "${examData.title}" saat ini DITUTUP oleh guru pengawas.`, "error");
        btnSubmit.disabled = false;
        btnSubmit.innerText = "Masuk Ruang Ujian \u2192";
        return;
      }

      // 2. Ambil data siswa berdasarkan Nomor Absen di kelas target ujian
      let studentQuery = client
        .from('students')
        .select('id, attendance_number, student_number, full_name, class_id, is_active, classes(class_name)')
        .eq('attendance_number', attendanceNumber);

      if (examData.class_id) {
        studentQuery = studentQuery.eq('class_id', examData.class_id);
      }

      const { data: studentRows, error: studentError } = await studentQuery.limit(5);

      if (studentError) throw studentError;

      if (studentRows && studentRows.length > 1) {
        fail(examData.class_id
          ? `Nomor absen ${attendanceNumber} terdaftar ganda di kelas ini. Hubungi guru pengawas.`
          : `Ujian ini belum diatur untuk kelas tertentu, sehingga nomor absen ${attendanceNumber} cocok dengan beberapa siswa. Hubungi guru pengawas.`);
        return;
      }

      const studentData = (studentRows && studentRows.length === 1) ? studentRows[0] : null;

      if (!studentData) {
        const className = examData.classes ? examData.classes.class_name : 'Kelas Terkait';
        this.showAlert(`Siswa dengan nomor absen ${attendanceNumber} tidak terdaftar di ${className}. Periksa kembali nomor absen Anda.`, "error");
        btnSubmit.disabled = false;
        btnSubmit.innerText = "Masuk Ruang Ujian \u2192";
        return;
      }

      if (!studentData.is_active) {
        this.showAlert(`Akun "${studentData.full_name}" dinonaktifkan. Hubungi pengawas.`, "error");
        btnSubmit.disabled = false;
        btnSubmit.innerText = "Masuk Ruang Ujian \u2192";
        return;
      }

      // 3. Pastikan boolean pengacakan dan anti-cheat dibaca akurat
      const isRandomQuestions = (examData.randomize_questions !== false && examData.randomize_questions !== "false");
      const isRandomOptions = (examData.randomize_options !== false && examData.randomize_options !== "false");
      const isAntiCheat = (examData.anti_cheat !== false && examData.anti_cheat !== "false");

      const sessionPayload = {
        student: {
          id: studentData.id,
          attendance_number: studentData.attendance_number,
          student_number: studentData.student_number || '-',
          full_name: studentData.full_name,
          class_name: studentData.classes ? studentData.classes.class_name : '-'
        },
        exam: {
          id: examData.id,
          title: examData.title,
          subject: examData.subject,
          duration_minutes: examData.duration_minutes,
          token: examData.token,
          randomize_questions: isRandomQuestions,
          randomize_options: isRandomOptions,
          anti_cheat: isAntiCheat,
          max_violations: examData.max_violations || 3,
          spreadsheet_url: examData.spreadsheet_url || null
        },
        login_timestamp: new Date().toISOString()
      };

      if (!SessionStore.set("exam_session_data", sessionPayload)) {
        this.showAlert("Browser Anda memblokir penyimpanan data (mungkin mode privat/tamu). Buka link ujian di Chrome/Safari biasa, bukan di dalam aplikasi lain.", "error");
        btnSubmit.disabled = false;
        btnSubmit.innerText = "Masuk Ruang Ujian \u2192";
        return;
      }

      this.showAlert(`Identitas Terverifikasi: [Absen ${studentData.attendance_number}] ${studentData.full_name}. Mengalihkan...`, "success");

      setTimeout(() => {
        window.location.href = "konfirmasi.html";
      }, 500);

    } catch (err) {
      this.showAlert(`Gagal verifikasi: ${err.message}`, "error");
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
    const session = SessionStore.get("exam_session_data");
    if (!session) return null;
    // Sesi kedaluwarsa setelah 6 jam (mencegah sisa sesi siswa lain di perangkat bersama)
    const age = Date.now() - new Date(session.login_timestamp).getTime();
    if (!isNaN(age) && age > 6 * 60 * 60 * 1000) {
      SessionStore.remove("exam_session_data");
      return null;
    }
    return session;
  },

  clearSession() {
    SessionStore.remove("exam_session_data");
    window.location.href = "index.html";
  }
};
