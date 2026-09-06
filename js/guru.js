// ==========================================================================
// MODUL PENGELOLAAN DASHBOARD GURU & NAVIGASI
// ==========================================================================

const GuruModule = {
  currentTeacher: null,

  // Inisialisasi tampilan utama dashboard setelah guru terautentikasi
  async initDashboard(teacherProfile) {
    this.currentTeacher = teacherProfile;

    // Sembunyikan form login, tampilkan area panel dashboard
    const authSection = document.getElementById("auth-section");
    const dashboardSection = document.getElementById("dashboard-section");
    if (authSection) authSection.classList.add("d-none");
    if (dashboardSection) dashboardSection.classList.remove("d-none");

    // Tampilkan nama guru di topbar
    const nameDisplay = document.getElementById("teacher-name-display");
    if (nameDisplay) {
      nameDisplay.innerText = teacherProfile.full_name || teacherProfile.email;
    }

    // Pasang event listener navigasi menu tab
    this.setupNavigation();

    // Muat ringkasan statistik
    await this.loadQuickStats();
  },

  // Mengatur pergantian tab menu secara instan tanpa reload halaman
  setupNavigation() {
    const navLinks = document.querySelectorAll(".sidebar-menu .nav-link");
    const panels = document.querySelectorAll(".menu-panel");
    const pageTitle = document.getElementById("current-menu-title");

    navLinks.forEach(link => {
      link.addEventListener("click", (e) => {
        e.preventDefault();

        // Lepas status aktif pada menu sebelumnya
        navLinks.forEach(l => l.classList.remove("active"));
        panels.forEach(p => p.classList.add("d-none"));

        // Aktifkan menu dan panel target
        link.classList.add("active");
        const targetId = link.getAttribute("data-target");
        const activePanel = document.getElementById(targetId);
        if (activePanel) {
          activePanel.classList.remove("d-none");
        }

        // Perbarui judul halaman di topbar
        if (pageTitle) {
          pageTitle.innerText = link.innerText;
        }
      });
    });
  },

  // Mengambil ringkasan statistik (jumlah kelas, siswa, ujian) dari Supabase
  async loadQuickStats() {
    const client = getSupabaseClient();
    if (!client || !this.currentTeacher) return;

    try {
      // 1. Hitung total kelas milik guru ini
      const { count: classCount } = await client
        .from('classes')
        .select('*', { count: 'exact', head: true })
        .eq('teacher_id', this.currentTeacher.id);

      // 2. Hitung total ujian milik guru ini
      const { count: examCount } = await client
        .from('exams')
        .select('*', { count: 'exact', head: true })
        .eq('teacher_id', this.currentTeacher.id);

      // Tampilkan ke elemen DOM
      const statClassesEl = document.getElementById("stat-classes");
      const statExamsEl = document.getElementById("stat-exams");

      if (statClassesEl) statClassesEl.innerText = classCount || 0;
      if (statExamsEl) statExamsEl.innerText = examCount || 0;
    } catch (err) {
      console.warn("Gagal memuat statistik awal:", err);
    }
  }
};
