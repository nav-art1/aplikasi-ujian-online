// ==========================================================================
// MODUL PENGELOLAAN DASHBOARD GURU, SISWA, KELAS, UJIAN, STIMULUS, SOAL,
// PENOMORAN FLEKSIBEL, DUPLIKASI SOAL, GESER URUTAN (CHECKPOINT 23), KATEX, & STORAGE
// ==========================================================================

const GuruModule = {
  currentTeacher: null,
  classesList: [],
  examsList: [],
  selectedExamId: null,
  selectedExamTitle: '',
  targetStimulusId: null,
  targetStimulusTitle: '',

  renderMath(containerElement) {
    if (typeof renderMathInElement === 'function' && containerElement) {
      try {
        renderMathInElement(containerElement, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false }
          ],
          throwOnError: false
        });
      } catch (err) {
        console.warn("KaTeX render notice:", err);
      }
    }
  },

  async uploadImageFile(file, folder = 'questions') {
    if (!file) return null;

    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase client belum siap.");

    const fileExt = file.name.split('.').pop();
    const cleanExt = fileExt ? fileExt.toLowerCase() : 'jpg';
    const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${cleanExt}`;

    const { data, error } = await client.storage
      .from('exam-images')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      throw new Error(`Upload gambar gagal: ${error.message}`);
    }

    const { data: publicUrlData } = client.storage
      .from('exam-images')
      .getPublicUrl(data.path);

    return publicUrlData.publicUrl;
  },

  async getSuggestedQuestionNumber(examId, stimulusId = null) {
    if (!examId) return 1;
    const client = getSupabaseClient();

    try {
      if (stimulusId) {
        const { data: stimQuestions } = await client
          .from('questions')
          .select('original_number')
          .eq('exam_id', examId)
          .eq('stimulus_group_id', stimulusId)
          .order('original_number', { ascending: false })
          .limit(1);

        if (stimQuestions && stimQuestions.length > 0 && stimQuestions[0].original_number) {
          return stimQuestions[0].original_number + 1;
        }
      }

      const { data: maxQ } = await client
        .from('questions')
        .select('original_number')
        .eq('exam_id', examId)
        .order('original_number', { ascending: false })
        .limit(1);

      if (maxQ && maxQ.length > 0 && maxQ[0].original_number) {
        return maxQ[0].original_number + 1;
      }
      return 1;
    } catch (err) {
      console.warn("Gagal menghitung nomor usulan:", err);
      return 1;
    }
  },

  async shiftQuestionsUp(examId, targetNumber) {
    const client = getSupabaseClient();
    try {
      const { data: collidingQuestions, error } = await client
        .from('questions')
        .select('id, original_number')
        .eq('exam_id', examId)
        .gte('original_number', targetNumber)
        .order('original_number', { ascending: false });

      if (error) throw error;

      if (collidingQuestions && collidingQuestions.length > 0) {
        for (const q of collidingQuestions) {
          await client
            .from('questions')
            .update({ original_number: q.original_number + 1 })
            .eq('id', q.id);
        }
      }
    } catch (err) {
      console.warn("Gagal auto-shift soal:", err);
    }
  },

  async renumberAllQuestions(examId) {
    if (!examId) return;
    const yakin = confirm("Apakah Anda ingin merapikan nomor urut soal agar tidak ada nomor yang loncat, tanpa mengubah urutan posisi soal saat ini?");
    if (!yakin) return;

    const client = getSupabaseClient();
    try {
      const { data: allQuestions, error } = await client
        .from('questions')
        .select('id, original_number')
        .eq('exam_id', examId)
        .order('original_number', { ascending: true });

      if (error) throw error;

      if (!allQuestions || allQuestions.length === 0) {
        alert("Belum ada butir soal untuk dirapikan.");
        return;
      }

      for (let i = 0; i < allQuestions.length; i++) {
        const newNum = i + 1;
        if (allQuestions[i].original_number !== newNum) {
          await client
            .from('questions')
            .update({ original_number: newNum })
            .eq('id', allQuestions[i].id);
        }
      }

      alert(`Berhasil merapikan nomor urut (${allQuestions.length} butir soal kini berurutan 1 s.d. ${allQuestions.length})!`);
      await this.loadBankSoalContent(examId);
    } catch (err) {
      alert(`Gagal merapikan nomor soal: ${err.message}`);
    }
  },

  // ==========================================
  // FITUR DUPLIKASI & GESER URUTAN (CHECKPOINT 23)
  // ==========================================

  // Duplikasi butir soal beserta opsi jawabannya
  async duplicateQuestion(questionId, examId) {
    const yakin = confirm("Duplikasi butir soal ini?");
    if (!yakin) return;

    const client = getSupabaseClient();
    try {
      // 1. Ambil data lengkap soal yang ingin disalin
      const { data: sourceQ, error: qErr } = await client
        .from('questions')
        .select(`
          exam_id,
          stimulus_group_id,
          original_number,
          question_type,
          points,
          image_url,
          content,
          correct_keys,
          options (
            option_label,
            content,
            is_correct
          )
        `)
        .eq('id', questionId)
        .single();

      if (qErr) throw qErr;

      const newNumber = (sourceQ.original_number || 1) + 1;

      // 2. Geser soal-soal setelahnya ke atas
      await this.shiftQuestionsUp(examId, newNumber);

      // 3. Masukkan salinan soal baru
      const { data: newQ, error: insertQErr } = await client
        .from('questions')
        .insert({
          exam_id: sourceQ.exam_id,
          stimulus_group_id: sourceQ.stimulus_group_id,
          original_number: newNumber,
          question_type: sourceQ.question_type,
          points: sourceQ.points,
          image_url: sourceQ.image_url,
          content: `${sourceQ.content} (Salinan)`,
          correct_keys: sourceQ.correct_keys,
          group_id: null
        })
        .select()
        .single();

      if (insertQErr) throw insertQErr;

      // 4. Salin semua opsi jawabannya
      if (sourceQ.options && sourceQ.options.length > 0) {
        const optionsPayload = sourceQ.options.map(opt => ({
          question_id: newQ.id,
          option_label: opt.option_label,
          content: opt.content,
          is_correct: opt.is_correct
        }));

        const { error: optErr } = await client.from('options').insert(optionsPayload);
        if (optErr) throw optErr;
      }

      await this.loadBankSoalContent(examId);
    } catch (err) {
      alert(`Gagal menduplikasi soal: ${err.message}`);
    }
  },

  // Geser posisi soal (direction: -1 untuk Naik / +1 untuk Turun)
  async moveQuestionOrder(questionId, examId, currentNumber, direction) {
    const client = getSupabaseClient();
    try {
      // Ambil seluruh daftar soal terurut
      const { data: allQ, error } = await client
        .from('questions')
        .select('id, original_number')
        .eq('exam_id', examId)
        .order('original_number', { ascending: true });

      if (error) throw error;
      if (!allQ || allQ.length < 2) return;

      const currentIndex = allQ.findIndex(q => q.id === questionId);
      if (currentIndex === -1) return;

      const targetIndex = currentIndex + direction;
      if (targetIndex < 0 || targetIndex >= allQ.length) return; // Sudah di ujung atas/bawah

      const targetQ = allQ[targetIndex];

      // Tukar nomor asli antara kedua soal
      // Gunakan nomor sementara negatif agar tidak bentrok
      await client.from('questions').update({ original_number: -9999 }).eq('id', questionId);
      await client.from('questions').update({ original_number: currentNumber }).eq('id', targetQ.id);
      await client.from('questions').update({ original_number: targetQ.original_number }).eq('id', questionId);

      await this.loadBankSoalContent(examId);
    } catch (err) {
      alert(`Gagal memindahkan urutan soal: ${err.message}`);
    }
  },

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
    await this.loadBankSoalExamFilter();

    this.setupStudentEventListeners();
    this.setupClassEventListeners();
    this.setupExamEventListeners();
    this.setupBankSoalEventListeners();
    this.setupStimulusEventListeners();
    this.setupQuestionFormEventListeners();
    this.setupEditQuestionEventListeners();
  },

  setupNavigation() {
    const navLinks = document.querySelectorAll(".sidebar-menu .nav-link");
    const panels = document.querySelectorAll(".menu-panel");
    const pageTitle = document.getElementById("current-menu-title");

    navLinks.forEach(link => {
      link.addEventListener("click", async (e) => {
        e.preventDefault();
        const targetId = link.getAttribute("data-target");

        if (targetId === "panel-tambah-soal") {
          const filterSelect = document.getElementById("bank-exam-filter");
          if (!this.selectedExamId && filterSelect && filterSelect.value) {
            this.setExamActive(filterSelect.value, filterSelect.options[filterSelect.selectedIndex].text);
          }

          if (!this.selectedExamId) {
            alert("Belum ada sesi ujian yang dipilih atau dibuat. Silakan buat ujian di menu 'Ujian' atau pilih ujian di 'Bank Soal'.");
            const bankTab = document.querySelector('.sidebar-menu .nav-link[data-target="panel-bank-soal"]');
            if (bankTab) bankTab.click();
            return;
          }

          await this.syncActiveExamToQuestionForm();
        } else {
          this.targetStimulusId = null;
          this.targetStimulusTitle = '';
        }

        navLinks.forEach(l => l.classList.remove("active"));
        panels.forEach(p => p.classList.add("d-none"));

        link.classList.add("active");
        const activePanel = document.getElementById(targetId);
        if (activePanel) {
          activePanel.classList.remove("d-none");
        }

        if (pageTitle) {
          pageTitle.innerText = link.innerText;
        }

        if (targetId === "panel-siswa") {
          this.loadStudentsTable();
        } else if (targetId === "panel-kelas") {
          this.loadClassesTable();
        } else if (targetId === "panel-ujian") {
          this.loadExamsTable();
        } else if (targetId === "panel-bank-soal") {
          this.loadBankSoalExamFilter();
        }
      });
    });
  },

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
  // MANAJEMEN UJIAN
  // ==========================================

  generateExamToken() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let token = "";
    for (let i = 0; i < 6; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  },

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
          subject,
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

      this.examsList = exams || [];

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

        const subjectBadge = ex.subject ? `<small style="display:block; color:var(--text-muted);">${ex.subject}</small>` : '';

        rowsHtml += `
          <tr>
            <td>${idx + 1}</td>
            <td><strong>${ex.title}</strong>${subjectBadge}</td>
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

    if (modalExam) {
      modalExam.addEventListener("click", (e) => {
        if (e.target === modalExam) closeModal();
      });
    }

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
        const subjectInput = document.getElementById("exam-subject");
        const subject = subjectInput ? subjectInput.value.trim() : title;
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
          const now = new Date();
          const startTime = now.toISOString();
          const endTime = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000)).toISOString();

          const { error } = await client.from('exams').insert({
            teacher_id: this.currentTeacher.id,
            class_id: classId,
            title: title,
            subject: subject,
            description: description,
            duration_minutes: duration,
            token: token,
            start_time: startTime,
            end_time: endTime,
            randomize_questions: randomizeQuestions,
            randomize_options: randomizeOptions,
            is_active: true
          });

          if (error) throw error;

          closeModal();
          await this.loadExamsTable();
          await this.loadBankSoalExamFilter();
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

  copyTokenToClipboard(token) {
    navigator.clipboard.writeText(token).then(() => {
      alert(`Token ujian "${token}" berhasil disalin ke clipboard!`);
    }).catch(() => {
      alert(`Gagal menyalin. Token: ${token}`);
    });
  },

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

  async deleteExam(examId, examTitle) {
    const yakin = confirm(`Apakah Anda yakin ingin menghapus ujian "${examTitle}"? Seluruh butir soal dan stimulus di ujian ini akan terhapus.`);
    if (!yakin) return;

    const client = getSupabaseClient();
    try {
      const { error } = await client
        .from('exams')
        .delete()
        .eq('id', examId);

      if (error) throw error;

      if (this.selectedExamId === examId) {
        this.selectedExamId = null;
        this.selectedExamTitle = '';
      }

      await this.loadExamsTable();
      await this.loadBankSoalExamFilter();
    } catch (err) {
      alert(`Gagal menghapus ujian: ${err.message}`);
    }
  },

  // ==========================================
  // BANK SOAL & STIMULUS
  // ==========================================

  setExamActive(examId, examTitle) {
    this.selectedExamId = examId;
    this.selectedExamTitle = examTitle;
    this.syncActiveExamToQuestionForm();
  },

  async loadBankSoalExamFilter() {
    const client = getSupabaseClient();
    const filterSelect = document.getElementById("bank-exam-filter");
    if (!client || !this.currentTeacher || !filterSelect) return;

    try {
      const { data: exams, error } = await client
        .from('exams')
        .select('id, title, subject')
        .eq('teacher_id', this.currentTeacher.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      this.examsList = exams || [];

      let optionsHtml = '<option value="">-- Pilih Sesi Ujian --</option>';
      this.examsList.forEach(e => {
        optionsHtml += `<option value="${e.id}">${e.title} (${e.subject || '-'})</option>`;
      });

      filterSelect.innerHTML = optionsHtml;

      if (this.examsList.length > 0) {
        if (!this.selectedExamId || !this.examsList.find(e => e.id === this.selectedExamId)) {
          const firstExam = this.examsList[0];
          const firstTitle = `${firstExam.title} (${firstExam.subject || '-'})`;
          filterSelect.value = firstExam.id;
          this.setExamActive(firstExam.id, firstTitle);
          await this.loadBankSoalContent(firstExam.id);
        } else {
          filterSelect.value = this.selectedExamId;
          await this.loadBankSoalContent(this.selectedExamId);
        }
      } else {
        this.selectedExamId = null;
        this.selectedExamTitle = '';
        this.syncActiveExamToQuestionForm();
      }
    } catch (err) {
      console.warn("Gagal memuat filter ujian Bank Soal:", err);
    }
  },

  setupBankSoalEventListeners() {
    const filterSelect = document.getElementById("bank-exam-filter");
    const btnGotoTambah = document.getElementById("btn-goto-tambah-soal");
    const btnRenumber = document.getElementById("btn-renumber-questions");

    if (filterSelect) {
      filterSelect.addEventListener("change", (e) => {
        const val = e.target.value;
        const text = filterSelect.options[filterSelect.selectedIndex]?.text || '';
        this.setExamActive(val, text);
        this.loadBankSoalContent(val);
      });
    }

    if (btnGotoTambah) {
      btnGotoTambah.addEventListener("click", () => {
        if (!this.selectedExamId) {
          alert("Silakan pilih salah satu ujian di dropdown Bank Soal terlebih dahulu.");
          return;
        }
        this.targetStimulusId = null;
        this.targetStimulusTitle = '';
        const navTambah = document.querySelector('.sidebar-menu .nav-link[data-target="panel-tambah-soal"]');
        if (navTambah) navTambah.click();
      });
    }

    if (btnRenumber) {
      btnRenumber.addEventListener("click", () => {
        if (!this.selectedExamId) {
          alert("Pilih sesi ujian terlebih dahulu.");
          return;
        }
        this.renumberAllQuestions(this.selectedExamId);
      });
    }
  },

  async loadBankSoalContent(examId) {
    const container = document.getElementById("bank-soal-list-container");
    if (!container) return;

    if (!examId) {
      container.innerHTML = `
        <div class="card text-center" style="padding: 40px 20px;">
          <p class="text-muted">Silakan pilih salah satu ujian di atas untuk melihat butir soal dan grup stimulus.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="card text-center" style="padding: 30px;">
        <p class="text-muted">Memuat butir soal dan stimulus...</p>
      </div>
    `;

    const client = getSupabaseClient();
    try {
      const { data: stimulusGroups, error: stimErr } = await client
        .from('stimulus_groups')
        .select('*')
        .eq('exam_id', examId)
        .order('created_at', { ascending: true });

      if (stimErr) throw stimErr;

      const { data: questions, error: qErr } = await client
        .from('questions')
        .select(`
          id,
          original_number,
          question_type,
          content,
          image_url,
          points,
          stimulus_group_id,
          options (
            id,
            option_label,
            content,
            is_correct
          )
        `)
        .eq('exam_id', examId)
        .order('original_number', { ascending: true });

      if (qErr) throw qErr;

      if ((!questions || questions.length === 0) && (!stimulusGroups || stimulusGroups.length === 0)) {
        container.innerHTML = `
          <div class="card text-center" style="padding: 40px 20px;">
            <p class="text-muted">Belum ada butir soal atau stimulus pada ujian ini.</p>
            <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: center;">
              <button class="btn btn-secondary" onclick="document.getElementById('btn-open-modal-stimulus').click();">+ Buat Stimulus</button>
              <button class="btn btn-primary" onclick="document.querySelector('.sidebar-menu .nav-link[data-target=\\'panel-tambah-soal\\']').click();">+ Mulai Tambah Soal</button>
            </div>
          </div>
        `;
        return;
      }

      let contentHtml = '';

      // Tampilkan Grup Stimulus
      const stimuliWithQuestions = (stimulusGroups || []).map(stim => {
        const stimQuestions = (questions || []).filter(q => q.stimulus_group_id === stim.id);
        const minNum = stimQuestions.length > 0 ? Math.min(...stimQuestions.map(q => q.original_number || 9999)) : 99999;
        return { stim, stimQuestions, minNum };
      });

      stimuliWithQuestions.sort((a, b) => a.minNum - b.minNum);

      stimuliWithQuestions.forEach(({ stim, stimQuestions }) => {
        const titleEscaped = (stim.title || '').replace(/'/g, "\\'");
        contentHtml += `
          <div class="card" style="border-left: 4px solid var(--primary-color); background: #fdfdfd; margin-bottom: 20px;">
            <div class="card-header" style="background: #f1f5f9; margin: -24px -24px 15px -24px; padding: 12px 20px; border-radius: 8px 8px 0 0;">
              <span style="font-weight: bold; color: var(--primary-color);">Wacana / Stimulus: ${stim.title || 'Tanpa Judul'}</span>
              <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                <button class="btn btn-primary btn-sm" onclick="GuruModule.goToAddQuestionWithStimulus('${stim.id}', '${titleEscaped}')">+ Tambah Soal di Stimulus Ini</button>
                <button class="btn btn-secondary btn-sm" onclick="GuruModule.openEditStimulusModal('${stim.id}')">Edit Stimulus</button>
                <button class="btn btn-danger btn-sm" onclick="GuruModule.deleteStimulusGroup('${stim.id}', '${examId}', ${stimQuestions.length})">Hapus Stimulus</button>
              </div>
            </div>
            <div class="math-content" style="font-size: 0.95rem; color: var(--text-main); margin-bottom: 15px; line-height: 1.6; white-space: pre-line;">
              ${stim.content || ''}
            </div>
            ${stim.image_url ? `<div style="margin-bottom: 15px;"><img src="${stim.image_url}" style="max-width: 100%; max-height: 250px; border-radius: 6px; border: 1px solid var(--border-color);"></div>` : ''}
            
            <div style="font-weight: 600; font-size: 0.85rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 10px;">
              Butir Soal Terkait (${stimQuestions.length} Soal):
            </div>
            <div style="display: flex; flex-direction: column; gap: 10px;">
              ${stimQuestions.length > 0 ? stimQuestions.map(q => this.renderQuestionItem(q, examId)).join('') : '<p class="text-muted" style="font-size: 0.85rem;">Belum ada butir soal. Klik "+ Tambah Soal di Stimulus Ini" untuk menambahkan.</p>'}
            </div>
          </div>
        `;
      });

      // Tampilkan Soal Mandiri
      const standaloneQuestions = (questions || []).filter(q => !q.stimulus_group_id);
      if (standaloneQuestions.length > 0) {
        contentHtml += `
          <div class="card">
            <div class="card-header">
              <span class="card-title">Soal Mandiri (Tanpa Stimulus) — ${standaloneQuestions.length} Soal</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 15px;">
              ${standaloneQuestions.map(q => this.renderQuestionItem(q, examId)).join('')}
            </div>
          </div>
        `;
      }

      container.innerHTML = contentHtml;
      this.renderMath(container);
    } catch (err) {
      container.innerHTML = `
        <div class="card" style="border: 1px solid var(--danger-color); color: var(--danger-color);">
          Gagal memuat bank soal: ${err.message}
        </div>
      `;
    }
  },

  renderQuestionItem(q, examId) {
    const typeLabel = q.question_type === 'pg' 
      ? '<span class="badge badge-success">Pilihan Ganda</span>' 
      : '<span class="badge badge-warning">PG Kompleks</span>';

    const sortedOptions = (q.options || []).sort((a, b) => (a.option_label || '').localeCompare(b.option_label || ''));

    let optionsListHtml = '';
    sortedOptions.forEach(opt => {
      const isKey = opt.is_correct ? 'style="color: var(--success-color); font-weight: bold;"' : 'style="color: var(--text-muted);"';
      const checkIcon = opt.is_correct ? '✓ ' : '';
      optionsListHtml += `
        <div ${isKey} class="math-content" style="font-size: 0.9rem; margin-bottom: 4px;">
          ${checkIcon}<strong>${opt.option_label}.</strong> ${opt.content}
        </div>
      `;
    });

    return `
      <div style="border: 1px solid var(--border-color); border-radius: 6px; padding: 14px; background: #ffffff;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <strong style="font-size: 1rem; color: var(--primary-color);">No. ${q.original_number || '-'}</strong>
            ${typeLabel}
            <small class="text-muted">(${q.points || 1} Poin)</small>
          </div>
          <div class="action-buttons" style="flex-wrap: wrap;">
            <button class="btn btn-secondary btn-sm" title="Geser Urutan Naik" onclick="GuruModule.moveQuestionOrder('${q.id}', '${examId}', ${q.original_number || 1}, -1)">▲</button>
            <button class="btn btn-secondary btn-sm" title="Geser Urutan Turun" onclick="GuruModule.moveQuestionOrder('${q.id}', '${examId}', ${q.original_number || 1}, 1)">▼</button>
            <button class="btn btn-secondary btn-sm" title="Duplikasi Soal Ini" onclick="GuruModule.duplicateQuestion('${q.id}', '${examId}')">Duplikat</button>
            <button class="btn btn-secondary btn-sm" onclick="GuruModule.openEditQuestionModal('${q.id}', '${examId}')">Edit Soal</button>
            <button class="btn btn-danger btn-sm" onclick="GuruModule.deleteQuestion('${q.id}', '${examId}')">Hapus</button>
          </div>
        </div>
        <div class="math-content" style="font-size: 0.95rem; margin-bottom: 10px; line-height: 1.5; white-space: pre-line;">
          ${q.content}
        </div>
        ${q.image_url ? `<div style="margin-bottom: 10px;"><img src="${q.image_url}" style="max-height: 180px; border-radius: 4px; border: 1px solid var(--border-color);"></div>` : ''}
        <div style="background: #f8fafc; padding: 10px; border-radius: 6px; border-left: 3px solid var(--border-color);">
          ${optionsListHtml || '<em class="text-muted" style="font-size: 0.85rem;">Belum ada pilihan jawaban.</em>'}
        </div>
      </div>
    `;
  },

  async deleteQuestion(questionId, examId) {
    const yakin = confirm("Apakah Anda yakin ingin menghapus butir soal ini?");
    if (!yakin) return;

    const client = getSupabaseClient();
    try {
      const { error } = await client
        .from('questions')
        .delete()
        .eq('id', questionId);

      if (error) throw error;
      await this.loadBankSoalContent(examId);
    } catch (err) {
      alert(`Gagal menghapus butir soal: ${err.message}`);
    }
  },

  async deleteStimulusGroup(stimulusId, examId, questionCount = 0) {
    let confirmMsg = "Apakah Anda yakin ingin menghapus grup stimulus ini?";
    if (questionCount > 0) {
      confirmMsg = `Grup stimulus ini memuat ${questionCount} butir soal.\n\nJika grup stimulus dihapus, soal-soal di dalamnya AKAN TETAP ADA dan otomatis berubah menjadi 'Soal Mandiri (Tanpa Stimulus)'.\n\nLanjutkan penghapusan?`;
    }

    const yakin = confirm(confirmMsg);
    if (!yakin) return;

    const client = getSupabaseClient();
    try {
      const { error } = await client
        .from('stimulus_groups')
        .delete()
        .eq('id', stimulusId);

      if (error) throw error;
      await this.loadBankSoalContent(examId);
    } catch (err) {
      alert(`Gagal menghapus grup stimulus: ${err.message}`);
    }
  },

  goToAddQuestionWithStimulus(stimulusId, stimulusTitle = '') {
    this.targetStimulusId = stimulusId;
    this.targetStimulusTitle = stimulusTitle;
    const navTambah = document.querySelector('.sidebar-menu .nav-link[data-target="panel-tambah-soal"]');
    if (navTambah) {
      navTambah.click();
    }
  },

  // ==========================================
  // MANAJEMEN STIMULUS
  // ==========================================

  setupStimulusEventListeners() {
    const modalCreate = document.getElementById("modal-create-stimulus");
    const btnOpenCreate = document.getElementById("btn-open-modal-stimulus");
    const btnCloseCreate = document.getElementById("btn-close-modal-stimulus");
    const btnCancelCreate = document.getElementById("btn-cancel-create-stimulus");
    const formCreate = document.getElementById("form-create-stimulus");
    const alertCreate = document.getElementById("stimulus-form-alert");
    const btnSaveCreate = document.getElementById("btn-save-stimulus");

    const openCreateModal = () => {
      if (!this.selectedExamId) {
        alert("Silakan pilih sesi ujian terlebih dahulu sebelum membuat stimulus.");
        return;
      }
      formCreate.reset();
      alertCreate.classList.add("d-none");
      btnSaveCreate.disabled = false;
      btnSaveCreate.innerText = "Simpan Stimulus";
      modalCreate.classList.remove("d-none");
    };

    const closeCreateModal = () => modalCreate.classList.add("d-none");

    if (btnOpenCreate) btnOpenCreate.addEventListener("click", openCreateModal);
    if (btnCloseCreate) btnCloseCreate.addEventListener("click", closeCreateModal);
    if (btnCancelCreate) btnCancelCreate.addEventListener("click", closeCreateModal);

    if (modalCreate) {
      modalCreate.addEventListener("click", (e) => {
        if (e.target === modalCreate) closeCreateModal();
      });
    }

    if (formCreate) {
      formCreate.addEventListener("submit", async (e) => {
        e.preventDefault();
        alertCreate.classList.add("d-none");

        const title = document.getElementById("stimulus-title").value.trim();
        const fileInput = document.getElementById("stimulus-image-file");
        let imageUrl = document.getElementById("stimulus-image-url").value.trim() || null;
        const content = document.getElementById("stimulus-content").value.trim();

        btnSaveCreate.disabled = true;
        btnSaveCreate.innerText = "Mengunggah & Menyimpan...";

        try {
          if (fileInput && fileInput.files && fileInput.files[0]) {
            imageUrl = await this.uploadImageFile(fileInput.files[0], 'stimulus');
          }

          const client = getSupabaseClient();
          const { error } = await client
            .from('stimulus_groups')
            .insert({
              exam_id: this.selectedExamId,
              title: title,
              image_url: imageUrl,
              content: content
            });

          if (error) throw error;

          closeCreateModal();
          await this.loadBankSoalContent(this.selectedExamId);
        } catch (err) {
          alertCreate.className = "alert alert-error";
          alertCreate.innerText = `Gagal menyimpan stimulus: ${err.message}`;
          alertCreate.classList.remove("d-none");
          btnSaveCreate.disabled = false;
          btnSaveCreate.innerText = "Coba Simpan Lagi";
        }
      });
    }

    const modalEdit = document.getElementById("modal-edit-stimulus");
    const btnCloseEdit = document.getElementById("btn-close-modal-edit-stimulus");
    const btnCancelEdit = document.getElementById("btn-cancel-edit-stimulus");
    const formEdit = document.getElementById("form-edit-stimulus");
    const alertEdit = document.getElementById("edit-stimulus-form-alert");
    const btnUpdateEdit = document.getElementById("btn-update-stimulus");

    const closeEditModal = () => modalEdit.classList.add("d-none");

    if (btnCloseEdit) btnCloseEdit.addEventListener("click", closeEditModal);
    if (btnCancelEdit) btnCancelEdit.addEventListener("click", closeEditModal);

    if (modalEdit) {
      modalEdit.addEventListener("click", (e) => {
        if (e.target === modalEdit) closeEditModal();
      });
    }

    if (formEdit) {
      formEdit.addEventListener("submit", async (e) => {
        e.preventDefault();
        alertEdit.classList.add("d-none");

        const stimulusId = document.getElementById("edit-stimulus-id").value;
        const examId = document.getElementById("edit-stimulus-exam-id").value;
        const title = document.getElementById("edit-stimulus-title").value.trim();
        const fileInput = document.getElementById("edit-stimulus-image-file");
        let imageUrl = document.getElementById("edit-stimulus-image-url").value.trim() || null;
        const content = document.getElementById("edit-stimulus-content").value.trim();

        btnUpdateEdit.disabled = true;
        btnUpdateEdit.innerText = "Memperbarui...";

        try {
          if (fileInput && fileInput.files && fileInput.files[0]) {
            imageUrl = await this.uploadImageFile(fileInput.files[0], 'stimulus');
          }

          const client = getSupabaseClient();
          const { error } = await client
            .from('stimulus_groups')
            .update({
              title: title,
              image_url: imageUrl,
              content: content
            })
            .eq('id', stimulusId);

          if (error) throw error;

          closeEditModal();
          await this.loadBankSoalContent(examId);
        } catch (err) {
          alertEdit.className = "alert alert-error";
          alertEdit.innerText = `Gagal memperbarui stimulus: ${err.message}`;
          alertEdit.classList.remove("d-none");
        } finally {
          btnUpdateEdit.disabled = false;
          btnUpdateEdit.innerText = "Simpan Perubahan";
        }
      });
    }
  },

  async openEditStimulusModal(stimulusId) {
    const modal = document.getElementById("modal-edit-stimulus");
    const alertEl = document.getElementById("edit-stimulus-form-alert");
    const btnUpdate = document.getElementById("btn-update-stimulus");
    const fileInput = document.getElementById("edit-stimulus-image-file");

    alertEl.classList.add("d-none");
    if (fileInput) fileInput.value = "";
    btnUpdate.disabled = false;
    btnUpdate.innerText = "Simpan Perubahan";
    modal.classList.remove("d-none");

    const client = getSupabaseClient();
    try {
      const { data: stim, error } = await client
        .from('stimulus_groups')
        .select('*')
        .eq('id', stimulusId)
        .single();

      if (error) throw error;

      document.getElementById("edit-stimulus-id").value = stim.id;
      document.getElementById("edit-stimulus-exam-id").value = stim.exam_id;
      document.getElementById("edit-stimulus-title").value = stim.title || "";
      document.getElementById("edit-stimulus-image-url").value = stim.image_url || "";
      document.getElementById("edit-stimulus-content").value = stim.content || "";
    } catch (err) {
      alertEl.className = "alert alert-error";
      alertEl.innerText = `Gagal memuat data stimulus: ${err.message}`;
      alertEl.classList.remove("d-none");
    }
  },

  async loadStimulusDropdown(examId, targetSelectId = "question-stimulus-id") {
    const selectEl = document.getElementById(targetSelectId);
    if (!selectEl) return;

    selectEl.innerHTML = '<option value="">-- Soal Mandiri (Tanpa Stimulus) --</option>';

    if (!examId) return;

    const client = getSupabaseClient();
    try {
      const { data: groups, error } = await client
        .from('stimulus_groups')
        .select('id, title')
        .eq('exam_id', examId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      (groups || []).forEach((g, idx) => {
        selectEl.innerHTML += `<option value="${g.id}">Grup ${idx + 1}: ${g.title || 'Tanpa Judul'}</option>`;
      });

      if (this.targetStimulusId && targetSelectId === "question-stimulus-id") {
        selectEl.value = this.targetStimulusId;
      }
    } catch (err) {
      console.warn("Gagal memuat dropdown stimulus:", err);
    }
  },

  // ==========================================
  // FORMULIR TAMBAH SOAL
  // ==========================================

  async syncActiveExamToQuestionForm() {
    const examIdInput = document.getElementById("question-exam-id");
    const displayEl = document.getElementById("active-exam-title-display");
    const numberInput = document.getElementById("question-number");
    const stimBanner = document.getElementById("active-stimulus-banner");
    const stimTitleDisplay = document.getElementById("active-stimulus-title-display");

    if (examIdInput) examIdInput.value = this.selectedExamId || "";
    if (displayEl) displayEl.innerText = this.selectedExamTitle || "-";

    if (this.targetStimulusId && stimBanner && stimTitleDisplay) {
      stimBanner.classList.remove("d-none");
      stimTitleDisplay.innerText = this.targetStimulusTitle || "Grup Stimulus Terpilih";
    } else if (stimBanner) {
      stimBanner.classList.add("d-none");
    }

    if (this.selectedExamId) {
      await this.loadStimulusDropdown(this.selectedExamId, "question-stimulus-id");

      if (numberInput) {
        numberInput.value = await this.getSuggestedQuestionNumber(this.selectedExamId, this.targetStimulusId);
      }
    }
  },

  setupQuestionFormEventListeners() {
    const form = document.getElementById("form-create-question");
    const typeSelect = document.getElementById("question-type");
    const keyInstruction = document.getElementById("key-instruction");
    const formAlert = document.getElementById("question-form-alert");
    const btnSave = document.getElementById("btn-save-question");
    const btnBack = document.getElementById("btn-back-to-bank");
    const btnDetachStimulus = document.getElementById("btn-detach-stimulus");
    const stimSelect = document.getElementById("question-stimulus-id");

    const questionInput = document.getElementById("question-content");
    const previewBox = document.getElementById("math-preview-box");
    const previewContent = document.getElementById("math-preview-content");

    if (questionInput && previewBox && previewContent) {
      questionInput.addEventListener("input", (e) => {
        const val = e.target.value.trim();
        if (val) {
          previewBox.style.display = "block";
          previewContent.innerText = val;
          this.renderMath(previewContent);
        } else {
          previewBox.style.display = "none";
        }
      });
    }

    if (btnDetachStimulus) {
      btnDetachStimulus.addEventListener("click", async () => {
        this.targetStimulusId = null;
        this.targetStimulusTitle = '';
        if (stimSelect) stimSelect.value = "";
        const stimBanner = document.getElementById("active-stimulus-banner");
        if (stimBanner) stimBanner.classList.add("d-none");
        const numberInput = document.getElementById("question-number");
        if (numberInput) {
          numberInput.value = await this.getSuggestedQuestionNumber(this.selectedExamId, null);
        }
      });
    }

    if (btnBack) {
      btnBack.addEventListener("click", () => {
        this.targetStimulusId = null;
        this.targetStimulusTitle = '';
        const bankTab = document.querySelector('.sidebar-menu .nav-link[data-target="panel-bank-soal"]');
        if (bankTab) bankTab.click();
      });
    }

    if (typeSelect) {
      typeSelect.addEventListener("change", (e) => {
        const isPgk = e.target.value === 'pgk';
        const keyInputs = document.querySelectorAll("#options-inputs-container .option-key-input");

        keyInputs.forEach(input => {
          input.type = isPgk ? 'checkbox' : 'radio';
          if (!isPgk) {
            input.name = "correct_key";
          } else {
            input.removeAttribute("name");
          }
        });

        if (keyInstruction) {
          keyInstruction.innerText = isPgk 
            ? "Centang satu atau lebih kotak untuk kunci jawaban benar (PG Kompleks)."
            : "Pilih 1 radio button untuk kunci jawaban benar.";
        }
      });
    }

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        formAlert.classList.add("d-none");

        const examId = this.selectedExamId || document.getElementById("question-exam-id")?.value;
        const stimulusSelectEl = document.getElementById("question-stimulus-id");
        const stimulusId = stimulusSelectEl?.value || this.targetStimulusId || null;
        const originalNumber = parseInt(document.getElementById("question-number").value, 10);
        const questionType = document.getElementById("question-type").value;
        const points = parseFloat(document.getElementById("question-points").value) || 1.0;
        const fileInput = document.getElementById("question-image-file");
        let imageUrl = document.getElementById("question-image-url").value.trim() || null;
        const content = document.getElementById("question-content").value.trim();

        if (!examId) {
          alert("Sesi ujian belum aktif. Silakan buka menu Bank Soal dan pilih ujian terlebih dahulu.");
          return;
        }

        const textInputs = document.querySelectorAll("#options-inputs-container .option-text-input");
        const keyInputs = document.querySelectorAll("#options-inputs-container .option-key-input");

        const optionsData = [];
        const correctKeys = [];

        textInputs.forEach((textInput, idx) => {
          const label = textInput.getAttribute("data-label");
          const val = textInput.value.trim();
          const isCorrect = keyInputs[idx].checked;

          if (val) {
            if (isCorrect) correctKeys.push(label);
            optionsData.push({
              option_label: label,
              content: val,
              is_correct: isCorrect
            });
          }
        });

        if (optionsData.length < 2) {
          formAlert.className = "alert alert-error";
          formAlert.innerText = "Soal harus memiliki minimal 2 pilihan jawaban (misal A dan B).";
          formAlert.classList.remove("d-none");
          return;
        }

        if (correctKeys.length === 0) {
          formAlert.className = "alert alert-error";
          formAlert.innerText = "Tentukan minimal satu kunci jawaban yang benar.";
          formAlert.classList.remove("d-none");
          return;
        }

        btnSave.disabled = true;
        btnSave.innerText = "Menyimpan & Menyesuaikan Nomor...";

        try {
          await this.shiftQuestionsUp(examId, originalNumber);

          if (fileInput && fileInput.files && fileInput.files[0]) {
            imageUrl = await this.uploadImageFile(fileInput.files[0], 'questions');
          }

          const client = getSupabaseClient();
          const { data: newQuestion, error: qErr } = await client
            .from('questions')
            .insert({
              exam_id: examId,
              stimulus_group_id: stimulusId,
              original_number: originalNumber,
              question_type: questionType,
              points: points,
              image_url: imageUrl,
              content: content,
              correct_keys: correctKeys,
              group_id: null
            })
            .select()
            .single();

          if (qErr) throw qErr;

          const optionsPayload = optionsData.map(opt => ({
            question_id: newQuestion.id,
            option_label: opt.option_label,
            content: opt.content,
            is_correct: opt.is_correct
          }));

          const { error: optErr } = await client
            .from('options')
            .insert(optionsPayload);

          if (optErr) throw optErr;

          formAlert.className = "alert alert-success";
          formAlert.innerText = `Soal No. ${originalNumber} berhasil disimpan!`;
          formAlert.classList.remove("d-none");

          document.getElementById("question-content").value = "";
          document.getElementById("question-image-url").value = "";
          if (fileInput) fileInput.value = "";
          if (previewBox) previewBox.style.display = "none";
          textInputs.forEach(input => input.value = "");
          keyInputs.forEach((input, idx) => input.checked = (idx === 0));

          document.getElementById("question-number").value = originalNumber + 1;

          if (this.targetStimulusId && stimulusSelectEl) {
            stimulusSelectEl.value = this.targetStimulusId;
          }

          await this.loadBankSoalContent(examId);
        } catch (err) {
          formAlert.className = "alert alert-error";
          formAlert.innerText = `Gagal menyimpan butir soal: ${err.message}`;
          formAlert.classList.remove("d-none");
        } finally {
          btnSave.disabled = false;
          btnSave.innerText = "Simpan Butir Soal";
        }
      });
    }
  },

  // ==========================================
  // MODAL EDIT BUTIR SOAL
  // ==========================================

  async openEditQuestionModal(questionId, examId) {
    const modal = document.getElementById("modal-edit-question");
    const alertEl = document.getElementById("edit-q-form-alert");
    const optionsContainer = document.getElementById("edit-options-container");
    const typeSelect = document.getElementById("edit-q-type");
    const keyInstruction = document.getElementById("edit-key-instruction");
    const editPreviewBox = document.getElementById("edit-math-preview-box");
    const editPreviewContent = document.getElementById("edit-math-preview-content");
    const fileInput = document.getElementById("edit-q-image-file");

    alertEl.classList.add("d-none");
    if (fileInput) fileInput.value = "";
    optionsContainer.innerHTML = '<p class="text-muted">Memuat opsi jawaban...</p>';
    modal.classList.remove("d-none");

    await this.loadStimulusDropdown(examId, "edit-q-stimulus-id");

    const client = getSupabaseClient();
    try {
      const { data: q, error: qErr } = await client
        .from('questions')
        .select(`
          id,
          exam_id,
          stimulus_group_id,
          original_number,
          question_type,
          points,
          image_url,
          content,
          options (
            id,
            option_label,
            content,
            is_correct
          )
        `)
        .eq('id', questionId)
        .single();

      if (qErr) throw qErr;

      document.getElementById("edit-q-id").value = q.id;
      document.getElementById("edit-q-exam-id").value = q.exam_id;
      document.getElementById("edit-q-stimulus-id").value = q.stimulus_group_id || "";
      document.getElementById("edit-q-number").value = q.original_number || 1;
      typeSelect.value = q.question_type || "pg";
      document.getElementById("edit-q-points").value = q.points || 1.0;
      document.getElementById("edit-q-image-url").value = q.image_url || "";
      document.getElementById("edit-q-content").value = q.content || "";

      if (editPreviewBox && editPreviewContent) {
        if (q.content && q.content.trim()) {
          editPreviewBox.style.display = "block";
          editPreviewContent.innerText = q.content;
          this.renderMath(editPreviewContent);
        } else {
          editPreviewBox.style.display = "none";
        }
      }

      const isPgk = q.question_type === 'pgk';
      keyInstruction.innerText = isPgk 
        ? "Centang kotak untuk kunci jawaban benar (PG Kompleks)." 
        : "Pilih 1 radio button untuk kunci jawaban benar.";

      const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
      const existingOptionsMap = {};
      (q.options || []).forEach(opt => {
        existingOptionsMap[opt.option_label] = opt;
      });

      let optionsHtml = '';
      labels.forEach(lbl => {
        const opt = existingOptionsMap[lbl] || { id: '', content: '', is_correct: false };
        const inputType = isPgk ? 'checkbox' : 'radio';
        const checkedAttr = opt.is_correct ? 'checked' : '';
        const nameAttr = isPgk ? '' : 'name="edit_correct_key"';

        optionsHtml += `
          <div style="display: flex; align-items: center; gap: 10px;">
            <input type="${inputType}" ${nameAttr} class="edit-option-key" value="${lbl}" ${checkedAttr} title="Tandai Benar">
            <strong style="width: 25px;">${lbl}.</strong>
            <input type="text" class="edit-option-text" data-label="${lbl}" data-option-id="${opt.id}" value="${opt.content || ''}" placeholder="Teks pilihan ${lbl}..." style="flex-grow: 1;">
          </div>
        `;
      });

      optionsContainer.innerHTML = optionsHtml;
    } catch (err) {
      alertEl.className = "alert alert-error";
      alertEl.innerText = `Gagal membaca detail soal: ${err.message}`;
      alertEl.classList.remove("d-none");
    }
  },

  setupEditQuestionEventListeners() {
    const modal = document.getElementById("modal-edit-question");
    const btnClose = document.getElementById("btn-close-modal-edit-q");
    const btnCancel = document.getElementById("btn-cancel-edit-q");
    const form = document.getElementById("form-edit-question");
    const typeSelect = document.getElementById("edit-q-type");
    const keyInstruction = document.getElementById("edit-key-instruction");
    const alertEl = document.getElementById("edit-q-form-alert");
    const btnUpdate = document.getElementById("btn-update-question");

    const editQuestionInput = document.getElementById("edit-q-content");
    const editPreviewBox = document.getElementById("edit-math-preview-box");
    const editPreviewContent = document.getElementById("edit-math-preview-content");

    if (editQuestionInput && editPreviewBox && editPreviewContent) {
      editQuestionInput.addEventListener("input", (e) => {
        const val = e.target.value.trim();
        if (val) {
          editPreviewBox.style.display = "block";
          editPreviewContent.innerText = val;
          this.renderMath(editPreviewContent);
        } else {
          editPreviewBox.style.display = "none";
        }
      });
    }

    const closeModal = () => modal.classList.add("d-none");

    if (btnClose) btnClose.addEventListener("click", closeModal);
    if (btnCancel) btnCancel.addEventListener("click", closeModal);

    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal();
      });
    }

    if (typeSelect) {
      typeSelect.addEventListener("change", (e) => {
        const isPgk = e.target.value === 'pgk';
        const keys = document.querySelectorAll(".edit-option-key");
        keys.forEach(k => {
          k.type = isPgk ? 'checkbox' : 'radio';
          if (!isPgk) {
            k.name = "edit_correct_key";
          } else {
            k.removeAttribute("name");
          }
        });

        if (keyInstruction) {
          keyInstruction.innerText = isPgk 
            ? "Centang kotak untuk kunci jawaban benar (PG Kompleks)." 
            : "Pilih 1 radio button untuk kunci jawaban benar.";
        }
      });
    }

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        alertEl.classList.add("d-none");

        const questionId = document.getElementById("edit-q-id").value;
        const examId = document.getElementById("edit-q-exam-id").value;
        const stimulusId = document.getElementById("edit-q-stimulus-id").value || null;
        const originalNumber = parseInt(document.getElementById("edit-q-number").value, 10);
        const questionType = document.getElementById("edit-q-type").value;
        const points = parseFloat(document.getElementById("edit-q-points").value) || 1.0;
        const fileInput = document.getElementById("edit-q-image-file");
        let imageUrl = document.getElementById("edit-q-image-url").value.trim() || null;
        const content = document.getElementById("edit-q-content").value.trim();

        const textInputs = document.querySelectorAll(".edit-option-text");
        const keyInputs = document.querySelectorAll(".edit-option-key");

        const optionsToSave = [];
        const correctKeys = [];

        textInputs.forEach((txt, idx) => {
          const label = txt.getAttribute("data-label");
          const val = txt.value.trim();
          const isCorrect = keyInputs[idx].checked;

          if (val) {
            if (isCorrect) correctKeys.push(label);
            optionsToSave.push({
              id: txt.getAttribute("data-option-id") || null,
              question_id: questionId,
              option_label: label,
              content: val,
              is_correct: isCorrect
            });
          }
        });

        if (optionsToSave.length < 2) {
          alertEl.className = "alert alert-error";
          alertEl.innerText = "Soal harus memiliki minimal 2 pilihan jawaban.";
          alertEl.classList.remove("d-none");
          return;
        }

        if (correctKeys.length === 0) {
          alertEl.className = "alert alert-error";
          alertEl.innerText = "Tentukan minimal satu kunci jawaban yang benar.";
          alertEl.classList.remove("d-none");
          return;
        }

        btnUpdate.disabled = true;
        btnUpdate.innerText = "Memperbarui...";

        try {
          if (fileInput && fileInput.files && fileInput.files[0]) {
            imageUrl = await this.uploadImageFile(fileInput.files[0], 'questions');
          }

          const client = getSupabaseClient();
          const { error: qUpdateErr } = await client
            .from('questions')
            .update({
              stimulus_group_id: stimulusId,
              original_number: originalNumber,
              question_type: questionType,
              points: points,
              image_url: imageUrl,
              content: content,
              correct_keys: correctKeys
            })
            .eq('id', questionId);

          if (qUpdateErr) throw qUpdateErr;

          await client.from('options').delete().eq('question_id', questionId);

          const newOptionsPayload = optionsToSave.map(opt => ({
            question_id: questionId,
            option_label: opt.option_label,
            content: opt.content,
            is_correct: opt.is_correct
          }));

          const { error: optInsertErr } = await client
            .from('options')
            .insert(newOptionsPayload);

          if (optInsertErr) throw optInsertErr;

          closeModal();
          await this.loadBankSoalContent(examId);
        } catch (err) {
          alertEl.className = "alert alert-error";
          alertEl.innerText = `Gagal memperbarui soal: ${err.message}`;
          alertEl.classList.remove("d-none");
        } finally {
          btnUpdate.disabled = false;
          btnUpdate.innerText = "Simpan Perubahan";
        }
      });
    }
  },

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
