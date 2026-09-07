// ==========================================================================
// MODUL PENGELOLAAN DASHBOARD GURU, SISWA, KELAS, & UJIAN
// ==========================================================================

const GuruModule = {
  currentTeacher: null,
  classesList: [],

  // Inisialisasi tampilan utama dashboard
  async initDashboard(teacherProfile) {
    this.currentTeacher = teacherProfile;

    const authSection = document.getElementById("auth-section");
    const dashboardSection = document.getElementById("dashboard-section");
    if (authSection) authSection.classList.add("d-none");
    if (dashboardSection) dashboardSection.classList.remove("d-none");

    const nameDisplay = document.getElementById("teacher-name-display");
    if (nameDisplay) {
      nameDisplay.innerText = teacherProfile.full_name || teacherProfile.email;
    }

    this.setupNavigation();
    await this.ensureDefaultClass();
    await this.loadClassesDropdown();
    await this.loadStudentsTable();
    await this.loadClassesTable();
    await this.loadExamsTable();
    await this.loadQuickStats();
    this.setupStudentEventListeners();
    this.setupClassEventListeners();
    this.setupExamEventListeners();
  },

  // Setup tab switcher menu navigasi
  setupNavigation() {
    const navLinks = document.querySelectorAll(".sidebar-menu .nav-link");
    const panels = document.querySelectorAll(".menu-panel");
    const pageTitle = document.getElementById("current-menu-title");

    navLinks.forEach(link => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        navLinks.forEach(l => l.classList.remove("active"));
        panels.forEach(p => p.classList.add("d-none"));

        link.classList.add("active");
        const targetId = link.getAttribute("data-target");
        const activePanel = document.getElementById(targetId);
        if (activePanel) {
          activePanel.classList.remove("d-none");
        }

        if (pageTitle) {
          pageTitle.innerText = link.innerText;
        }

        // Segarkan data spesifik saat tab diklik
        if (targetId === "panel-siswa") {
          this.loadStudentsTable();
        } else if (targetId === "panel-kelas") {
          this.loadClassesTable();
        } else if (targetId === "panel-ujian") {
          this.loadExamsTable();
        }
      });
    });
  },

  // Memastikan guru memiliki minimal 1 kelas agar relasi siswa tidak error
  async ensureDefaultClass() {
    const client = getSupabaseClient();
    if (!client || !this.currentTeacher) return;

    try {
      const { data: existingClasses, error } = await client
        .from('classes')
        .select('*')
        .eq('teacher_id', this.currentTeacher.id);

      if (error) throw error;

      if (!existingClasses || existingClasses.length === 0) {
        await client.from('classes').insert({
          teacher_id: this.currentTeacher.id,
          class_name: 'VII A'
        });
      }
    } catch (err) {
      console.warn("Gagal inisialisasi kelas awal:", err);
    }
  },

  // Mengambil daftar kelas untuk dropdown pilihan
  async loadClassesDropdown() {
    const client = getSupabaseClient();
    if (!client || !this.currentTeacher) return;

    try {
      const { data, error } = await client
        .from('classes')
        .select('*')
        .eq('teacher_id', this.currentTeacher.id)
        .order('class_name', { ascending: true });

      if (error) throw error;
      this.classesList = data || [];

      const selectStudentAdd = document.getElementById("student-class-id");
      const selectStudentEdit = document.getElementById("edit-student-class-id");
      const selectExamClass = document.getElementById("exam-class-id");

      let optionsHtml = '<option value="">-- Pilih Kelas --</option>';
      this.classesList.forEach(c => {
        optionsHtml += `<option value="${c.id}">${c.class_name}</option>`;
      });

      if (selectStudentAdd) selectStudentAdd.innerHTML = optionsHtml;
      if (selectStudentEdit) selectStudentEdit.innerHTML = optionsHtml;
      if (selectExamClass) selectExamClass.innerHTML = optionsHtml;
    } catch (err) {
      console.error("Gagal membaca daftar kelas:", err);
    }
  },

  // ==========================================
  // MANAJEMEN SISWA (CHECKPOINT 13)
  // ==========================================

  async loadStudentsTable() {
    const client = getSupabaseClient();
    const tableBody = document.getElementById("students-table-body");
    if (!client || !this.currentTeacher || !tableBody) return;

    tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Memuat data siswa...</td></tr>';

    try {
      const { data: students, error } = await client
        .from('students')
        .select(`
          id,
          student_number,
          full_name,
          is_active,
          class_id,
          classes ( class_name )
        `)
        .order('student_number', { ascending: true });

      if (error) throw error;

      if (!students || students.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Belum ada siswa yang ditambahkan.</td></tr>';
        return;
      }

      let rowsHtml = '';
      students.forEach((s, idx) => {
        const className = s.classes ? s.classes.class_name : '-';
        const badgeStatus = s.is_active 
          ? '<span class="badge badge-success">Aktif</span>' 
          : '<span class="badge badge-danger">Nonaktif</span>';

        const toggleText = s.is_active ? 'Nonaktifkan' : 'Aktifkan';
        const toggleBtnClass = s.is_active ? 'btn-warning' : 'btn-secondary';

        rowsHtml += `
          <tr>
            <td>${idx + 1}</td>
            <td><strong>${className}</strong></td>
            <td>${s.student_number}</td>
            <td>${s.full_name}</td>
            <td>${badgeStatus}</td>
            <td>
              <div class="action-buttons">
                <button class="btn btn-secondary btn-sm" onclick="GuruModule.openEditStudent('${s.id}', '${s.class_id}', '${s.full_name}', '${s.student_number}')">Edit</button>
                <button class="btn ${toggleBtnClass} btn-sm" onclick="GuruModule.toggleStudentStatus('${s.id}', ${s.is_active})">${toggleText}</button>
                <button class="btn btn-danger btn-sm" onclick="GuruModule.deleteStudent('${s.id}', '${s.full_name}')">Hapus</button>
              </div>
            </td>
          </tr>
        `;
      });

      tableBody.innerHTML = rowsHtml;
      await this.loadQuickStats();
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="6" class="text-center" style="color: var(--danger-color);">Gagal memuat: ${err.message}</td></tr>`;
    }
  },

  setupStudentEventListeners() {
    const formAdd = document.getElementById("form-add-student");
    const formAlert = document.getElementById("student-form-alert");

    if (formAdd) {
      formAdd.addEventListener("submit", async (e) => {
        e.preventDefault();
        formAlert.classList.add("d-none");

        const classId = document.getElementById("student-class-id").value;
        const fullName = document.getElementById("student-full-name").value.trim();
        const studentNumber = document.getElementById("student-number").value.trim();
        const btnSave = document.getElementById("btn-save-student");

        if (!classId) {
          alert("Silakan pilih kelas terlebih dahulu.");
          return;
        }

        btnSave.disabled = true;
        btnSave.innerText = "Menyimpan...";

        const client = getSupabaseClient();
        try {
          const { error } = await client.from('students').insert({
            class_id: classId,
            full_name: fullName,
            student_number: studentNumber,
            is_active: true
          });

          if (error) throw error;

          formAdd.reset();
          formAlert.className = "alert alert-success";
          formAlert.innerText = `Siswa "${fullName}" berhasil ditambahkan!`;
          formAlert.classList.remove("d-none");

          await this.loadStudentsTable();
        } catch (err) {
          formAlert.className = "alert alert-error";
          formAlert.innerText = `Gagal menyimpan: ${err.message}`;
          formAlert.classList.remove("d-none");
        } finally {
          btnSave.disabled = false;
          btnSave.innerText = "+ Tambah";
        }
      });
    }

    const modalEdit = document.getElementById("modal-edit-student");
    const formEdit = document.getElementById("form-edit-student");
    const btnCloseModal = document.getElementById("btn-close-modal-edit");
    const btnCancelModal = document.getElementById("btn-cancel-edit-student");

    const closeModal = () => modalEdit.classList.add("d-none");
    if (btnCloseModal) btnCloseModal.addEventListener("click", closeModal);
    if (btnCancelModal) btnCancelModal.addEventListener("click", closeModal);

    if (formEdit) {
      formEdit.addEventListener("submit", async (e) => {
        e.preventDefault();
        const studentId = document.getElementById("edit-student-id").value;
        const classId = document.getElementById("edit-student-class-id").value;
        const fullName = document.getElementById("edit-student-full-name").value.trim();
        const studentNumber = document.getElementById("edit-student-number").value.trim();
        const btnUpdate = document.getElementById("btn-update-student");

        btnUpdate.disabled = true;
        btnUpdate.innerText = "Memperbarui...";

        const client = getSupabaseClient();
        try {
          const { error } = await client.from('students')
            .update({
              class_id: classId,
              full_name: fullName,
              student_number: studentNumber
            })
            .eq('id', studentId);

          if (error) throw error;

          closeModal();
          await this.loadStudentsTable();
        } catch (err) {
          alert(`Gagal memperbarui siswa: ${err.message}`);
        } finally {
          btnUpdate.disabled = false;
          btnUpdate.innerText = "Simpan Perubahan";
        }
      });
    }

    const btnRefresh = document.getElementById("btn-refresh-students");
    if (btnRefresh) {
      btnRefresh.addEventListener("click", () => this.loadStudentsTable());
    }
  },

  openEditStudent(id, classId, fullName, studentNumber) {
    document.getElementById("edit-student-id").value = id;
    document.getElementById("edit-student-class-id").value = classId;
    document.getElementById("edit-student-full-name").value = fullName;
    document.getElementById("edit-student-number").value = studentNumber;
    document.getElementById("modal-edit-student").classList.remove("d-none");
  },

  async toggleStudentStatus(studentId, currentStatus) {
    const aksi = currentStatus ? "menonaktifkan" : "mengaktifkan";
    const yakin = confirm(`Apakah Anda yakin ingin ${aksi} siswa ini?`);
    if (!yakin) return;

    const client = getSupabaseClient();
    try {
      const { error } = await client
        .from('students')
        .update({ is_active: !currentStatus })
        .eq('id', studentId);

      if (error) throw error;
      await this.loadStudentsTable();
    } catch (err) {
      alert(`Gagal mengubah status: ${err.message}`);
    }
  },

  async deleteStudent(studentId, fullName) {
    const yakin = confirm(`Apakah Anda yakin ingin menghapus data siswa "${fullName}"? Tindakan ini tidak dapat dibatalkan.`);
    if (!yakin) return;

    const client = getSupabaseClient();
    try {
      const { error } = await client
        .from('students')
        .delete()
        .eq('id', studentId);

      if (error) throw error;
      await this.loadStudentsTable();
    } catch (err) {
      alert(`Gagal menghapus siswa: ${err.message}`);
    }
  },

  // ==========================================
  // MANAJEMEN KELAS (CHECKPOINT 14)
  // ==========================================

  async loadClassesTable() {
    const client = getSupabaseClient();
    const tableBody = document.getElementById("classes-table-body");
    if (!client || !this.currentTeacher || !tableBody) return;

    tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Memuat data kelas...</td></tr>';

    try {
      const { data: classes, error: classErr } = await client
        .from('classes')
        .select('*')
        .eq('teacher_id', this.currentTeacher.id)
        .order('class_name', { ascending: true });

      if (classErr) throw classErr;

      if (!classes || classes.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Belum ada kelas yang dibuat.</td></tr>';
        return;
      }

      const rowsPromises = classes.map(async (cls, idx) => {
        const { count: studentCount } = await client
          .from('students')
          .select('*', { count: 'exact', head: true })
          .eq('class_id', cls.id);

        const dateStr = cls.created_at ? new Date(cls.created_at).toLocaleDateString('id-ID') : '-';

        return `
          <tr>
            <td>${idx + 1}</td>
            <td><strong>${cls.class_name}</strong></td>
            <td>${studentCount || 0} Siswa</td>
            <td>${dateStr}</td>
            <td>
              <div class="action-buttons">
                <button class="btn btn-secondary btn-sm" onclick="GuruModule.openEditClass('${cls.id}', '${cls.class_name}')">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="GuruModule.deleteClass('${cls.id}', '${cls.class_name}', ${studentCount || 0})">Hapus</button>
              </div>
            </td>
          </tr>
        `;
      });

      const rowsArray = await Promise.all(rowsPromises);
      tableBody.innerHTML = rowsArray.join('');
      await this.loadQuickStats();
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="5" class="text-center" style="color: var(--danger-color);">Gagal memuat: ${err.message}</td></tr>`;
    }
  },

  setupClassEventListeners() {
    const formAdd = document.getElementById("form-add-class");
    const formAlert = document.getElementById("class-form-alert");

    if (formAdd) {
      formAdd.addEventListener("submit", async (e) => {
        e.preventDefault();
        formAlert.classList.add("d-none");

        const className = document.getElementById("new-class-name").value.trim();
        const btnSave = document.getElementById("btn-save-class");

        if (!className) return;

        btnSave.disabled = true;
        btnSave.innerText = "Menyimpan...";

        const client = getSupabaseClient();
        try {
          const { error } = await client.from('classes').insert({
            teacher_id: this.currentTeacher.id,
            class_name: className
          });

          if (error) throw error;

          formAdd.reset();
          formAlert.className = "alert alert-success";
          formAlert.innerText = `Kelas "${className}" berhasil ditambahkan!`;
          formAlert.classList.remove("d-none");

          await this.loadClassesTable();
          await this.loadClassesDropdown();
        } catch (err) {
          formAlert.className = "alert alert-error";
          formAlert.innerText = `Gagal menyimpan: ${err.message}`;
          formAlert.classList.remove("d-none");
        } finally {
          btnSave.disabled = false;
          btnSave.innerText = "+ Tambah Kelas";
        }
      });
    }

    const modalEditClass = document.getElementById("modal-edit-class");
    const formEditClass = document.getElementById("form-edit-class");
    const btnCloseModal = document.getElementById("btn-close-modal-edit-class");
    const btnCancelModal = document.getElementById("btn-cancel-edit-class");

    const closeModal = () => modalEditClass.classList.add("d-none");
    if (btnCloseModal) btnCloseModal.addEventListener("click", closeModal);
    if (btnCancelModal) btnCancelModal.addEventListener("click", closeModal);

    if (formEditClass) {
      formEditClass.addEventListener("submit", async (e) => {
        e.preventDefault();
        const classId = document.getElementById("edit-class-id").value;
        const className = document.getElementById("edit-class-name").value.trim();
        const btnUpdate = document.getElementById("btn-update-class");

        btnUpdate.disabled = true;
        btnUpdate.innerText = "Memperbarui...";

        const client = getSupabaseClient();
        try {
          const { error } = await client.from('classes')
            .update({ class_name: className })
            .eq('id', classId);

          if (error) throw error;

          closeModal();
          await this.loadClassesTable();
          await this.loadClassesDropdown();
        } catch (err) {
          alert(`Gagal memperbarui kelas: ${err.message}`);
        } finally {
          btnUpdate.disabled = false;
          btnUpdate.innerText = "Simpan Perubahan";
        }
      });
    }

    const btnRefresh = document.getElementById("btn-refresh-classes");
    if (btnRefresh) {
      btnRefresh.addEventListener("click", () => this.loadClassesTable());
    }
  },

  openEditClass(id, className) {
    document.getElementById("edit-class-id").value = id;
    document.getElementById("edit-class-name").value = className;
    document.getElementById("modal-edit-class").classList.remove("d-none");
  },

  async deleteClass(classId, className, studentCount) {
    let confirmMsg = `Apakah Anda yakin ingin menghapus kelas "${className}"?`;
    if (studentCount > 0) {
      confirmMsg = `PERINGATAN: Kelas "${className}" memiliki ${studentCount} siswa di dalamnya!\n\nJika kelas ini dihapus, data siswa di dalamnya juga akan terhapus.\n\nApakah Anda benar-benar yakin ingin melanjutkan?`;
    }

    const yakin = confirm(confirmMsg);
    if (!yakin) return;

    const client = getSupabaseClient();
    try {
      const { error } = await client
        .from('classes')
        .delete()
        .eq('id', classId);

      if (error) throw error;

      await this.loadClassesTable();
      await this.loadClassesDropdown();
      await this.loadStudentsTable();
    } catch (err) {
      alert(`Gagal menghapus kelas: ${err.message}`);
    }
  },

  // ==========================================
  // MANAJEMEN UJIAN (CHECKPOINT 15)
  // ==========================================

  // Generator Token Acak 6 Karakter (Tanpa karakter ambigu O/0/I/1)
  generateExamToken() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let token = "";
    for (let i = 0; i < 6; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  },

  // Menampilkan tabel daftar ujian
  async loadExamsTable() {
    const client = getSupabaseClient();
    const tableBody = document.getElementById("exams-table-body");
    if (!client || !this.currentTeacher || !tableBody) return;

    tableBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">Memuat daftar ujian...</td></tr>';

    try {
      const { data: exams, error } = await client
        .from('exams')
        .select(`
          id,
          title,
          token,
          duration_minutes,
          randomize_questions,
          randomize_options,
          is_active,
          class_id,
          classes ( class_name )
        `)
        .eq('teacher_id', this.currentTeacher.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (!exams || exams.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">Belum ada sesi ujian yang dibuat. Silakan klik "+ Buat Ujian Baru".</td></tr>';
        return;
      }

      let rowsHtml = '';
      exams.forEach((ex, idx) => {
        const className = ex.classes ? ex.classes.class_name : 'Semua Kelas';
        const badgeStatus = ex.is_active 
          ? '<span class="badge badge-success">Aktif</span>' 
          : '<span class="badge badge-danger">Tutup</span>';
        
        const toggleText = ex.is_active ? 'Tutup' : 'Buka';
        const toggleBtnClass = ex.is_active ? 'btn-warning' : 'btn-secondary';

        const acakInfo = [
          ex.randomize_questions ? 'Soal' : '',
          ex.randomize_options ? 'Opsi' : ''
        ].filter(Boolean).join(' & ') || 'Urut';

        rowsHtml += `
          <tr>
            <td>${idx + 1}</td>
            <td><strong>${ex.title}</strong></td>
            <td>${className}</td>
            <td>
              <span style="font-family: monospace; font-size: 1.1rem; font-weight: bold; color: var(--primary-color); background: #e0e7ff; padding: 2px 6px; border-radius: 4px;">
                ${ex.token}
              </span>
              <button class="btn btn-secondary btn-sm" style="margin-left: 5px; padding: 2px 6px;" title="Salin Token" onclick="GuruModule.copyTokenToClipboard('${ex.token}')">📋</button>
            </td>
            <td>${ex.duration_minutes} mnt</td>
            <td><small>${acakInfo}</small></td>
            <td>${badgeStatus}</td>
            <td>
              <div class="action-buttons">
                <button class="btn ${toggleBtnClass} btn-sm" onclick="GuruModule.toggleExamStatus('${ex.id}', ${ex.is_active})">${toggleText}</button>
                <button class="btn btn-danger btn-sm" onclick="GuruModule.deleteExam('${ex.id}', '${ex.title}')">Hapus</button>
              </div>
            </td>
          </tr>
        `;
      });

      tableBody.innerHTML = rowsHtml;
      await this.loadQuickStats();
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="8" class="text-center" style="color: var(--danger-color);">Gagal memuat ujian: ${err.message}</td></tr>`;
    }
  },

  // Setup Event Listeners Modal Pembuatan Ujian (dengan Tombol Darurat & ESC)
  setupExamEventListeners() {
    const modalExam = document.getElementById("modal-create-exam");
    const btnOpenModal = document.getElementById("btn-open-modal-exam");
    const btnCloseModal = document.getElementById("btn-close-modal-exam");
    const btnCancelModal = document.getElementById("btn-cancel-create-exam");
    const btnGenToken = document.getElementById("btn-generate-token");
    const tokenInput = document.getElementById("exam-token");
    const formCreateExam = document.getElementById("form-create-exam");
    const formAlert = document.getElementById("exam-form-alert");
    const btnSave = document.getElementById("btn-save-exam");

    const openModal = () => {
      if (formCreateExam) formCreateExam.reset();
      if (formAlert) formAlert.classList.add("d-none");
      if (btnSave) {
        btnSave.disabled = false;
        btnSave.innerText = "Simpan & Terbitkan Ujian";
      }
      if (tokenInput) tokenInput.value = this.generateExamToken();
      if (modalExam) modalExam.classList.remove("d-none");
    };

    const closeModal = () => {
      if (modalExam) modalExam.classList.add("d-none");
      if (btnSave) {
        btnSave.disabled = false;
        btnSave.innerText = "Simpan & Terbitkan Ujian";
      }
    };

    if (btnOpenModal) btnOpenModal.addEventListener("click", openModal);
    if (btnCloseModal) btnCloseModal.addEventListener("click", closeModal);
    if (btnCancelModal) btnCancelModal.addEventListener("click", closeModal);

    // Tombol Darurat 1: Klik di area abu-abu luar kotak untuk menutup modal
    if (modalExam) {
      modalExam.addEventListener("click", (e) => {
        if (e.target === modalExam) {
          closeModal();
        }
      });
    }

    // Tombol Darurat 2: Tekan tombol ESC keyboard untuk menutup modal
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modalExam && !modalExam.classList.contains("d-none")) {
        closeModal();
      }
    });

    if (btnGenToken && tokenInput) {
      btnGenToken.addEventListener("click", () => {
        tokenInput.value = this.generateExamToken();
      });
    }

    if (formCreateExam) {
      formCreateExam.addEventListener("submit", async (e) => {
        e.preventDefault();
        formAlert.classList.add("d-none");

        const title = document.getElementById("exam-title").value.trim();
        const description = document.getElementById("exam-description").value.trim();
        const classId = document.getElementById("exam-class-id").value;
        const duration = parseInt(document.getElementById("exam-duration").value, 10);
        const token = tokenInput.value.trim().toUpperCase();
        const randomizeQuestions = document.getElementById("exam-randomize-questions").checked;
        const randomizeOptions = document.getElementById("exam-randomize-options").checked;

        if (!classId) {
          alert("Silakan pilih kelas target ujian.");
          return;
        }

        btnSave.disabled = true;
        btnSave.innerText = "Menerbitkan Ujian...";

        const client = getSupabaseClient();
        try {
          const { error } = await client.from('exams').insert({
            teacher_id: this.currentTeacher.id,
            class_id: classId,
            title: title,
            description: description,
            duration_minutes: duration,
            token: token,
            randomize_questions: randomizeQuestions,
            randomize_options: randomizeOptions,
            is_active: true
          });

          if (error) throw error;

          closeModal();
          await this.loadExamsTable();
        } catch (err) {
          formAlert.className = "alert alert-error";
          formAlert.innerText = `Gagal menyimpan: ${err.message}`;
          formAlert.classList.remove("d-none");
          btnSave.disabled = false;
          btnSave.innerText = "Coba Simpan Lagi";
        }
      });
    }
  },

  // Salin token ke clipboard browser
  copyTokenToClipboard(token) {
    navigator.clipboard.writeText(token).then(() => {
      alert(`Token ujian "${token}" berhasil disalin ke clipboard!`);
    }).catch(() => {
      alert(`Gagal menyalin. Token: ${token}`);
    });
  },

  // Toggle buka / tutup akses ujian dengan konfirmasi
  async toggleExamStatus(examId, currentStatus) {
    const aksi = currentStatus ? "menutup akses" : "membuka kembali";
    const yakin = confirm(`Apakah Anda yakin ingin ${aksi} sesi ujian ini?`);
    if (!yakin) return;

    const client = getSupabaseClient();
    try {
      const { error } = await client
        .from('exams')
        .update({ is_active: !currentStatus })
        .eq('id', examId);

      if (error) throw error;
      await this.loadExamsTable();
    } catch (err) {
      alert(`Gagal mengubah status ujian: ${err.message}`);
    }
  },

  // Hapus ujian dengan konfirmasi
  async deleteExam(examId, examTitle) {
    const yakin = confirm(`Apakah Anda yakin ingin menghapus ujian "${examTitle}"? Seluruh butir soal dan jawaban siswa di ujian ini akan terhapus.`);
    if (!yakin) return;

    const client = getSupabaseClient();
    try {
      const { error } = await client
        .from('exams')
        .delete()
        .eq('id', examId);

      if (error) throw error;
      await this.loadExamsTable();
    } catch (err) {
      alert(`Gagal menghapus ujian: ${err.message}`);
    }
  },

  // Ambil ringkasan statistik
  async loadQuickStats() {
    const client = getSupabaseClient();
    if (!client || !this.currentTeacher) return;

    try {
      const { count: classCount } = await client
        .from('classes')
        .select('*', { count: 'exact', head: true })
        .eq('teacher_id', this.currentTeacher.id);

      const { count: studentCount } = await client
        .from('students')
        .select('*', { count: 'exact', head: true });

      const { count: examCount } = await client
        .from('exams')
        .select('*', { count: 'exact', head: true })
        .eq('teacher_id', this.currentTeacher.id);

      const statClassesEl = document.getElementById("stat-classes");
      const statStudentsEl = document.getElementById("stat-students");
      const statExamsEl = document.getElementById("stat-exams");

      if (statClassesEl) statClassesEl.innerText = classCount || 0;
      if (statStudentsEl) statStudentsEl.innerText = studentCount || 0;
      if (statExamsEl) statExamsEl.innerText = examCount || 0;
    } catch (err) {
      console.warn("Gagal memuat statistik awal:", err);
    }
  }
};
