// ==========================================================================
// MODUL DASHBOARD GURU, REKAP NILAI, & ANALISIS BUTIR SOAL LENGKAP
// ==========================================================================

const GuruModule = {
  currentTeacher: null,
  classesList: [],
  examsList: [],
  selectedExamId: null,
  selectedExamTitle: '',
  targetStimulusId: null,
  targetStimulusTitle: '',
  parsedExcelQuestions: [],

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
    const fileExt = file.name.split('.').pop() || 'jpg';
    const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${fileExt.toLowerCase()}`;

    const { data, error } = await client.storage.from('exam-images').upload(fileName, file, { cacheControl: '3600', upsert: false });
    if (error) throw new Error(`Upload gambar gagal: ${error.message}`);
    return client.storage.from('exam-images').getPublicUrl(data.path).data.publicUrl;
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
    const client = getSupabaseClient();
    try {
      const { data: allQ } = await client.from('questions').select('id, stimulus_group_id, original_number').eq('exam_id', examId).order('original_number', { ascending: true });
      if (!allQ || allQ.length === 0) return;

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
    }
  },

  downloadExcelTemplate() {
    if (typeof XLSX === 'undefined') return alert("Pustaka SheetJS belum termuat.");
    const templateData = [
      { nomor: 1, judul_stimulus: '', isi_stimulus: '', tipe: 'pg', poin: 1.0, soal: 'Ibukota Indonesia adalah...', opsi_a: 'Jakarta', opsi_b: 'Surabaya', opsi_c: 'Bandung', opsi_d: 'Medan', opsi_e: '', opsi_f: '', kunci: 'A', gambar_url: '' },
      { nomor: 2, judul_stimulus: 'Teks Mangrove', isi_stimulus: 'Mangrove meredam abrasi pantai...', tipe: 'pgk', poin: 2.0, soal: 'Manakah peran mangrove? (PGK 6 Opsi)', opsi_a: 'Meredam abrasi', opsi_b: 'Habitat ikan', opsi_c: 'Batu bara', opsi_d: 'Penyaring sedimen', opsi_e: 'Peneduh pesisir', opsi_f: 'Kayu bakar komersial', kunci: 'A,B,D,E', gambar_url: '' }
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template Soal");
    XLSX.writeFile(wb, "template_soal_akm.xlsx");
  },

  setupImportExcelEventListeners() {
    document.getElementById("btn-download-template")?.addEventListener("click", () => this.downloadExcelTemplate());

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
            const points = parseFloat(r.poin) || 1.0;
            const content = (r.soal || '').trim();
            const rawKey = String(r.kunci || '').toUpperCase().trim();
            const correctKeys = rawKey.split(/[,;\s]+/).filter(Boolean);

            const options = [];
            ['a', 'b', 'c', 'd', 'e', 'f'].forEach(lbl => {
              const text = r[`opsi_${lbl}`] ? String(r[`opsi_${lbl}`]).trim() : '';
              if (text) {
                options.push({ option_label: lbl.toUpperCase(), content: text, is_correct: correctKeys.includes(lbl.toUpperCase()) });
              }
            });

            if (content && options.length >= 2) {
              this.parsedExcelQuestions.push({
                original_number: num,
                stimulus_title: r.judul_stimulus ? String(r.judul_stimulus).trim() : null,
                stimulus_content: r.isi_stimulus ? String(r.isi_stimulus).trim() : '',
                question_type: type,
                points: points,
                content: content,
                correct_keys: correctKeys,
                options: options
              });

              tableRows += `<tr><td>${num}</td><td>${r.judul_stimulus || '-'}</td><td>${type.toUpperCase()}</td><td>${points}</td><td>${content.substring(0, 40)}...</td><td>${correctKeys.join(',')}</td><td><span class="badge badge-success">Valid</span></td></tr>`;
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
            content: q.content,
            correct_keys: q.correct_keys
          }).select().single();

          const opts = q.options.map(o => ({ question_id: insertedQ.id, option_label: o.option_label, content: o.content, is_correct: o.is_correct }));
          await client.from('options').insert(opts);
        }

        alert("Sukses mengimpor seluruh butir soal!");
        document.getElementById("import-preview-area").classList.add("d-none");
        fileInput.value = "";
        await this.loadBankSoalContent(examId);
      } catch (err) {
        alert(`Gagal impor: ${err.message}`);
      }
    });
  },

  async initDashboard(teacherProfile) {
    this.currentTeacher = teacherProfile;
    document.getElementById("auth-section")?.classList.add("d-none");
    document.getElementById("dashboard-section")?.classList.remove("d-none");
    document.getElementById("teacher-name-display").innerText = teacherProfile.full_name || teacherProfile.email;

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
    this.setupImportExcelEventListeners();
  },

  setupNavigation() {
    const navLinks = document.querySelectorAll(".sidebar-menu .nav-link");
    const panels = document.querySelectorAll(".menu-panel");

    navLinks.forEach(link => {
      link.addEventListener("click", async (e) => {
        e.preventDefault();
        const targetId = link.getAttribute("data-target");

        if (targetId === "panel-tambah-soal") {
          const filter = document.getElementById("bank-exam-filter");
          if (!this.selectedExamId && filter && filter.value) {
            this.setExamActive(filter.value, filter.options[filter.selectedIndex].text);
          }
          if (!this.selectedExamId) {
            alert("Silakan pilih sesi ujian terlebih dahulu.");
            document.querySelector('.sidebar-menu .nav-link[data-target="panel-bank-soal"]')?.click();
            return;
          }
          await this.syncActiveExamToQuestionForm();
        }

        navLinks.forEach(l => l.classList.remove("active"));
        panels.forEach(p => p.classList.add("d-none"));

        link.classList.add("active");
        document.getElementById(targetId)?.classList.remove("d-none");
        document.getElementById("current-menu-title").innerText = link.innerText;

        if (targetId === "panel-siswa") this.loadStudentsTable();
        else if (targetId === "panel-kelas") this.loadClassesTable();
        else if (targetId === "panel-ujian") this.loadExamsTable();
        else if (targetId === "panel-bank-soal") this.loadBankSoalExamFilter();
        else if (targetId === "panel-hasil") this.loadHasilExamFilter();
        else if (targetId === "panel-import-excel") {
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

    ['student-class-id', 'edit-student-class-id', 'exam-class-id'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = optionsHtml;
    });
  },

  async loadStudentsTable() {
    const client = getSupabaseClient();
    const tableBody = document.getElementById("students-table-body");
    if (!tableBody) return;

    const { data: students } = await client.from('students').select('id, student_number, full_name, is_active, class_id, classes(class_name)').order('student_number', { ascending: true });

    let rowsHtml = '';
    (students || []).forEach((s, idx) => {
      rowsHtml += `
        <tr>
          <td>${idx + 1}</td>
          <td><strong>${s.classes ? s.classes.class_name : '-'}</strong></td>
          <td>${s.student_number}</td>
          <td>${s.full_name}</td>
          <td><span class="badge ${s.is_active ? 'badge-success' : 'badge-danger'}">${s.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="GuruModule.openEditStudent('${s.id}', '${s.class_id}', '${s.full_name}', '${s.student_number}')">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="GuruModule.deleteStudent('${s.id}', '${s.full_name}')">Hapus</button>
          </td>
        </tr>
      `;
    });
    tableBody.innerHTML = rowsHtml || '<tr><td colspan="6" class="text-center text-muted">Belum ada siswa.</td></tr>';
  },

  setupStudentEventListeners() {
    document.getElementById("form-add-student")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const classId = document.getElementById("student-class-id").value;
      const fullName = document.getElementById("student-full-name").value.trim();
      const studentNumber = document.getElementById("student-number").value.trim();

      const client = getSupabaseClient();
      await client.from('students').insert({ class_id: classId, full_name: fullName, student_number: studentNumber, is_active: true });
      e.target.reset();
      await this.loadStudentsTable();
      await this.loadQuickStats();
    });

    document.getElementById("btn-cancel-edit-student")?.addEventListener("click", () => document.getElementById("modal-edit-student").classList.add("d-none"));
    document.getElementById("form-edit-student")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("edit-student-id").value;
      const classId = document.getElementById("edit-student-class-id").value;
      const fullName = document.getElementById("edit-student-full-name").value.trim();
      const studentNumber = document.getElementById("edit-student-number").value.trim();

      const client = getSupabaseClient();
      await client.from('students').update({ class_id: classId, full_name: fullName, student_number: studentNumber }).eq('id', id);
      document.getElementById("modal-edit-student").classList.add("d-none");
      await this.loadStudentsTable();
    });
  },

  openEditStudent(id, classId, fullName, studentNumber) {
    document.getElementById("edit-student-id").value = id;
    document.getElementById("edit-student-class-id").value = classId;
    document.getElementById("edit-student-full-name").value = fullName;
    document.getElementById("edit-student-number").value = studentNumber;
    document.getElementById("modal-edit-student").classList.remove("d-none");
  },

  async deleteStudent(studentId, fullName) {
    if (!confirm(`Hapus data siswa "${fullName}"?`)) return;
    const client = getSupabaseClient();
    await client.from('students').delete().eq('id', studentId);
    await this.loadStudentsTable();
    await this.loadQuickStats();
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
            <button class="btn btn-secondary btn-sm" onclick="GuruModule.openEditClass('${c.id}', '${c.class_name}')">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="GuruModule.deleteClass('${c.id}', '${c.class_name}')">Hapus</button>
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
      const client = getSupabaseClient();
      await client.from('classes').insert({ teacher_id: this.currentTeacher.id, class_name: name });
      e.target.reset();
      await this.loadClassesTable();
      await this.loadClassesDropdown();
      await this.loadQuickStats();
    });

    document.getElementById("btn-cancel-edit-class")?.addEventListener("click", () => document.getElementById("modal-edit-class").classList.add("d-none"));
    document.getElementById("form-edit-class")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("edit-class-id").value;
      const name = document.getElementById("edit-class-name").value.trim();
      const client = getSupabaseClient();
      await client.from('classes').update({ class_name: name }).eq('id', id);
      document.getElementById("modal-edit-class").classList.add("d-none");
      await this.loadClassesTable();
      await this.loadClassesDropdown();
    });
  },

  openEditClass(id, name) {
    document.getElementById("edit-class-id").value = id;
    document.getElementById("edit-class-name").value = name;
    document.getElementById("modal-edit-class").classList.remove("d-none");
  },

  async deleteClass(id, name) {
    if (!confirm(`Hapus kelas "${name}"?`)) return;
    const client = getSupabaseClient();
    await client.from('classes').delete().eq('id', id);
    await this.loadClassesTable();
    await this.loadClassesDropdown();
    await this.loadQuickStats();
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
            <button class="btn ${ex.is_active ? 'btn-warning' : 'btn-secondary'} btn-sm" onclick="GuruModule.toggleExamStatus('${ex.id}', ${ex.is_active})">${ex.is_active ? 'Tutup' : 'Buka'}</button>
            <button class="btn btn-danger btn-sm" onclick="GuruModule.deleteExam('${ex.id}', '${ex.title}')">Hapus</button>
          </td>
        </tr>
      `;
    });
    if (tableBody) tableBody.innerHTML = rowsHtml || '<tr><td colspan="9" class="text-center text-muted">Belum ada ujian.</td></tr>';
  },

  setupExamEventListeners() {
    const modal = document.getElementById("modal-create-exam");
    document.getElementById("btn-open-modal-exam")?.addEventListener("click", () => {
      document.getElementById("form-create-exam").reset();
      document.getElementById("exam-token").value = this.generateExamToken();
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
      const spreadsheetUrl = document.getElementById("exam-spreadsheet-url")?.value.trim() || null;
      const randomizeQ = document.getElementById("exam-randomize-questions").checked;
      const randomizeOpt = document.getElementById("exam-randomize-options").checked;
      const antiCheat = document.getElementById("exam-anti-cheat").checked;
      const maxViolations = parseInt(document.getElementById("exam-max-violations").value, 10) || 3;

      const client = getSupabaseClient();
      await client.from('exams').insert({
        teacher_id: this.currentTeacher.id,
        class_id: classId,
        title: title,
        subject: subject,
        description: desc,
        duration_minutes: duration,
        token: token,
        spreadsheet_url: spreadsheetUrl,
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
    });
  },

  async toggleExamStatus(examId, currentStatus) {
    const client = getSupabaseClient();
    await client.from('exams').update({ is_active: !currentStatus }).eq('id', examId);
    await this.loadExamsTable();
  },

  async deleteExam(examId, title) {
    if (!confirm(`Hapus ujian "${title}"?`)) return;
    const client = getSupabaseClient();
    await client.from('exams').delete().eq('id', examId);
    await this.loadExamsTable();
    await this.loadBankSoalExamFilter();
    await this.loadQuickStats();
  },

  setExamActive(examId, title) {
    this.selectedExamId = examId;
    this.selectedExamTitle = title;
    this.syncActiveExamToQuestionForm();
  },

  async loadBankSoalExamFilter() {
    const filterSelect = document.getElementById("bank-exam-filter");
    const importSelect = document.getElementById("import-exam-select");
    const client = getSupabaseClient();

    const { data: exams } = await client.from('exams').select('id, title, subject').eq('teacher_id', this.currentTeacher.id).order('created_at', { ascending: false });
    this.examsList = exams || [];

    let opts = '<option value="">-- Pilih Sesi Ujian --</option>';
    this.examsList.forEach(e => opts += `<option value="${e.id}">${e.title} (${e.subject || '-'})</option>`);

    if (filterSelect) filterSelect.innerHTML = opts;
    if (importSelect) importSelect.innerHTML = opts;

    if (this.examsList.length > 0) {
      const first = this.examsList[0];
      if (filterSelect) filterSelect.value = first.id;
      if (importSelect) importSelect.value = first.id;
      this.setExamActive(first.id, `${first.title} (${first.subject || '-'})`);
      await this.loadBankSoalContent(first.id);
    }
  },

  setupBankSoalEventListeners() {
    document.getElementById("bank-exam-filter")?.addEventListener("change", (e) => {
      this.setExamActive(e.target.value, e.target.options[e.target.selectedIndex]?.text || '');
      this.loadBankSoalContent(e.target.value);
    });

    document.getElementById("btn-goto-tambah-soal")?.addEventListener("click", () => {
      document.querySelector('.sidebar-menu .nav-link[data-target="panel-tambah-soal"]')?.click();
    });

    document.getElementById("btn-renumber-questions")?.addEventListener("click", () => {
      this.renumberAllQuestions(this.selectedExamId);
    });
  },

  async loadBankSoalContent(examId) {
    const container = document.getElementById("bank-soal-list-container");
    if (!container || !examId) return;

    const client = getSupabaseClient();
    const { data: stimulusGroups } = await client.from('stimulus_groups').select('*').eq('exam_id', examId);
    const { data: questions } = await client.from('questions').select('*, options(*)').eq('exam_id', examId).order('original_number', { ascending: true });

    let contentHtml = '';
    (stimulusGroups || []).forEach(stim => {
      const stimQs = (questions || []).filter(q => q.stimulus_group_id === stim.id);
      contentHtml += `
        <div class="card" style="border-left: 4px solid var(--primary-color); margin-bottom: 20px;">
          <div class="card-header" style="background: #f1f5f9; margin: -24px -24px 15px -24px; padding: 12px 20px;">
            <strong>Wacana: ${stim.title}</strong>
            <div>
              <button class="btn btn-secondary btn-sm" onclick="GuruModule.openEditStimulusModal('${stim.id}')">Edit</button>
              <button class="btn btn-danger btn-sm" onclick="GuruModule.deleteStimulusGroup('${stim.id}', '${examId}')">Hapus</button>
            </div>
          </div>
          <p style="white-space: pre-line;">${stim.content || ''}</p>
          <div style="display: flex; flex-direction: column; gap: 10px;">${stimQs.map(q => this.renderQuestionItem(q, examId)).join('')}</div>
        </div>
      `;
    });

    const standalones = (questions || []).filter(q => !q.stimulus_group_id);
    if (standalones.length > 0) {
      contentHtml += `
        <div class="card">
          <div class="card-header"><span class="card-title">Soal Mandiri</span></div>
          <div style="display: flex; flex-direction: column; gap: 10px;">${standalones.map(q => this.renderQuestionItem(q, examId)).join('')}</div>
        </div>
      `;
    }

    container.innerHTML = contentHtml || '<p class="text-muted text-center" style="padding: 20px;">Belum ada butir soal.</p>';
    this.renderMath(container);
  },

  renderQuestionItem(q, examId) {
    let opts = '';
    (q.options || []).forEach(o => {
      opts += `<div style="${o.is_correct ? 'color: var(--success-color); font-weight: bold;' : ''}">${o.is_correct ? '✓ ' : ''}<strong>${o.option_label}.</strong> ${o.content}</div>`;
    });

    return `
      <div style="border: 1px solid var(--border-color); border-radius: 6px; padding: 12px;">
        <div style="display: flex; justify-content: space-between;">
          <strong>No. ${q.original_number} (${q.question_type.toUpperCase()} - ${q.points} Poin)</strong>
          <div>
            <button class="btn btn-secondary btn-sm" onclick="GuruModule.openEditQuestionModal('${q.id}', '${examId}')">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="GuruModule.deleteQuestion('${q.id}', '${examId}')">Hapus</button>
          </div>
        </div>
        <p style="white-space: pre-line; margin: 8px 0;">${q.content}</p>
        <div style="background: #f8fafc; padding: 8px; border-radius: 4px;">${opts}</div>
      </div>
    `;
  },

  async deleteQuestion(id, examId) {
    if (!confirm("Hapus butir soal ini?")) return;
    const client = getSupabaseClient();
    await client.from('questions').delete().eq('id', id);
    await this.loadBankSoalContent(examId);
  },

  async deleteStimulusGroup(id, examId) {
    if (!confirm("Hapus stimulus ini? Soal di dalamnya akan tetap disimpan sebagai soal mandiri.")) return;
    const client = getSupabaseClient();
    await client.from('stimulus_groups').delete().eq('id', id);
    await this.loadBankSoalContent(examId);
  },

  setupStimulusEventListeners() {
    document.getElementById("btn-open-modal-stimulus")?.addEventListener("click", () => {
      if (!this.selectedExamId) return alert("Pilih ujian terlebih dahulu.");
      document.getElementById("form-create-stimulus").reset();
      document.getElementById("modal-create-stimulus").classList.remove("d-none");
    });
    document.getElementById("btn-cancel-create-stimulus")?.addEventListener("click", () => document.getElementById("modal-create-stimulus").classList.add("d-none"));
    document.getElementById("btn-close-modal-stimulus")?.addEventListener("click", () => document.getElementById("modal-create-stimulus").classList.add("d-none"));

    document.getElementById("form-create-stimulus")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = document.getElementById("stimulus-title").value.trim();
      const content = document.getElementById("stimulus-content").value.trim();
      const client = getSupabaseClient();
      await client.from('stimulus_groups').insert({ exam_id: this.selectedExamId, title: title, content: content });
      document.getElementById("modal-create-stimulus").classList.add("d-none");
      await this.loadBankSoalContent(this.selectedExamId);
    });

    document.getElementById("btn-cancel-edit-stimulus")?.addEventListener("click", () => document.getElementById("modal-edit-stimulus").classList.add("d-none"));
    document.getElementById("btn-close-modal-edit-stimulus")?.addEventListener("click", () => document.getElementById("modal-edit-stimulus").classList.add("d-none"));
    document.getElementById("form-edit-stimulus")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("edit-stimulus-id").value;
      const title = document.getElementById("edit-stimulus-title").value.trim();
      const content = document.getElementById("edit-stimulus-content").value.trim();
      const client = getSupabaseClient();
      await client.from('stimulus_groups').update({ title: title, content: content }).eq('id', id);
      document.getElementById("modal-edit-stimulus").classList.add("d-none");
      await this.loadBankSoalContent(this.selectedExamId);
    });
  },

  async openEditStimulusModal(id) {
    const client = getSupabaseClient();
    const { data: s } = await client.from('stimulus_groups').select('*').eq('id', id).single();
    document.getElementById("edit-stimulus-id").value = s.id;
    document.getElementById("edit-stimulus-title").value = s.title;
    document.getElementById("edit-stimulus-content").value = s.content;
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
  },

  async syncActiveExamToQuestionForm() {
    document.getElementById("question-exam-id").value = this.selectedExamId || "";
    document.getElementById("active-exam-title-display").innerText = this.selectedExamTitle || "-";
    if (this.selectedExamId) {
      await this.loadStimulusDropdown(this.selectedExamId, "question-stimulus-id");
      document.getElementById("question-number").value = await this.getSuggestedQuestionNumber(this.selectedExamId);
    }
  },

  setupQuestionFormEventListeners() {
    document.getElementById("question-type")?.addEventListener("change", (e) => {
      const isPgk = e.target.value === 'pgk';
      document.querySelectorAll("#options-inputs-container .option-key-input").forEach(i => {
        i.type = isPgk ? 'checkbox' : 'radio';
        if (!isPgk) i.name = "correct_key";
        else i.removeAttribute("name");
      });
    });

    document.getElementById("form-create-question")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const examId = this.selectedExamId;
      const stimId = document.getElementById("question-stimulus-id").value || null;
      const num = parseInt(document.getElementById("question-number").value, 10);
      const type = document.getElementById("question-type").value;
      const points = parseFloat(document.getElementById("question-points").value) || 1.0;
      const content = document.getElementById("question-content").value.trim();

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

      if (options.length < 2 || correctKeys.length === 0) return alert("Minimal 2 pilihan terisi dan 1 kunci jawaban dipilih.");

      await this.shiftQuestionsUp(examId, num);
      const client = getSupabaseClient();
      const { data: newQ } = await client.from('questions').insert({
        exam_id: examId,
        stimulus_group_id: stimId,
        original_number: num,
        question_type: type,
        points: points,
        content: content,
        correct_keys: correctKeys
      }).select().single();

      const opts = options.map(o => ({ question_id: newQ.id, option_label: o.option_label, content: o.content, is_correct: o.is_correct }));
      await client.from('options').insert(opts);

      document.getElementById("question-content").value = "";
      textInputs.forEach(i => i.value = "");
      document.getElementById("question-number").value = num + 1;
      alert("Butir soal berhasil disimpan!");
      await this.loadBankSoalContent(examId);
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
    document.getElementById("edit-q-content").value = q.content;

    const isPgk = q.question_type === 'pgk';
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

  setupEditQuestionEventListeners() {
    document.getElementById("btn-cancel-edit-q")?.addEventListener("click", () => document.getElementById("modal-edit-question").classList.add("d-none"));
    document.getElementById("btn-close-modal-edit-q")?.addEventListener("click", () => document.getElementById("modal-edit-question").classList.add("d-none"));

    document.getElementById("form-edit-question")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const qId = document.getElementById("edit-q-id").value;
      const examId = document.getElementById("edit-q-exam-id").value;
      const stimId = document.getElementById("edit-q-stimulus-id").value || null;
      const num = parseInt(document.getElementById("edit-q-number").value, 10);
      const type = document.getElementById("edit-q-type").value;
      const points = parseFloat(document.getElementById("edit-q-points").value) || 1.0;
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

      const client = getSupabaseClient();
      await client.from('questions').update({ stimulus_group_id: stimId, original_number: num, question_type: type, points: points, content: content, correct_keys: correctKeys }).eq('id', qId);
      await client.from('options').delete().eq('question_id', qId);
      await client.from('options').insert(options);

      document.getElementById("modal-edit-question").classList.add("d-none");
      await this.loadBankSoalContent(examId);
    });
  },

  // =========================================================================
  // SEKSI REKAP NILAI & ANALISIS BUTIR SOAL DI DASHBOARD GURU
  // =========================================================================
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
  },

  async loadHasilAndAnalisis(examId) {
    if (!examId) return;
    const client = getSupabaseClient();

    // 1. Rekap Nilai Siswa
    const { data: attempts } = await client
      .from('exam_attempts')
      .select('id, score, violation_count, submission_type, submitted_at, students(id, full_name, student_number, classes(class_name))')
      .eq('exam_id', examId)
      .order('score', { ascending: false });

    const tbodyHasil = document.getElementById("hasil-table-body");
    let rowsHtml = '';
    (attempts || []).forEach((att, idx) => {
      const st = att.students || {};
      const isCheat = att.submission_type === 'forced_cheat';
      rowsHtml += `
        <tr style="${isCheat ? 'background: #fff1f2;' : ''}">
          <td>${idx + 1}</td>
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

    // 2. Matriks Analisis Butir Soal
    const { data: questions } = await client.from('questions').select('id, original_number').eq('exam_id', examId).order('original_number', { ascending: true });
    const theadAnalisis = document.getElementById("analisis-table-header");
    const tbodyAnalisis = document.getElementById("analisis-table-body");

    if (!questions || questions.length === 0 || !attempts || attempts.length === 0) {
      if (tbodyAnalisis) tbodyAnalisis.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Belum ada data jawaban untuk dianalisis.</td></tr>';
      return;
    }

    let headerHtml = '<tr><th>Nama Siswa</th><th>Kelas</th><th>Nilai</th><th>Status</th>';
    questions.forEach((q, i) => headerHtml += `<th>No.${i + 1}</th>`);
    headerHtml += '</tr>';
    if (theadAnalisis) theadAnalisis.innerHTML = headerHtml;

    const attemptIds = attempts.map(a => a.id);
    const { data: allAnswers } = await client.from('student_answers').select('attempt_id, question_id, selected_keys, is_correct').in('attempt_id', attemptIds);

    const ansMap = {};
    (allAnswers || []).forEach(ans => {
      if (!ansMap[ans.attempt_id]) ansMap[ans.attempt_id] = {};
      ansMap[ans.attempt_id][ans.question_id] = ans;
    });

    let matrixHtml = '';
    attempts.forEach(att => {
      const st = att.students || {};
      const isCheat = att.submission_type === 'forced_cheat';
      matrixHtml += `
        <tr style="${isCheat ? 'background: #fff1f2;' : ''}">
          <td><strong>${st.full_name || '-'}</strong></td>
          <td>${st.classes ? st.classes.class_name : '-'}</td>
          <td><strong>${att.score}</strong></td>
          <td>${isCheat ? '<small style="color: #b91c1c; font-weight: bold;">CURANG</small>' : '<small style="color: var(--success-color); font-weight: bold;">MURNI</small>'}</td>
      `;

      questions.forEach(q => {
        const a = ansMap[att.id] ? ansMap[att.id][q.id] : null;
        if (a) {
          const keys = (a.selected_keys || []).join(",") || "-";
          const color = a.is_correct ? 'var(--success-color)' : '#ef4444';
          matrixHtml += `<td style="color: ${color}; font-weight: 600; text-align: center;">${keys} (${a.is_correct ? '1' : '0'})</td>`;
        } else {
          matrixHtml += '<td style="color: #94a3b8; text-align: center;">- (0)</td>';
        }
      });
      matrixHtml += '</tr>';
    });

    if (tbodyAnalisis) tbodyAnalisis.innerHTML = matrixHtml;
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
