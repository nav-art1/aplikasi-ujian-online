// ==========================================================================
// MODUL GURU: FIX UPLOAD GAMBAR SOAL/STIMULUS & PENGATURAN SKOR
// ==========================================================================

const GuruModule = {
  currentTeacher: null,
  classesList: [],
  examsList: [],
  selectedExamId: null,
  selectedExamTitle: '',
  targetStimulusId: null,
  targetStimulusTitle: '',
  selectedStudentClassId: null,
  parsedExcelQuestions: [],
  parsedExcelStudents: [],

  showLoader(message = "Memproses Data...") {
    const loader = document.getElementById("global-loader");
    const msgEl = document.getElementById("loader-message");
    if (loader) {
      if (msgEl) msgEl.innerText = message;
      loader.classList.remove("d-none");
    }
  },

  hideLoader() {
    const loader = document.getElementById("global-loader");
    if (loader) loader.classList.add("d-none");
  },

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

  // FIX: FUNGSI UPLOAD GAMBAR DENGAN VALIDASI PUBLIC STORAGE
  async uploadImageFile(file, folder = 'questions') {
    if (!file) return null;
    const client = getSupabaseClient();
    const fileExt = file.name.split('.').pop() || 'jpg';
    const cleanFileName = `${folder}/${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${fileExt.toLowerCase()}`;

    const { data, error } = await client.storage
      .from('exam-images')
      .upload(cleanFileName, file, { cacheControl: '3600', upsert: true });

    if (error) {
      throw new Error(`Upload gambar gagal: ${error.message}. Pastikan bucket "exam-images" di Supabase berstatus Public.`);
    }

    const { data: pubUrlData } = client.storage
      .from('exam-images')
      .getPublicUrl(cleanFileName);

    return pubUrlData.publicUrl;
  },

  downloadExcelTemplate() {
    const templateData = [
      {
        nomor: 1,
        judul_stimulus: "",
        isi_stimulus: "",
        tipe: "pg",
        poin_benar: 2.0,
        pgk_skor_salah_1: 0,
        pgk_skor_salah_2: 0,
        pgk_skor_salah_3: 0,
        soal: "Ibukota negara Indonesia saat ini adalah...",
        opsi_a: "Jakarta",
        opsi_b: "Surabaya",
        opsi_c: "Bandung",
        opsi_d: "Medan",
        opsi_e: "",
        opsi_f: "",
        kunci: "A",
        gambar_url: ""
      },
      {
        nomor: 2,
        judul_stimulus: "Teks Ekosistem Mangrove",
        isi_stimulus: "Hutan mangrove merupakan ekosistem pesisir penting yang mencegah abrasi dan menjadi habitat biota laut.",
        tipe: "pgk",
        poin_benar: 4.0,
        pgk_skor_salah_1: 2.0,
        pgk_skor_salah_2: 0.0,
        pgk_skor_salah_3: 0.0,
        soal: "Berdasarkan teks, manakah peran utama hutan mangrove? (Pilihan Ganda Kompleks)",
        opsi_a: "Meredam gelombang tsunami",
        opsi_b: "Tempat pemijahan udang dan kepiting",
        opsi_c: "Tambang batu bara lepas pantai",
        opsi_d: "Mencegah abrasi daratan",
        opsi_e: "Peneduh kawasan pantai",
        opsi_f: "",
        kunci: "A,B,D",
        gambar_url: ""
      }
    ];

    try {
      if (typeof XLSX !== 'undefined') {
        const worksheet = XLSX.utils.json_to_sheet(templateData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Template Soal");
        const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = "template_soal_ujian.xlsx";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
      }
    } catch (err) {
      console.warn("XLSX warning, beralih ke CSV:", err);
    }

    try {
      const headers = Object.keys(templateData[0]).join(",");
      const rows = templateData.map(row => Object.values(row).map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
      const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [headers, ...rows].join("\n");
      const encodedUri = encodeURI(csvContent);
      const a = document.createElement("a");
      a.setAttribute("href", encodedUri);
      a.setAttribute("download", "template_soal_ujian.csv");
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (csvErr) {
      alert(`Gagal mengunduh template: ${csvErr.message}`);
    }
  },

  downloadStudentExcelTemplate() {
    const templateData = [
      { nomor_absen: 1, nama_siswa: 'Ahmad Maulana', nisn: '10293847' },
      { nomor_absen: 2, nama_siswa: 'Budi Santoso', nisn: '10293848' },
      { nomor_absen: 3, nama_siswa: 'Citra Dewi', nisn: '10293849' }
    ];

    try {
      if (typeof XLSX !== 'undefined') {
        const ws = XLSX.utils.json_to_sheet(templateData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Template Siswa");
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = "template_siswa.xlsx";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
      }
    } catch (err) {
      console.warn("XLSX student warning:", err);
    }

    const headers = Object.keys(templateData[0]).join(",");
    const rows = templateData.map(row => Object.values(row).map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [headers, ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const a = document.createElement("a");
    a.setAttribute("href", encodedUri);
    a.setAttribute("download", "template_siswa.csv");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },

  async getSuggestedQuestionNumber(examId, stimulusId = null) {
    if (!examId) return 1;
    const client = getSupabaseClient();
    try {
      if (stimulusId) {
        const { data: stimQ } = await client.from('questions').select('original_number').eq('exam_id', examId).eq('stimulus_group_id', stimulusId).order('original_number', { ascending: false }).limit(1);
        if (stimQ && stimQ.length > 0 && stimQ[0].original_number) return stimQ[0].original_number + 1;
      }
      const { data: maxQ } = await client.from('questions').select('original_number').eq('exam_id', examId).order('original_number', { ascending: false }).limit(1);
      if (maxQ && maxQ.length > 0 && maxQ[0].original_number) return maxQ[0].original_number + 1;
      return 1;
    } catch {
      return 1;
    }
  },

  async shiftQuestionsUp(examId, targetNumber) {
    const client = getSupabaseClient();
    try {
      const { data: colliding } = await client.from('questions').select('id, original_number').eq('exam_id', examId).gte('original_number', targetNumber).order('original_number', { ascending: false });
      if (colliding && colliding.length > 0) {
        for (const q of colliding) {
          await client.from('questions').update({ original_number: q.original_number + 1 }).eq('id', q.id);
        }
      }
    } catch (err) {
      console.warn("Gagal shift nomor:", err);
    }
  },

  async renumberAllQuestions(examId) {
    if (!examId || !confirm("Rapikan seluruh urutan nomor soal dari 1 s.d. selesai?")) return;
    this.showLoader("Merapikan nomor butir soal...");
    const client = getSupabaseClient();
    try {
      const { data: allQ } = await client.from('questions').select('id, stimulus_group_id, original_number').eq('exam_id', examId).order('original_number', { ascending: true });
      if (!allQ || allQ.length === 0) {
        this.hideLoader();
        return;
      }

      const ordered = [];
      const visited = new Set();
      for (const q of allQ) {
        if (!q.stimulus_group_id) {
          ordered.push(q);
        } else if (!visited.has(q.stimulus_group_id)) {
          visited.add(q.stimulus_group_id);
          const group = allQ.filter(item => item.stimulus_group_id === q.stimulus_group_id);
          ordered.push(...group);
        }
      }

      for (let i = 0; i < ordered.length; i++) {
        await client.from('questions').update({ original_number: i + 1 }).eq('id', ordered[i].id);
      }

      alert("Urutan nomor berhasil dirapikan!");
      await this.loadBankSoalContent(examId);
    } catch (err) {
      alert(`Gagal: ${err.message}`);
    } finally {
      this.hideLoader();
    }
  },

  async initDashboard(teacherProfile) {
    this.currentTeacher = teacherProfile;
    document.getElementById("auth-section")?.classList.add("d-none");
    document.getElementById("dashboard-section")?.classList.remove("d-none");
    document.getElementById("teacher-name-display").innerText = teacherProfile.full_name || teacherProfile.email;

    this.setupNavigation();
    await this.ensureDefaultClass();
    await this.loadClassesDropdown();
    await this.loadClassesTable();
    await this.loadExamsTable();
    await this.loadQuickStats();
    await this.loadBankSoalExamFilter();

    this.setupStudentEventListeners();
    this.setupImportStudentEventListeners();
    this.setupClassEventListeners();
    this.setupExamEventListeners();
    this.setupBankSoalEventListeners();
    this.setupBulkScoreEventListeners();
    this.setupStimulusEventListeners();
    this.setupQuestionFormEventListeners();
    this.setupEditQuestionEventListeners();
    this.setupImportExcelEventListeners();
  },

  setupNavigation() {
    const navLinks = document.querySelectorAll(".sidebar-menu .nav-link");
    const panels = document.querySelectorAll(".menu-panel");

    navLinks.forEach(link => {
      link.addEventListener("click", async (e) => {
        e.preventDefault();
        const targetId = link.getAttribute("data-target");

        navLinks.forEach(l => l.classList.remove("active"));
        panels.forEach(p => p.classList.add("d-none"));

        link.classList.add("active");
        document.getElementById(targetId)?.classList.remove("d-none");
        document.getElementById("current-menu-title").innerText = link.innerText;

        if (targetId === "panel-tambah-soal") {
          await this.syncActiveExamToQuestionForm();
        } else if (targetId === "panel-siswa") {
          await this.loadClassesDropdown();
          if (this.selectedStudentClassId) await this.loadStudentsTableByClass(this.selectedStudentClassId);
        } else if (targetId === "panel-kelas") {
          this.loadClassesTable();
        } else if (targetId === "panel-ujian") {
          this.loadExamsTable();
        } else if (targetId === "panel-bank-soal") {
          this.loadBankSoalExamFilter();
        } else if (targetId === "panel-hasil") {
          this.loadHasilExamFilter();
        } else if (targetId === "panel-import-excel") {
          const sel = document.getElementById("import-exam-select");
          if (sel && this.selectedExamId) sel.value = this.selectedExamId;
        }
      });
    });
  },

  async ensureDefaultClass() {
    const client = getSupabaseClient();
    const { data } = await client.from('classes').select('*').eq('teacher_id', this.currentTeacher.id);
    if (!data || data.length === 0) {
      await client.from('classes').insert({ teacher_id: this.currentTeacher.id, class_name: 'VII A' });
    }
  },

  async loadClassesDropdown() {
    const client = getSupabaseClient();
    const { data } = await client.from('classes').select('*').eq('teacher_id', this.currentTeacher.id).order('class_name', { ascending: true });
    this.classesList = data || [];

    let optionsHtml = '<option value="">-- Pilih Kelas --</option>';
    this.classesList.forEach(c => optionsHtml += `<option value="${c.id}">${c.class_name}</option>`);

    ['student-class-filter', 'edit-student-class-id', 'exam-class-id'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = optionsHtml;
    });

    const filterStudentClass = document.getElementById("student-class-filter");
    if (filterStudentClass && this.classesList.length > 0) {
      if (!this.selectedStudentClassId || !this.classesList.find(c => c.id === this.selectedStudentClassId)) {
        this.selectedStudentClassId = this.classesList[0].id;
      }
      filterStudentClass.value = this.selectedStudentClassId;
      await this.loadStudentsTableByClass(this.selectedStudentClassId);
    }
  },

  async loadStudentsTableByClass(classId) {
    const tableBody = document.getElementById("students-table-body");
    const titleTable = document.getElementById("title-students-table");
    const titleAdd = document.getElementById("title-add-student");
    if (!tableBody) return;

    if (!classId) {
      tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Silakan pilih kelas terlebih dahulu.</td></tr>';
      return;
    }

    const cls = this.classesList.find(c => c.id === classId);
    const className = cls ? cls.class_name : 'Kelas';
    if (titleTable) titleTable.innerText = `Daftar Siswa Kelas ${className}`;
    if (titleAdd) titleAdd.innerText = `Tambah Siswa Baru ke Kelas ${className}`;

    tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Memuat data siswa kelas...</td></tr>';

    const client = getSupabaseClient();
    const { data: students, error } = await client
      .from('students')
      .select('id, attendance_number, student_number, full_name, is_active, class_id')
      .eq('class_id', classId)
      .order('attendance_number', { ascending: true });

    if (error) {
      tableBody.innerHTML = `<tr><td colspan="6" class="text-center" style="color:var(--danger-color);">${error.message}</td></tr>`;
      return;
    }

    let rowsHtml = '';
    (students || []).forEach((s) => {
      rowsHtml += `
        <tr>
          <td style="text-align: center;"><strong style="color: var(--primary-color); font-size: 1.05rem;">${s.attendance_number || '-'}</strong></td>
          <td><strong>${s.full_name}</strong></td>
          <td>${s.student_number || '-'}</td>
          <td>${className}</td>
          <td><span class="badge ${s.is_active ? 'badge-success' : 'badge-danger'}">${s.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
          <td>
            <button type="button" class="btn btn-secondary btn-sm" onclick="GuruModule.openEditStudent('${s.id}', '${s.class_id}', '${s.full_name}', '${s.student_number}', ${s.attendance_number})">Edit</button>
            <button type="button" class="btn btn-danger btn-sm" onclick="GuruModule.deleteStudent('${s.id}', '${s.full_name}')">Hapus</button>
          </td>
        </tr>
      `;
    });
    tableBody.innerHTML = rowsHtml || `<tr><td colspan="6" class="text-center text-muted">Belum ada siswa di kelas ${className}.</td></tr>`;
  },

  setupStudentEventListeners() {
    document.getElementById("student-class-filter")?.addEventListener("change", async (e) => {
      this.selectedStudentClassId = e.target.value;
      await this.loadStudentsTableByClass(this.selectedStudentClassId);
    });

    document.getElementById("btn-refresh-students")?.addEventListener("click", () => {
      if (this.selectedStudentClassId) this.loadStudentsTableByClass(this.selectedStudentClassId);
    });

    document.getElementById("form-add-student")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!this.selectedStudentClassId) return alert("Pilih kelas terlebih dahulu!");

      const absen = parseInt(document.getElementById("student-attendance-num-input").value, 10);
      const fullName = document.getElementById("student-full-name").value.trim();
      const studentNumber = document.getElementById("student-number").value.trim() || `S-${Date.now()}`;

      this.showLoader("Menambahkan data siswa...");
      const client = getSupabaseClient();
      try {
        await client.from('students').insert({
          class_id: this.selectedStudentClassId,
          attendance_number: absen,
          full_name: fullName,
          student_number: studentNumber,
          is_active: true
        });

        e.target.reset();
        await this.loadStudentsTableByClass(this.selectedStudentClassId);
        await this.loadQuickStats();
      } catch (err) {
        alert("Gagal tambah siswa: " + err.message);
      } finally {
        this.hideLoader();
      }
    });

    document.getElementById("btn-cancel-edit-student")?.addEventListener("click", () => document.getElementById("modal-edit-student").classList.add("d-none"));
    document.getElementById("form-edit-student")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("edit-student-id").value;
      const classId = document.getElementById("edit-student-class-id").value;
      const absen = parseInt(document.getElementById("edit-student-attendance-num").value, 10);
      const fullName = document.getElementById("edit-student-full-name").value.trim();
      const studentNumber = document.getElementById("edit-student-number").value.trim();

      this.showLoader("Menyimpan perubahan siswa...");
      const client = getSupabaseClient();
      try {
        await client.from('students').update({
          class_id: classId,
          attendance_number: absen,
          full_name: fullName,
          student_number: studentNumber
        }).eq('id', id);

        document.getElementById("modal-edit-student").classList.add("d-none");
        await this.loadStudentsTableByClass(this.selectedStudentClassId);
      } catch (err) {
        alert("Gagal update siswa: " + err.message);
      } finally {
        this.hideLoader();
      }
    });
  },

  openEditStudent(id, classId, fullName, studentNumber, absen) {
    document.getElementById("edit-student-id").value = id;
    document.getElementById("edit-student-class-id").value = classId;
    document.getElementById("edit-student-attendance-num").value = absen || 1;
    document.getElementById("edit-student-full-name").value = fullName;
    document.getElementById("edit-student-number").value = studentNumber || '';
    document.getElementById("modal-edit-student").classList.remove("d-none");
  },

  async deleteStudent(studentId, fullName) {
    if (!confirm(`Hapus data siswa "${fullName}"?`)) return;
    this.showLoader("Menghapus data siswa...");
    const client = getSupabaseClient();
    try {
      await client.from('students').delete().eq('id', studentId);
      if (this.selectedStudentClassId) await this.loadStudentsTableByClass(this.selectedStudentClassId);
      await this.loadQuickStats();
    } catch (err) {
      alert("Gagal hapus siswa: " + err.message);
    } finally {
      this.hideLoader();
    }
  },

  setupImportStudentEventListeners() {
    document.getElementById("btn-download-student-template")?.addEventListener("click", () => this.downloadStudentExcelTemplate());
    
    document.getElementById("btn-open-import-student-modal")?.addEventListener("click", () => {
      if (!this.selectedStudentClassId) return alert("Pilih kelas terlebih dahulu di dropdown atas!");
      const cls = this.classesList.find(c => c.id === this.selectedStudentClassId);
      document.getElementById("import-student-class-display").innerText = cls ? cls.class_name : '-';
      document.getElementById("excel-student-file-input").value = "";
      document.getElementById("import-student-preview-area").classList.add("d-none");
      document.getElementById("import-student-alert").classList.add("d-none");
      document.getElementById("btn-commit-import-student").disabled = true;
      document.getElementById("modal-import-student").classList.remove("d-none");
    });

    const closeModal = () => document.getElementById("modal-import-student").classList.add("d-none");
    document.getElementById("btn-close-modal-import-student")?.addEventListener("click", closeModal);
    document.getElementById("btn-cancel-import-student")?.addEventListener("click", closeModal);

    document.getElementById("excel-student-file-input")?.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = new Uint8Array(evt.target.result);
          const wb = XLSX.read(data, { type: 'array' });
          const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
          this.parsedExcelStudents = [];
          let rowsHtml = '';

          raw.forEach((r, idx) => {
            const absen = parseInt(r.nomor_absen || r.absen || (idx + 1), 10);
            const nama = (r.nama_siswa || r.nama || '').trim();
            const nisn = (r.nisn || r.nis || '').toString().trim();

            if (nama) {
              this.parsedExcelStudents.push({ attendance_number: absen, full_name: nama, student_number: nisn || null });
              rowsHtml += `<tr><td style="text-align:center;"><strong>${absen}</strong></td><td>${nama}</td><td>${nisn || '-'}</td></tr>`;
            }
          });

          document.getElementById("import-student-summary-text").innerText = `Pratinjau: ${this.parsedExcelStudents.length} Siswa Terbaca`;
          document.getElementById("import-student-preview-body").innerHTML = rowsHtml;
          document.getElementById("import-student-preview-area").classList.remove("d-none");
          document.getElementById("btn-commit-import-student").disabled = (this.parsedExcelStudents.length === 0);
        } catch (err) {
          alert(`Gagal membaca berkas siswa: ${err.message}`);
        }
      };
      reader.readAsArrayBuffer(file);
    });

    document.getElementById("btn-commit-import-student")?.addEventListener("click", async () => {
      if (!this.selectedStudentClassId || this.parsedExcelStudents.length === 0) return;
      
      this.showLoader(`Mengunggah ${this.parsedExcelStudents.length} data siswa...`);
      const client = getSupabaseClient();
      try {
        const payload = this.parsedExcelStudents.map(s => ({
          class_id: this.selectedStudentClassId,
          attendance_number: s.attendance_number,
          full_name: s.full_name,
          student_number: s.student_number || `S-${Date.now()}-${s.attendance_number}`,
          is_active: true
        }));

        const { error } = await client.from('students').insert(payload);
        if (error) throw error;

        this.hideLoader();
        alert(`Berhasil mengimpor ${payload.length} siswa!`);
        closeModal();
        await this.loadStudentsTableByClass(this.selectedStudentClassId);
        await this.loadQuickStats();
      } catch (err) {
        this.hideLoader();
        alert(`Gagal import siswa: ${err.message}`);
      }
    });
  },

  async loadClassesTable() {
    const client = getSupabaseClient();
    const tableBody = document.getElementById("classes-table-body");
    const { data: classes } = await client.from('classes').select('*').eq('teacher_id', this.currentTeacher.id).order('class_name', { ascending: true });

    let rowsHtml = '';
    (classes || []).forEach((c, idx) => {
      rowsHtml += `
        <tr>
          <td>${idx + 1}</td>
          <td><strong>${c.class_name}</strong></td>
          <td>-</td>
          <td>${new Date(c.created_at).toLocaleDateString('id-ID')}</td>
          <td>
            <button type="button" class="btn btn-secondary btn-sm" onclick="GuruModule.openEditClass('${c.id}', '${c.class_name}')">Edit</button>
            <button type="button" class="btn btn-danger btn-sm" onclick="GuruModule.deleteClass('${c.id}', '${c.class_name}')">Hapus</button>
          </td>
        </tr>
      `;
    });
    if (tableBody) tableBody.innerHTML = rowsHtml || '<tr><td colspan="5" class="text-center text-muted">Belum ada kelas.</td></tr>';
  },

  setupClassEventListeners() {
    document.getElementById("form-add-class")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("new-class-name").value.trim();
      this.showLoader("Menambahkan kelas baru...");
      const client = getSupabaseClient();
      try {
        await client.from('classes').insert({ teacher_id: this.currentTeacher.id, class_name: name });
        e.target.reset();
        await this.loadClassesTable();
        await this.loadClassesDropdown();
        await this.loadQuickStats();
      } catch (err) {
        alert("Gagal tambah kelas: " + err.message);
      } finally {
        this.hideLoader();
      }
    });

    document.getElementById("btn-cancel-edit-class")?.addEventListener("click", () => document.getElementById("modal-edit-class").classList.add("d-none"));
    document.getElementById("form-edit-class")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("edit-class-id").value;
      const name = document.getElementById("edit-class-name").value.trim();
      this.showLoader("Menyimpan kelas...");
      const client = getSupabaseClient();
      try {
        await client.from('classes').update({ class_name: name }).eq('id', id);
        document.getElementById("modal-edit-class").classList.add("d-none");
        await this.loadClassesTable();
        await this.loadClassesDropdown();
      } catch (err) {
        alert("Gagal edit kelas: " + err.message);
      } finally {
        this.hideLoader();
      }
    });
  },

  openEditClass(id, name) {
    document.getElementById("edit-class-id").value = id;
    document.getElementById("edit-class-name").value = name;
    document.getElementById("modal-edit-class").classList.remove("d-none");
  },

  async deleteClass(id, name) {
    if (!confirm(`Hapus kelas "${name}"?`)) return;
    this.showLoader("Menghapus kelas...");
    const client = getSupabaseClient();
    try {
      await client.from('classes').delete().eq('id', id);
      await this.loadClassesTable();
      await this.loadClassesDropdown();
      await this.loadQuickStats();
    } catch (err) {
      alert("Gagal hapus kelas: " + err.message);
    } finally {
      this.hideLoader();
    }
  },

  generateExamToken() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let token = "";
    for (let i = 0; i < 6; i++) token += chars.charAt(Math.floor(Math.random() * chars.length));
    return token;
  },

  async loadExamsTable() {
    const client = getSupabaseClient();
    const tableBody = document.getElementById("exams-table-body");
    const { data: exams } = await client.from('exams').select('*, classes(class_name)').eq('teacher_id', this.currentTeacher.id).order('created_at', { ascending: false });

    this.examsList = exams || [];
    let rowsHtml = '';
    this.examsList.forEach((ex, idx) => {
      const antiCheatBadge = ex.anti_cheat !== false
        ? `<span class="badge badge-success" title="Maksimal: ${ex.max_violations || 3}x">🛡️ ON (${ex.max_violations || 3}x)</span>`
        : '<span class="badge badge-secondary">OFF</span>';

      rowsHtml += `
        <tr>
          <td>${idx + 1}</td>
          <td><strong>${ex.title}</strong><small style="display:block; color:var(--text-muted);">${ex.subject || '-'}</small></td>
          <td>${ex.classes ? ex.classes.class_name : 'Semua Kelas'}</td>
          <td><span style="font-family: monospace; font-weight: bold; background: #e0e7ff; padding: 2px 6px; border-radius: 4px;">${ex.token}</span></td>
          <td>${ex.duration_minutes} mnt</td>
          <td><small>${ex.randomize_questions ? 'Soal' : ''} ${ex.randomize_options ? '& Opsi' : ''}</small></td>
          <td>${antiCheatBadge}</td>
          <td><span class="badge ${ex.is_active ? 'badge-success' : 'badge-danger'}">${ex.is_active ? 'Aktif' : 'Tutup'}</span></td>
          <td>
            <button type="button" class="btn btn-secondary btn-sm" title="Edit Pengaturan" onclick="GuruModule.openEditExamSettingsModal('${ex.id}')">⚙️ Atur</button>
            <button type="button" class="btn ${ex.is_active ? 'btn-warning' : 'btn-secondary'} btn-sm" onclick="GuruModule.toggleExamStatus('${ex.id}', ${ex.is_active})">${ex.is_active ? 'Tutup' : 'Buka'}</button>
            <button type="button" class="btn btn-danger btn-sm" onclick="GuruModule.deleteExam('${ex.id}', '${ex.title}')">Hapus</button>
          </td>
        </tr>
      `;
    });
    if (tableBody) tableBody.innerHTML = rowsHtml || '<tr><td colspan="9" class="text-center text-muted">Belum ada ujian.</td></tr>';
  },

  openEditExamSettingsModal(examId) {
    const exam = this.examsList.find(e => e.id === examId);
    if (!exam) return;

    document.getElementById("edit-exam-id").value = exam.id;
    document.getElementById("edit-exam-title-display").innerText = `${exam.title} (${exam.subject || '-'})`;
    document.getElementById("edit-exam-token").value = exam.token || '';
    document.getElementById("edit-exam-randomize-questions").checked = (exam.randomize_questions !== false && exam.randomize_questions !== 'false');
    document.getElementById("edit-exam-randomize-options").checked = (exam.randomize_options !== false && exam.randomize_options !== 'false');
    document.getElementById("edit-exam-anti-cheat").checked = (exam.anti_cheat !== false && exam.anti_cheat !== 'false');
    document.getElementById("edit-exam-max-violations").value = exam.max_violations || 3;
    document.getElementById("modal-edit-exam-settings").classList.remove("d-none");
  },

  setupExamEventListeners() {
    const modal = document.getElementById("modal-create-exam");
    document.getElementById("btn-open-modal-exam")?.addEventListener("click", () => {
      document.getElementById("form-create-exam").reset();
      document.getElementById("exam-token").value = this.generateExamToken();
      document.getElementById("exam-randomize-questions").checked = true;
      document.getElementById("exam-randomize-options").checked = true;
      document.getElementById("exam-anti-cheat").checked = true;
      modal.classList.remove("d-none");
    });

    const closeModal = () => modal.classList.add("d-none");
    document.getElementById("btn-close-modal-exam")?.addEventListener("click", closeModal);
    document.getElementById("btn-cancel-create-exam")?.addEventListener("click", closeModal);
    document.getElementById("btn-generate-token")?.addEventListener("click", () => {
      document.getElementById("exam-token").value = this.generateExamToken();
    });

    document.getElementById("form-create-exam")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = document.getElementById("exam-title").value.trim();
      const subject = document.getElementById("exam-subject").value.trim();
      const desc = document.getElementById("exam-description").value.trim();
      const classId = document.getElementById("exam-class-id").value;
      const duration = parseInt(document.getElementById("exam-duration").value, 10);
      const token = document.getElementById("exam-token").value.trim().toUpperCase();
      
      const randomizeQ = Boolean(document.getElementById("exam-randomize-questions").checked);
      const randomizeOpt = Boolean(document.getElementById("exam-randomize-options").checked);
      const antiCheat = Boolean(document.getElementById("exam-anti-cheat").checked);
      const maxViolations = parseInt(document.getElementById("exam-max-violations").value, 10) || 3;

      this.showLoader("Menerbitkan ujian baru...");
      const client = getSupabaseClient();
      try {
        await client.from('exams').insert({
          teacher_id: this.currentTeacher.id,
          class_id: classId,
          title: title,
          subject: subject,
          description: desc,
          duration_minutes: duration,
          token: token,
          randomize_questions: randomizeQ,
          randomize_options: randomizeOpt,
          anti_cheat: antiCheat,
          max_violations: maxViolations,
          is_active: true
        });

        closeModal();
        await this.loadExamsTable();
        await this.loadBankSoalExamFilter();
        await this.loadQuickStats();
      } catch (err) {
        alert("Gagal menerbitkan ujian: " + err.message);
      } finally {
        this.hideLoader();
      }
    });

    const modalEditSettings = document.getElementById("modal-edit-exam-settings");
    const closeEditSettings = () => modalEditSettings.classList.add("d-none");
    document.getElementById("btn-close-modal-edit-exam-settings")?.addEventListener("click", closeEditSettings);
    document.getElementById("btn-cancel-edit-exam-settings")?.addEventListener("click", closeEditSettings);

    document.getElementById("btn-generate-edit-token")?.addEventListener("click", () => {
      document.getElementById("edit-exam-token").value = this.generateExamToken();
    });

    document.getElementById("form-edit-exam-settings")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const examId = document.getElementById("edit-exam-id").value;
      const newToken = document.getElementById("edit-exam-token").value.trim().toUpperCase();
      const randomizeQ = Boolean(document.getElementById("edit-exam-randomize-questions").checked);
      const randomizeOpt = Boolean(document.getElementById("edit-exam-randomize-options").checked);
      const antiCheat = Boolean(document.getElementById("edit-exam-anti-cheat").checked);
      const maxViolations = parseInt(document.getElementById("edit-exam-max-violations").value, 10) || 3;

      if (!newToken) return alert("Token ujian tidak boleh kosong!");

      this.showLoader("Memperbarui pengaturan ujian...");
      const client = getSupabaseClient();
      try {
        await client.from('exams').update({
          token: newToken,
          randomize_questions: randomizeQ,
          randomize_options: randomizeOpt,
          anti_cheat: antiCheat,
          max_violations: maxViolations
        }).eq('id', examId);

        closeEditSettings();
        await this.loadExamsTable();
        alert(`Pengaturan berhasil disimpan! Token: "${newToken}"`);
      } catch (err) {
        alert(`Gagal update: ${err.message}`);
      } finally {
        this.hideLoader();
      }
    });
  },

  async toggleExamStatus(examId, currentStatus) {
    this.showLoader("Mengubah status ujian...");
    const client = getSupabaseClient();
    try {
      await client.from('exams').update({ is_active: !currentStatus }).eq('id', examId);
      await this.loadExamsTable();
    } catch (err) {
      alert("Gagal ubah status: " + err.message);
    } finally {
      this.hideLoader();
    }
  },

  async deleteExam(examId, title) {
    if (!confirm(`Hapus ujian "${title}"? Seluruh butir soal di dalamnya akan terhapus.`)) return;
    this.showLoader("Menghapus ujian...");
    const client = getSupabaseClient();
    try {
      await client.from('exams').delete().eq('id', examId);
      await this.loadExamsTable();
      await this.loadBankSoalExamFilter();
      await this.loadQuickStats();
    } catch (err) {
      alert("Gagal hapus ujian: " + err.message);
    } finally {
      this.hideLoader();
    }
  },

  setExamActive(examId, title) {
    this.selectedExamId = examId;
    this.selectedExamTitle = title;
    this.syncActiveExamToQuestionForm();
  },

  goToAddQuestionWithStimulus(stimulusId, title = '') {
    this.targetStimulusId = stimulusId;
    this.targetStimulusTitle = title;
    const linkTambahSoal = document.querySelector('.sidebar-menu .nav-link[data-target="panel-tambah-soal"]');
    if (linkTambahSoal) linkTambahSoal.click();
  },

  setupBulkScoreEventListeners() {
    const modal = document.getElementById("modal-bulk-score");
    const closeModal = () => modal.classList.add("d-none");

    document.getElementById("btn-open-modal-bulk-score")?.addEventListener("click", () => {
      if (!this.selectedExamId) return alert("Pilih sesi ujian terlebih dahulu di dropdown atas!");
      modal.classList.remove("d-none");
    });

    document.getElementById("btn-close-modal-bulk-score")?.addEventListener("click", closeModal);
    document.getElementById("btn-cancel-bulk-score")?.addEventListener("click", closeModal);

    document.getElementById("form-bulk-score")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!this.selectedExamId) return;

      const scorePg = parseFloat(document.getElementById("bulk-score-pg").value);
      const scorePgkFull = parseFloat(document.getElementById("bulk-score-pgk-full").value);
      const scorePgkErr1 = parseFloat(document.getElementById("bulk-score-pgk-err1").value);
      const scorePgkErr2 = parseFloat(document.getElementById("bulk-score-pgk-err2").value);
      const scorePgkErr3 = parseFloat(document.getElementById("bulk-score-pgk-err3").value);

      this.showLoader("Menerapkan skor massal...");
      const client = getSupabaseClient();
      try {
        await client.from('questions')
          .update({ points: isNaN(scorePg) ? 2.0 : scorePg })
          .eq('exam_id', this.selectedExamId)
          .eq('question_type', 'pg');

        await client.from('questions')
          .update({
            points: isNaN(scorePgkFull) ? 4.0 : scorePgkFull,
            pgk_score_err1: isNaN(scorePgkErr1) ? 0 : scorePgkErr1,
            pgk_score_err2: isNaN(scorePgkErr2) ? 0 : scorePgkErr2,
            pgk_score_err3: isNaN(scorePgkErr3) ? 0 : scorePgkErr3
          })
          .eq('exam_id', this.selectedExamId)
          .eq('question_type', 'pgk');

        this.hideLoader();
        alert("✅ Skor seluruh butir PG & PGK berhasil disamakan!");
        closeModal();
        await this.loadBankSoalContent(this.selectedExamId);
      } catch (err) {
        this.hideLoader();
        alert(`Gagal: ${err.message}`);
      }
    });
  },

  async loadBankSoalExamFilter() {
    const filterSelect = document.getElementById("bank-exam-filter");
    const importSelect = document.getElementById("import-exam-select");
    const questionExamSelect = document.getElementById("question-exam-select");
    const client = getSupabaseClient();

    const { data: exams } = await client.from('exams').select('id, title, subject').eq('teacher_id', this.currentTeacher.id).order('created_at', { ascending: false });
    this.examsList = exams || [];

    let opts = '<option value="">-- Pilih Sesi Ujian --</option>';
    this.examsList.forEach(e => opts += `<option value="${e.id}">${e.title} (${e.subject || '-'})</option>`);

    if (filterSelect) filterSelect.innerHTML = opts;
    if (importSelect) importSelect.innerHTML = opts;
    if (questionExamSelect) questionExamSelect.innerHTML = opts;

    if (this.examsList.length > 0) {
      if (!this.selectedExamId || !this.examsList.find(e => e.id === this.selectedExamId)) {
        const first = this.examsList[0];
        if (filterSelect) filterSelect.value = first.id;
        if (importSelect) importSelect.value = first.id;
        if (questionExamSelect) questionExamSelect.value = first.id;
        this.setExamActive(first.id, `${first.title} (${first.subject || '-'})`);
        await this.loadBankSoalContent(first.id);
      } else {
        if (filterSelect) filterSelect.value = this.selectedExamId;
        if (importSelect) importSelect.value = this.selectedExamId;
        if (questionExamSelect) questionExamSelect.value = this.selectedExamId;
        await this.loadBankSoalContent(this.selectedExamId);
      }
    }
  },

  setupBankSoalEventListeners() {
    document.getElementById("bank-exam-filter")?.addEventListener("change", (e) => {
      const val = e.target.value;
      const txt = e.target.options[e.target.selectedIndex]?.text || '';
      this.setExamActive(val, txt);
      this.loadBankSoalContent(val);
    });

    document.getElementById("btn-goto-tambah-soal")?.addEventListener("click", () => {
      const linkTambahSoal = document.querySelector('.sidebar-menu .nav-link[data-target="panel-tambah-soal"]');
      if (linkTambahSoal) linkTambahSoal.click();
    });

    document.getElementById("btn-renumber-questions")?.addEventListener("click", () => {
      if (!this.selectedExamId) return alert("Pilih ujian terlebih dahulu!");
      this.renumberAllQuestions(this.selectedExamId);
    });
  },

  async loadBankSoalContent(examId) {
    const container = document.getElementById("bank-soal-list-container");
    const statsContainer = document.getElementById("bank-stats-container");
    if (!container) return;

    if (!examId) {
      container.innerHTML = '<div class="card text-center" style="padding: 30px;"><p class="text-muted">Silakan pilih salah satu sesi ujian di atas.</p></div>';
      if (statsContainer) statsContainer.classList.add("d-none");
      return;
    }

    const client = getSupabaseClient();
    const { data: stimulusGroups } = await client.from('stimulus_groups').select('*').eq('exam_id', examId);
    const { data: questions } = await client.from('questions').select('*, options(*)').eq('exam_id', examId).order('original_number', { ascending: true });

    if (statsContainer) {
      statsContainer.classList.remove("d-none");
      const totalQ = questions ? questions.length : 0;
      const totalStim = stimulusGroups ? stimulusGroups.length : 0;
      let pgCount = 0;
      let pgkCount = 0;
      let totalPoints = 0;

      (questions || []).forEach(q => {
        if (q.question_type === 'pgk') pgkCount++;
        else pgCount++;
        totalPoints += parseFloat(q.points) || 1.0;
      });

      document.getElementById("stat-bank-total-questions").innerText = totalQ;
      document.getElementById("stat-bank-types-detail").innerText = `(${pgCount} Pilihan Ganda | ${pgkCount} PGK)`;
      document.getElementById("stat-bank-total-stimulus").innerText = totalStim;
      document.getElementById("stat-bank-total-points").innerText = totalPoints.toFixed(1).replace(/\.0$/, '');
    }

    let contentHtml = '';
    (stimulusGroups || []).forEach(stim => {
      const stimQs = (questions || []).filter(q => q.stimulus_group_id === stim.id);
      
      const stimImgHtml = stim.image_url 
        ? `<div style="text-align: center; margin: 10px 0;"><img src="${stim.image_url}" alt="Gambar Stimulus" style="max-height: 220px; max-width: 100%; border-radius: 6px; border: 1px solid var(--border-color);"></div>` 
        : '';

      contentHtml += `
        <div class="card" style="border-left: 4px solid var(--primary-color); margin-bottom: 20px;">
          <div class="card-header" style="background: #f1f5f9; margin: -24px -24px 15px -24px; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <strong>Wacana: ${stim.title}</strong>
            <div style="display: flex; gap: 6px;">
              <button type="button" class="btn btn-primary btn-sm" onclick="GuruModule.goToAddQuestionWithStimulus('${stim.id}', '${stim.title}')">+ Tambah Soal di Wacana Ini</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="GuruModule.openEditStimulusModal('${stim.id}')">Edit</button>
              <button type="button" class="btn btn-danger btn-sm" onclick="GuruModule.deleteStimulusGroup('${stim.id}', '${examId}')">Hapus</button>
            </div>
          </div>
          ${stimImgHtml}
          <p style="white-space: pre-line; margin-bottom: 12px;">${stim.content || ''}</p>
          <div style="display: flex; flex-direction: column; gap: 10px;">${stimQs.map(q => this.renderQuestionItem(q, examId)).join('')}</div>
        </div>
      `;
    });

    const standalones = (questions || []).filter(q => !q.stimulus_group_id);
    if (standalones.length > 0) {
      contentHtml += `
        <div class="card">
          <div class="card-header"><span class="card-title">Soal Mandiri (${standalones.length} Soal)</span></div>
          <div style="display: flex; flex-direction: column; gap: 10px;">${standalones.map(q => this.renderQuestionItem(q, examId)).join('')}</div>
        </div>
      `;
    }

    container.innerHTML = contentHtml || '<div class="card text-center" style="padding: 30px;"><p class="text-muted">Belum ada butir soal pada ujian ini.</p></div>';
    this.renderMath(container);
  },

  renderQuestionItem(q, examId) {
    let opts = '';
    (q.options || []).forEach(o => {
      opts += `<div style="${o.is_correct ? 'color: var(--success-color); font-weight: bold;' : ''}">${o.is_correct ? '✓ ' : ''}<strong>${o.option_label}.</strong> ${o.content}</div>`;
    });

    const isPgk = q.question_type === 'pgk';
    const err1Val = q.pgk_score_err1 !== null ? q.pgk_score_err1 : 0;
    const err2Val = q.pgk_score_err2 !== null ? q.pgk_score_err2 : 0;
    const err3Val = q.pgk_score_err3 !== null ? q.pgk_score_err3 : 0;

    const scoreBadge = isPgk
      ? `<small style="display:block; color: #854d0e; font-size: 0.8rem; margin-top: 2px;">(Benar: ${q.points}p | Salah 1: ${err1Val}p | Salah 2: ${err2Val}p | Salah 3: ${err3Val}p)</small>`
      : `<small style="color: var(--text-muted); font-size: 0.8rem;">(${q.points} Poin)</small>`;

    const qImgHtml = q.image_url 
      ? `<div style="text-align: center; margin: 10px 0;"><img src="${q.image_url}" alt="Gambar Soal" style="max-height: 200px; max-width: 100%; border-radius: 6px; border: 1px solid var(--border-color);"></div>` 
      : '';

    return `
      <div style="border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; background: #ffffff;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <strong>No. ${q.original_number} (${q.question_type.toUpperCase()})</strong>
            ${scoreBadge}
          </div>
          <div>
            <button type="button" class="btn btn-secondary btn-sm" onclick="GuruModule.openEditQuestionModal('${q.id}', '${examId}')">Edit</button>
            <button type="button" class="btn btn-danger btn-sm" onclick="GuruModule.deleteQuestion('${q.id}', '${examId}')">Hapus</button>
          </div>
        </div>
        ${qImgHtml}
        <p style="white-space: pre-line; margin: 8px 0;">${q.content}</p>
        <div style="background: #f8fafc; padding: 8px; border-radius: 4px;">${opts || '<em class="text-muted">Pilihan jawaban belum diisi.</em>'}</div>
      </div>
    `;
  },

  async deleteQuestion(id, examId) {
    if (!confirm("Hapus butir soal ini?")) return;
    this.showLoader("Menghapus butir soal...");
    const client = getSupabaseClient();
    try {
      await client.from('questions').delete().eq('id', id);
      await this.loadBankSoalContent(examId);
    } catch (err) {
      alert("Gagal hapus soal: " + err.message);
    } finally {
      this.hideLoader();
    }
  },

  async deleteStimulusGroup(id, examId) {
    if (!confirm("Hapus stimulus ini? Soal di dalamnya akan tetap disimpan sebagai soal mandiri.")) return;
    this.showLoader("Menghapus stimulus wacana...");
    const client = getSupabaseClient();
    try {
      await client.from('stimulus_groups').delete().eq('id', id);
      await this.loadBankSoalContent(examId);
    } catch (err) {
      alert("Gagal hapus stimulus: " + err.message);
    } finally {
      this.hideLoader();
    }
  },

  // FIX: BUAT STIMULUS DENGAN UPLOAD GAMBAR LANGSUNG
  setupStimulusEventListeners() {
    document.getElementById("btn-open-modal-stimulus")?.addEventListener("click", () => {
      if (!this.selectedExamId) return alert("Pilih sesi ujian terlebih dahulu di dropdown!");
      document.getElementById("form-create-stimulus").reset();
      document.getElementById("modal-create-stimulus").classList.remove("d-none");
    });
    document.getElementById("btn-cancel-create-stimulus")?.addEventListener("click", () => document.getElementById("modal-create-stimulus").classList.add("d-none"));
    document.getElementById("btn-close-modal-stimulus")?.addEventListener("click", () => document.getElementById("modal-create-stimulus").classList.add("d-none"));

    document.getElementById("form-create-stimulus")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = document.getElementById("stimulus-title").value.trim();
      const content = document.getElementById("stimulus-content").value.trim();
      const fileInput = document.getElementById("stimulus-image-file");
      let imageUrl = document.getElementById("stimulus-image-url").value.trim() || null;

      this.showLoader("Menyimpan stimulus wacana...");
      const client = getSupabaseClient();
      try {
        if (fileInput && fileInput.files[0]) {
          this.showLoader("Mengunggah gambar stimulus...");
          imageUrl = await this.uploadImageFile(fileInput.files[0], 'stimulus');
        }

        await client.from('stimulus_groups').insert({
          exam_id: this.selectedExamId,
          title: title,
          content: content,
          image_url: imageUrl
        });

        document.getElementById("modal-create-stimulus").classList.add("d-none");
        await this.loadBankSoalContent(this.selectedExamId);
      } catch (err) {
        alert("Gagal simpan stimulus: " + err.message);
      } finally {
        this.hideLoader();
      }
    });

    document.getElementById("btn-cancel-edit-stimulus")?.addEventListener("click", () => document.getElementById("modal-edit-stimulus").classList.add("d-none"));
    document.getElementById("btn-close-modal-edit-stimulus")?.addEventListener("click", () => document.getElementById("modal-edit-stimulus").classList.add("d-none"));
    
    document.getElementById("form-edit-stimulus")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("edit-stimulus-id").value;
      const title = document.getElementById("edit-stimulus-title").value.trim();
      const content = document.getElementById("edit-stimulus-content").value.trim();
      const fileInput = document.getElementById("edit-stimulus-image-file");
      let imageUrl = document.getElementById("edit-stimulus-image-url").value.trim() || null;

      this.showLoader("Memperbarui stimulus...");
      const client = getSupabaseClient();
      try {
        if (fileInput && fileInput.files[0]) {
          this.showLoader("Mengunggah gambar stimulus baru...");
          imageUrl = await this.uploadImageFile(fileInput.files[0], 'stimulus');
        }

        await client.from('stimulus_groups').update({
          title: title,
          content: content,
          image_url: imageUrl
        }).eq('id', id);

        document.getElementById("modal-edit-stimulus").classList.add("d-none");
        await this.loadBankSoalContent(this.selectedExamId);
      } catch (err) {
        alert("Gagal update stimulus: " + err.message);
      } finally {
        this.hideLoader();
      }
    });
  },

  async openEditStimulusModal(id) {
    const client = getSupabaseClient();
    const { data: s } = await client.from('stimulus_groups').select('*').eq('id', id).single();
    document.getElementById("edit-stimulus-id").value = s.id;
    document.getElementById("edit-stimulus-title").value = s.title;
    document.getElementById("edit-stimulus-content").value = s.content;
    document.getElementById("edit-stimulus-image-url").value = s.image_url || '';
    document.getElementById("edit-stimulus-image-file").value = "";
    document.getElementById("modal-edit-stimulus").classList.remove("d-none");
  },

  async loadStimulusDropdown(examId, selectId = "question-stimulus-id") {
    const sel = document.getElementById(selectId);
    if (!sel || !examId) return;
    const client = getSupabaseClient();
    const { data: groups } = await client.from('stimulus_groups').select('id, title').eq('exam_id', examId);
    let opts = '<option value="">-- Soal Mandiri (Tanpa Stimulus) --</option>';
    (groups || []).forEach(g => opts += `<option value="${g.id}">${g.title}</option>`);
    sel.innerHTML = opts;

    if (this.targetStimulusId && selectId === "question-stimulus-id") {
      sel.value = this.targetStimulusId;
    }
  },

  async syncActiveExamToQuestionForm() {
    const examSelect = document.getElementById("question-exam-select");
    const hiddenExamId = document.getElementById("question-exam-id");

    if (examSelect && this.examsList.length > 0) {
      let opts = '<option value="">-- Pilih Sesi Ujian --</option>';
      this.examsList.forEach(e => opts += `<option value="${e.id}">${e.title} (${e.subject || '-'})</option>`);
      examSelect.innerHTML = opts;

      if (this.selectedExamId) {
        examSelect.value = this.selectedExamId;
      } else {
        this.selectedExamId = this.examsList[0].id;
        this.selectedExamTitle = `${this.examsList[0].title} (${this.examsList[0].subject || '-'})`;
        examSelect.value = this.selectedExamId;
      }
    }

    if (hiddenExamId) hiddenExamId.value = this.selectedExamId || "";

    if (this.selectedExamId) {
      await this.loadStimulusDropdown(this.selectedExamId, "question-stimulus-id");
      const numInput = document.getElementById("question-number");
      if (numInput) {
        numInput.value = await this.getSuggestedQuestionNumber(this.selectedExamId, this.targetStimulusId);
      }
    }
  },

  // FIX: BUAT SOAL MANUAL DENGAN UPLOAD GAMBAR KE STORAGE
  setupQuestionFormEventListeners() {
    document.getElementById("btn-back-to-bank")?.addEventListener("click", () => {
      const bankLink = document.querySelector('.sidebar-menu .nav-link[data-target="panel-bank-soal"]');
      if (bankLink) bankLink.click();
    });

    document.getElementById("question-exam-select")?.addEventListener("change", async (e) => {
      const examId = e.target.value;
      const title = e.target.options[e.target.selectedIndex]?.text || '';
      this.selectedExamId = examId;
      this.selectedExamTitle = title;
      document.getElementById("question-exam-id").value = examId;
      this.targetStimulusId = null;

      if (examId) {
        await this.loadStimulusDropdown(examId, "question-stimulus-id");
        document.getElementById("question-number").value = await this.getSuggestedQuestionNumber(examId);
      }
    });

    document.getElementById("question-type")?.addEventListener("change", (e) => {
      const isPgk = e.target.value === 'pgk';
      const pgkBox = document.getElementById("create-pgk-scores-wrap");
      if (pgkBox) pgkBox.classList.toggle("d-none", !isPgk);

      document.querySelectorAll("#options-inputs-container .option-key-input").forEach(i => {
        i.type = isPgk ? 'checkbox' : 'radio';
        if (!isPgk) i.name = "correct_key";
        else i.removeAttribute("name");
      });
    });

    document.getElementById("form-create-question")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const examId = document.getElementById("question-exam-select")?.value || this.selectedExamId;
      
      if (!examId) return alert("Silakan pilih Target Sesi Ujian di dropdown atas terlebih dahulu!");

      const stimId = document.getElementById("question-stimulus-id").value || null;
      const num = parseInt(document.getElementById("question-number").value, 10);
      const type = document.getElementById("question-type").value;
      const points = parseFloat(document.getElementById("question-points").value);
      
      const isPgk = type === 'pgk';
      const rawErr1 = parseFloat(document.getElementById("question-pgk-err1").value);
      const rawErr2 = parseFloat(document.getElementById("question-pgk-err2").value);
      const rawErr3 = parseFloat(document.getElementById("question-pgk-err3").value);

      const pgkErr1 = isPgk ? (isNaN(rawErr1) ? 0 : rawErr1) : 0;
      const pgkErr2 = isPgk ? (isNaN(rawErr2) ? 0 : rawErr2) : 0;
      const pgkErr3 = isPgk ? (isNaN(rawErr3) ? 0 : rawErr3) : 0;

      const content = document.getElementById("question-content").value.trim();
      const fileInput = document.getElementById("question-image-file");
      let imageUrl = document.getElementById("question-image-url").value.trim() || null;

      const textInputs = document.querySelectorAll("#options-inputs-container .option-text-input");
      const keyInputs = document.querySelectorAll("#options-inputs-container .option-key-input");

      const options = [];
      const correctKeys = [];
      textInputs.forEach((txt, idx) => {
        const val = txt.value.trim();
        const lbl = txt.getAttribute("data-label");
        const isCor = keyInputs[idx].checked;
        if (val) {
          if (isCor) correctKeys.push(lbl);
          options.push({ option_label: lbl, content: val, is_correct: isCor });
        }
      });

      if (options.length < 2) return alert("Pilihan jawaban minimal harus terisi 2 opsi!");
      if (correctKeys.length === 0) return alert("Pilih minimal 1 kunci jawaban benar!");

      this.showLoader("Menyimpan butir soal...");

      try {
        if (fileInput && fileInput.files[0]) {
          this.showLoader("Mengunggah gambar butir soal...");
          imageUrl = await this.uploadImageFile(fileInput.files[0], 'questions');
        }

        await this.shiftQuestionsUp(examId, num);

        const client = getSupabaseClient();
        const { data: newQ, error: qErr } = await client.from('questions').insert({
          exam_id: examId,
          stimulus_group_id: stimId,
          original_number: num,
          question_type: type,
          points: isNaN(points) ? 4.0 : points,
          pgk_score_err1: pgkErr1,
          pgk_score_err2: pgkErr2,
          pgk_score_err3: pgkErr3,
          image_url: imageUrl,
          content: content,
          correct_keys: correctKeys
        }).select().single();

        if (qErr) throw qErr;

        const opts = options.map(o => ({
          question_id: newQ.id,
          option_label: o.option_label,
          content: o.content,
          is_correct: o.is_correct
        }));

        const { error: optErr } = await client.from('options').insert(opts);
        if (optErr) throw optErr;

        document.getElementById("question-content").value = "";
        document.getElementById("question-image-url").value = "";
        if (fileInput) fileInput.value = "";
        textInputs.forEach(i => i.value = "");
        document.getElementById("question-number").value = num + 1;

        this.hideLoader();
        alert(`Butir Soal No. ${num} berhasil disimpan!`);
        await this.loadBankSoalContent(examId);
      } catch (err) {
        this.hideLoader();
        alert(`Gagal menyimpan butir soal: ${err.message}`);
      }
    });
  },

  async openEditQuestionModal(qId, examId) {
    const modal = document.getElementById("modal-edit-question");
    modal.classList.remove("d-none");
    await this.loadStimulusDropdown(examId, "edit-q-stimulus-id");

    const client = getSupabaseClient();
    const { data: q } = await client.from('questions').select('*, options(*)').eq('id', qId).single();

    document.getElementById("edit-q-id").value = q.id;
    document.getElementById("edit-q-exam-id").value = q.exam_id;
    document.getElementById("edit-q-stimulus-id").value = q.stimulus_group_id || "";
    document.getElementById("edit-q-number").value = q.original_number;
    document.getElementById("edit-q-type").value = q.question_type;
    document.getElementById("edit-q-points").value = q.points;
    document.getElementById("edit-q-image-url").value = q.image_url || '';
    document.getElementById("edit-q-image-file").value = "";
    
    document.getElementById("edit-q-pgk-err1").value = (q.pgk_score_err1 !== null && q.pgk_score_err1 !== undefined) ? q.pgk_score_err1 : 0;
    document.getElementById("edit-q-pgk-err2").value = (q.pgk_score_err2 !== null && q.pgk_score_err2 !== undefined) ? q.pgk_score_err2 : 0;
    document.getElementById("edit-q-pgk-err3").value = (q.pgk_score_err3 !== null && q.pgk_score_err3 !== undefined) ? q.pgk_score_err3 : 0;

    const isPgk = q.question_type === 'pgk';
    document.getElementById("edit-pgk-scores-wrap").classList.toggle("d-none", !isPgk);

    document.getElementById("edit-q-content").value = q.content;

    const optMap = {};
    (q.options || []).forEach(o => optMap[o.option_label] = o);

    let html = '';
    ['A', 'B', 'C', 'D', 'E', 'F'].forEach(lbl => {
      const o = optMap[lbl] || { content: '', is_correct: false };
      html += `
        <div style="display: flex; align-items: center; gap: 10px;">
          <input type="${isPgk ? 'checkbox' : 'radio'}" ${isPgk ? '' : 'name="edit_key"'} class="edit-opt-key" value="${lbl}" ${o.is_correct ? 'checked' : ''}>
          <strong>${lbl}.</strong>
          <input type="text" class="edit-opt-text" data-label="${lbl}" value="${o.content}" placeholder="Teks pilihan ${lbl}..." style="flex-grow: 1;">
        </div>
      `;
    });
    document.getElementById("edit-options-container").innerHTML = html;
  },

  // FIX: EDIT SOAL BISA GANTI/UPLOAD GAMBAR BARU
  setupEditQuestionEventListeners() {
    document.getElementById("btn-cancel-edit-q")?.addEventListener("click", () => document.getElementById("modal-edit-question").classList.add("d-none"));
    document.getElementById("btn-close-modal-edit-q")?.addEventListener("click", () => document.getElementById("modal-edit-question").classList.add("d-none"));

    document.getElementById("edit-q-type")?.addEventListener("change", (e) => {
      const isPgk = e.target.value === 'pgk';
      document.getElementById("edit-pgk-scores-wrap").classList.toggle("d-none", !isPgk);
      document.querySelectorAll(".edit-opt-key").forEach(i => {
        i.type = isPgk ? 'checkbox' : 'radio';
        if (!isPgk) i.name = "edit_key";
        else i.removeAttribute("name");
      });
    });

    document.getElementById("form-edit-question")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const qId = document.getElementById("edit-q-id").value;
      const examId = document.getElementById("edit-q-exam-id").value;
      const stimId = document.getElementById("edit-q-stimulus-id").value || null;
      const num = parseInt(document.getElementById("edit-q-number").value, 10);
      const type = document.getElementById("edit-q-type").value;
      const points = parseFloat(document.getElementById("edit-q-points").value);
      const fileInput = document.getElementById("edit-q-image-file");
      let imageUrl = document.getElementById("edit-q-image-url").value.trim() || null;
      
      const isPgk = type === 'pgk';
      const rawErr1 = parseFloat(document.getElementById("edit-q-pgk-err1").value);
      const rawErr2 = parseFloat(document.getElementById("edit-q-pgk-err2").value);
      const rawErr3 = parseFloat(document.getElementById("edit-q-pgk-err3").value);

      const pgkErr1 = isPgk ? (isNaN(rawErr1) ? 0 : rawErr1) : 0;
      const pgkErr2 = isPgk ? (isNaN(rawErr2) ? 0 : rawErr2) : 0;
      const pgkErr3 = isPgk ? (isNaN(rawErr3) ? 0 : rawErr3) : 0;

      const content = document.getElementById("edit-q-content").value.trim();

      const textInputs = document.querySelectorAll(".edit-opt-text");
      const keyInputs = document.querySelectorAll(".edit-opt-key");

      const options = [];
      const correctKeys = [];
      textInputs.forEach((txt, idx) => {
        const val = txt.value.trim();
        const lbl = txt.getAttribute("data-label");
        const isCor = keyInputs[idx].checked;
        if (val) {
          if (isCor) correctKeys.push(lbl);
          options.push({ question_id: qId, option_label: lbl, content: val, is_correct: isCor });
        }
      });

      this.showLoader("Menyimpan perubahan butir soal...");
      const client = getSupabaseClient();
      try {
        if (fileInput && fileInput.files[0]) {
          this.showLoader("Mengunggah gambar soal baru...");
          imageUrl = await this.uploadImageFile(fileInput.files[0], 'questions');
        }

        await client.from('questions').update({
          stimulus_group_id: stimId,
          original_number: num,
          question_type: type,
          points: isNaN(points) ? 1.0 : points,
          pgk_score_err1: pgkErr1,
          pgk_score_err2: pgkErr2,
          pgk_score_err3: pgkErr3,
          image_url: imageUrl,
          content: content,
          correct_keys: correctKeys
        }).eq('id', qId);

        await client.from('options').delete().eq('question_id', qId);
        await client.from('options').insert(options);

        this.hideLoader();
        document.getElementById("modal-edit-question").classList.add("d-none");
        await this.loadBankSoalContent(examId);
      } catch (err) {
        this.hideLoader();
        alert("Gagal update soal: " + err.message);
      }
    });
  },

  setupImportExcelEventListeners() {
    const btnDownload = document.getElementById("btn-download-template");
    if (btnDownload) {
      btnDownload.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.downloadExcelTemplate();
      };
    }

    const fileInput = document.getElementById("excel-file-input");
    fileInput?.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = new Uint8Array(evt.target.result);
          const wb = XLSX.read(data, { type: 'array' });
          const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
          this.parsedExcelQuestions = [];
          let tableRows = '';

          raw.forEach((r, idx) => {
            const num = r.nomor || (idx + 1);
            const type = (r.tipe || 'pg').toLowerCase().trim();
            const points = parseFloat(r.poin_benar || r.poin) || 4.0;
            
            const rawErr1 = parseFloat(r.pgk_skor_salah_1);
            const rawErr2 = parseFloat(r.pgk_skor_salah_2);
            const rawErr3 = parseFloat(r.pgk_skor_salah_3);

            const err1 = !isNaN(rawErr1) ? rawErr1 : 0;
            const err2 = !isNaN(rawErr2) ? rawErr2 : 0;
            const err3 = !isNaN(rawErr3) ? rawErr3 : 0;

            const content = (r.soal || '').trim();
            const rawKey = String(r.kunci || '').toUpperCase().trim();
            const parsedKeys = rawKey.split(/[,;\s]+/).filter(Boolean);
            const imgUrl = (r.gambar_url || '').trim() || null;

            const options = [];
            ['a', 'b', 'c', 'd', 'e', 'f'].forEach(lbl => {
              const text = r[`opsi_${lbl}`] ? String(r[`opsi_${lbl}`]).trim() : '';
              if (text) {
                options.push({ option_label: lbl.toUpperCase(), content: text, is_correct: parsedKeys.includes(lbl.toUpperCase()) });
              }
            });

            if (content && options.length >= 2) {
              this.parsedExcelQuestions.push({
                original_number: num,
                stimulus_title: r.judul_stimulus ? String(r.judul_stimulus).trim() : null,
                stimulus_content: r.isi_stimulus ? String(r.isi_stimulus).trim() : '',
                question_type: type,
                points: points,
                pgk_score_err1: err1,
                pgk_score_err2: err2,
                pgk_score_err3: err3,
                image_url: imgUrl,
                content: content,
                correct_keys: parsedKeys,
                options: options
              });

              tableRows += `<tr><td>${num}</td><td>${r.judul_stimulus || '-'}</td><td>${type.toUpperCase()}</td><td>${points}</td><td>${type === 'pgk' ? err1 : '-'}</td><td>${type === 'pgk' ? err2 : '-'}</td><td>${type === 'pgk' ? err3 : '-'}</td><td>${content.substring(0, 30)}...</td><td>${parsedKeys.join(',')}</td><td><span class="badge badge-success">Valid</span></td></tr>`;
            }
          });

          document.getElementById("import-summary-text").innerText = `Pratinjau: ${this.parsedExcelQuestions.length} Soal Siap Diimpor`;
          document.getElementById("import-preview-body").innerHTML = tableRows;
          document.getElementById("import-preview-area").classList.remove("d-none");
        } catch (err) {
          alert(`Gagal baca Excel: ${err.message}`);
        }
      };
      reader.readAsArrayBuffer(file);
    });

    document.getElementById("btn-commit-import")?.addEventListener("click", async () => {
      const examId = document.getElementById("import-exam-select").value;
      if (!examId) return alert("Pilih sesi ujian terlebih dahulu.");

      this.showLoader(`Mengunggah ${this.parsedExcelQuestions.length} butir soal ke database...`);
      const client = getSupabaseClient();
      try {
        const stimMap = {};
        for (const q of this.parsedExcelQuestions) {
          let stimId = null;
          if (q.stimulus_title) {
            if (!stimMap[q.stimulus_title]) {
              const { data: s } = await client.from('stimulus_groups').insert({ exam_id: examId, title: q.stimulus_title, content: q.stimulus_content }).select().single();
              stimMap[q.stimulus_title] = s.id;
            }
            stimId = stimMap[q.stimulus_title];
          }

          const { data: insertedQ } = await client.from('questions').insert({
            exam_id: examId,
            stimulus_group_id: stimId,
            original_number: q.original_number,
            question_type: q.question_type,
            points: q.points,
            pgk_score_err1: q.pgk_score_err1,
            pgk_score_err2: q.pgk_score_err2,
            pgk_score_err3: q.pgk_score_err3,
            image_url: q.image_url,
            content: q.content,
            correct_keys: q.correct_keys
          }).select().single();

          const opts = q.options.map(o => ({ question_id: insertedQ.id, option_label: o.option_label, content: o.content, is_correct: o.is_correct }));
          await client.from('options').insert(opts);
        }

        this.hideLoader();
        alert("Sukses mengimpor seluruh butir soal!");
        document.getElementById("import-preview-area").classList.add("d-none");
        document.getElementById("excel-file-input").value = "";
        await this.loadBankSoalContent(examId);
      } catch (err) {
        this.hideLoader();
        alert(`Gagal impor: ${err.message}`);
      }
    });
  },

  getAppsScriptTemplate() {
    return `function doPost(e) {
  try {
    var raw = e.postData.contents;
    var data = JSON.parse(raw);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. SHEET REKAP NILAI
    var sheetNilai = ss.getSheetByName("Rekap Nilai");
    if (!sheetNilai) {
      sheetNilai = ss.insertSheet("Rekap Nilai");
      sheetNilai.appendRow([
        "Waktu Submit", "No. Absen", "Nama Siswa", "NISN", "Kelas", 
        "Mata Pelajaran", "Judul Ujian", "Total Soal", "Nilai Akhir (0-100)", 
        "Total Poin", "Status Pengerjaan", "Pelanggaran"
      ]);
      sheetNilai.getRange("A1:L1").setFontWeight("bold").setBackground("#e0e7ff");
    }

    sheetNilai.appendRow([
      data.submitted_at || new Date().toLocaleString("id-ID"),
      data.attendance_number || "-",
      data.student_name,
      data.student_number || "-",
      data.class_name,
      data.subject,
      data.exam_title,
      data.total_questions,
      data.final_score,
      data.total_points || 0,
      data.submission_type === 'forced_cheat' ? 'TERINDIKASI CURANG' : 'SELESAI MURNI',
      (data.violation_count || 0) + " kali"
    ]);

    // 2. SHEET ANALISIS BUTIR SOAL
    var sheetAnalisis = ss.getSheetByName("Analisis Soal");
    var totalQ = Number(data.total_questions) || (data.item_analysis ? data.item_analysis.length : 0);

    if (!sheetAnalisis) {
      sheetAnalisis = ss.insertSheet("Analisis Soal");
      var headers = ["No. Absen", "Nama Siswa", "Kelas", "Nilai Akhir", "Status"];
      for (var i = 1; i <= totalQ; i++) {
        headers.push("No. " + i);
      }
      sheetAnalisis.appendRow(headers);
      sheetAnalisis.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#fef3c7");
    }

    var rowAnalisis = [
      data.attendance_number || "-",
      data.student_name,
      data.class_name,
      data.final_score,
      data.submission_type === 'forced_cheat' ? 'CURANG' : 'MURNI'
    ];

    if (data.item_analysis && data.item_analysis.length > 0) {
      for (var j = 0; j < data.item_analysis.length; j++) {
        var item = data.item_analysis[j];
        var keys = (item.selected_keys && item.selected_keys.length > 0) ? item.selected_keys.join(",") : "-";
        var scoreVal = (item.score_earned !== undefined && item.score_earned !== null) ? item.score_earned : 0;
        rowAnalisis.push(keys + " (" + scoreVal + ")");
      }
    }
    sheetAnalisis.appendRow(rowAnalisis);

    return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}`;
  },

  async loadHasilExamFilter() {
    const sel = document.getElementById("hasil-exam-filter");
    if (!sel) return;

    let opts = '<option value="">-- Pilih Sesi Ujian --</option>';
    this.examsList.forEach(e => opts += `<option value="${e.id}">${e.title} (${e.subject || '-'})</option>`);
    sel.innerHTML = opts;

    if (this.selectedExamId) {
      sel.value = this.selectedExamId;
      await this.loadHasilAndAnalisis(this.selectedExamId);
    }

    sel.onchange = (e) => this.loadHasilAndAnalisis(e.target.value);
    document.getElementById("btn-refresh-hasil")?.addEventListener("click", () => {
      if (sel.value) this.loadHasilAndAnalisis(sel.value);
    });

    const codeBox = document.getElementById("apps-script-code-box");
    if (codeBox) {
      codeBox.value = this.getAppsScriptTemplate();
    }

    document.getElementById("btn-download-apps-script")?.addEventListener("click", () => {
      const code = this.getAppsScriptTemplate();
      const blob = new Blob([code], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = "Kode_Spreadsheet_Ujian.js";
      a.click();
      URL.revokeObjectURL(url);
    });

    document.getElementById("btn-copy-apps-script")?.addEventListener("click", () => {
      const code = this.getAppsScriptTemplate();
      navigator.clipboard.writeText(code).then(() => {
        alert("✅ Kode skrip Google Spreadsheet berhasil disalin ke clipboard!");
      });
    });
  },

  async loadHasilAndAnalisis(examId) {
    const integrationCard = document.getElementById("spreadsheet-integration-card");
    const inputUrl = document.getElementById("input-spreadsheet-url");
    const btnSaveUrl = document.getElementById("btn-save-spreadsheet-url");
    const btnSyncAll = document.getElementById("btn-sync-all-spreadsheet");
    const alertEl = document.getElementById("spreadsheet-alert");

    if (!examId) {
      if (integrationCard) integrationCard.classList.add("d-none");
      return;
    }

    const client = getSupabaseClient();
    const { data: examInfo } = await client.from('exams').select('*').eq('id', examId).single();
    if (integrationCard) {
      integrationCard.classList.remove("d-none");
      if (inputUrl) inputUrl.value = examInfo.spreadsheet_url || '';
      
      const codeBox = document.getElementById("apps-script-code-box");
      if (codeBox) codeBox.value = this.getAppsScriptTemplate();
    }

    if (btnSaveUrl) {
      btnSaveUrl.onclick = async () => {
        const urlVal = inputUrl.value.trim();
        this.showLoader("Menyimpan tautan Spreadsheet...");
        try {
          await client.from('exams').update({ spreadsheet_url: urlVal || null }).eq('id', examId);
          alertEl.className = "alert alert-success";
          alertEl.innerText = "Tautan Google Spreadsheet berhasil disimpan!";
          alertEl.classList.remove("d-none");
        } catch (err) {
          alertEl.className = "alert alert-error";
          alertEl.innerText = `Gagal menyimpan: ${err.message}`;
          alertEl.classList.remove("d-none");
        } finally {
          this.hideLoader();
        }
      };
    }

    const { data: attempts } = await client
      .from('exam_attempts')
      .select('id, score, total_points, violation_count, submission_type, submitted_at, students(id, attendance_number, full_name, student_number, classes(class_name))')
      .eq('exam_id', examId)
      .order('score', { ascending: false });

    const tbodyHasil = document.getElementById("hasil-table-body");
    let rowsHtml = '';
    (attempts || []).forEach((att) => {
      const st = att.students || {};
      const isCheat = att.submission_type === 'forced_cheat';
      rowsHtml += `
        <tr style="${isCheat ? 'background: #fff1f2;' : ''}">
          <td style="text-align: center;"><strong style="color: var(--primary-color);">${st.attendance_number || '-'}</strong></td>
          <td><strong>${st.full_name || '-'}</strong></td>
          <td>${st.student_number || '-'}</td>
          <td>${st.classes ? st.classes.class_name : '-'}</td>
          <td><strong style="font-size: 1.1rem; color: ${isCheat ? '#b91c1c' : 'var(--primary-color)'};">${att.score}</strong></td>
          <td>${new Date(att.submitted_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</td>
          <td>${isCheat ? '<span class="badge badge-danger">🚨 Terindikasi Curang</span>' : '<span class="badge badge-success">✓ Selesai Murni</span>'}</td>
          <td>${att.violation_count > 0 ? `<strong style="color: #b91c1c;">${att.violation_count}x</strong>` : '<span class="text-muted">0</span>'}</td>
        </tr>
      `;
    });
    if (tbodyHasil) tbodyHasil.innerHTML = rowsHtml || '<tr><td colspan="8" class="text-center text-muted">Belum ada data pengerjaan.</td></tr>';

    const { data: questions } = await client
      .from('questions')
      .select('id, original_number, points, pgk_score_err1, pgk_score_err2, pgk_score_err3, question_type, correct_keys')
      .eq('exam_id', examId)
      .order('original_number', { ascending: true });

    const attemptIds = (attempts || []).map(a => a.id);
    let allAnswers = [];
    if (attemptIds.length > 0) {
      const { data: ansData } = await client
        .from('student_answers')
        .select('*')
        .in('attempt_id', attemptIds);
      allAnswers = ansData || [];
    }

    const ansMap = {};
    allAnswers.forEach(ans => {
      const attId = String(ans.attempt_id);
      const qId = String(ans.question_id);
      if (!ansMap[attId]) ansMap[attId] = {};
      ansMap[attId][qId] = ans;
    });

    if (btnSyncAll) {
      btnSyncAll.onclick = async () => {
        const targetUrl = inputUrl.value.trim();
        if (!targetUrl) return alert("Silakan tempel dan simpan URL Web App Spreadsheet terlebih dahulu.");
        if (!attempts || attempts.length === 0) return alert("Belum ada data siswa untuk dikirim.");
        if (!confirm(`Kirim ulang ${attempts.length} data pengerjaan siswa ke Spreadsheet?`)) return;

        this.showLoader(`Mengirimkan ${attempts.length} data nilai ke Google Spreadsheet...`);

        try {
          for (const att of attempts) {
            const st = att.students || {};
            const attId = String(att.id);
            const itemAnalysis = [];

            (questions || []).forEach((q) => {
              const qId = String(q.id);
              const a = (ansMap[attId] && ansMap[attId][qId]) ? ansMap[attId][qId] : null;
              const maxP = parseFloat(q.points) || 1.0;
              let earned = 0;

              if (a) {
                if (a.score_earned !== null && a.score_earned !== undefined) {
                  earned = parseFloat(a.score_earned);
                } else {
                  const isPgk = (q.question_type || '').toLowerCase() === 'pgk';
                  const trueKeys = (Array.isArray(q.correct_keys) ? q.correct_keys : String(q.correct_keys || '').split(/[,;\s]+/))
                    .map(k => String(k).toUpperCase().trim()).filter(Boolean);
                  const sKeys = (Array.isArray(a.selected_keys) ? a.selected_keys : String(a.selected_keys || '').split(/[,;\s]+/))
                    .map(k => String(k).toUpperCase().trim()).filter(Boolean);

                  if (!isPgk) {
                    earned = a.is_correct ? maxP : 0;
                  } else {
                    const missed = trueKeys.filter(k => !sKeys.includes(k)).length;
                    const wrong = sKeys.filter(k => !trueKeys.includes(k)).length;
                    const totalErrors = missed + wrong;
                    
                    const err1Val = (q.pgk_score_err1 !== null && q.pgk_score_err1 !== undefined) ? parseFloat(q.pgk_score_err1) : 0;
                    const err2Val = (q.pgk_score_err2 !== null && q.pgk_score_err2 !== undefined) ? parseFloat(q.pgk_score_err2) : 0;
                    const err3Val = (q.pgk_score_err3 !== null && q.pgk_score_err3 !== undefined) ? parseFloat(q.pgk_score_err3) : 0;

                    if (totalErrors === 0 && sKeys.length > 0) earned = maxP;
                    else if (totalErrors === 1) earned = err1Val;
                    else if (totalErrors === 2) earned = err2Val;
                    else if (totalErrors === 3) earned = err3Val;
                    else earned = 0;
                  }
                }
              }

              itemAnalysis.push({
                question_number: q.original_number,
                selected_keys: a ? a.selected_keys : [],
                is_correct: a ? a.is_correct : false,
                score_earned: earned
              });
            });

            const payload = {
              student_name: st.full_name,
              student_number: st.student_number,
              attendance_number: st.attendance_number || "-",
              class_name: st.classes ? st.classes.class_name : '-',
              exam_title: examInfo.title,
              subject: examInfo.subject,
              submitted_at: new Date(att.submitted_at).toLocaleString("id-ID"),
              total_questions: (questions || []).length,
              total_points: att.total_points || 0,
              correct_count: allAnswers.filter(ans => String(ans.attempt_id) === attId && ans.is_correct).length,
              final_score: att.score,
              submission_type: att.submission_type,
              violation_count: att.violation_count,
              item_analysis: itemAnalysis
            };

            await fetch(targetUrl, {
              method: 'POST',
              mode: 'no-cors',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
          }

          this.hideLoader();
          alert(`Berhasil mengirimkan ${attempts.length} data nilai ke Google Spreadsheet!`);
        } catch (err) {
          this.hideLoader();
          alert(`Kendala pengiriman: ${err.message}`);
        }
      };
    }
  },

  async loadQuickStats() {
    const client = getSupabaseClient();
    const { count: cCount } = await client.from('classes').select('*', { count: 'exact', head: true }).eq('teacher_id', this.currentTeacher.id);
    const { count: sCount } = await client.from('students').select('*', { count: 'exact', head: true });
    const { count: eCount } = await client.from('exams').select('*', { count: 'exact', head: true }).eq('teacher_id', this.currentTeacher.id);

    document.getElementById("stat-classes").innerText = cCount || 0;
    document.getElementById("stat-students").innerText = sCount || 0;
    document.getElementById("stat-exams").innerText = eCount || 0;
  }
};
