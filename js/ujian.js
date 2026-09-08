// ==========================================================================
// MODUL LOGIKA PENGERJAAN UJIAN SISWA & SINKRONISASI DATABASE (CHECKPOINT 29)
// ==========================================================================

const ExamRunnerModule = {
  session: null,
  questions: [],
  stimuliMap: {},
  currentIndex: 0,
  userAnswers: {}, // Format: { [questionId]: { keys: ['A'], isDoubt: false } }
  timerInterval: null,
  remainingSeconds: 0,
  startTimeIso: null,

  renderMath(element) {
    if (typeof renderMathInElement === 'function' && element) {
      try {
        renderMathInElement(element, {
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

  async init() {
    this.session = StudentAuthModule.getActiveSession();
    if (!this.session || !this.session.student || !this.session.exam) {
      alert("Sesi ujian tidak valid atau telah berakhir. Silakan login kembali.");
      window.location.href = "index.html";
      return;
    }

    this.startTimeIso = new Date().toISOString();

    document.getElementById("header-exam-title").innerText = `${this.session.exam.title} (${this.session.exam.subject || '-'})`;
    document.getElementById("header-student-info").innerText = `${this.session.student.full_name} (${this.session.student.class_name})`;

    this.setupEvents();
    this.restoreLocalAnswers();
    await this.loadExamContent();
    this.initTimer();
  },

  setupEvents() {
    document.getElementById("btn-prev-question").addEventListener("click", () => this.navigate(-1));
    document.getElementById("btn-next-question").addEventListener("click", () => this.navigate(1));
    
    document.getElementById("check-doubt").addEventListener("change", (e) => {
      const q = this.questions[this.currentIndex];
      if (!q) return;

      if (!this.userAnswers[q.id]) {
        this.userAnswers[q.id] = { keys: [], isDoubt: false };
      }
      this.userAnswers[q.id].isDoubt = e.target.checked;
      this.saveLocalAnswers();
      this.renderGridNumbers();
    });

    const drawer = document.getElementById("drawer-grid");
    document.getElementById("btn-toggle-grid").addEventListener("click", () => drawer.classList.remove("d-none"));
    document.getElementById("btn-close-grid").addEventListener("click", () => drawer.classList.add("d-none"));
    drawer.addEventListener("click", (e) => {
      if (e.target === drawer) drawer.classList.add("d-none");
    });

    document.getElementById("btn-finish-exam").addEventListener("click", () => this.finishExam(false));
  },

  async loadExamContent() {
    const client = getSupabaseClient();
    const examId = this.session.exam.id;

    try {
      const { data: stimuli } = await client
        .from('stimulus_groups')
        .select('*')
        .eq('exam_id', examId);

      (stimuli || []).forEach(s => {
        this.stimuliMap[s.id] = s;
      });

      const { data: qData, error: qErr } = await client
        .from('questions')
        .select(`
          id,
          original_number,
          stimulus_group_id,
          question_type,
          points,
          image_url,
          content,
          correct_keys,
          options (
            id,
            option_label,
            content
          )
        `)
        .eq('exam_id', examId)
        .order('original_number', { ascending: true });

      if (qErr) throw qErr;

      if (!qData || qData.length === 0) {
        alert("Belum ada butir soal pada ujian ini. Silakan hubungi guru pengawas.");
        window.location.href = "konfirmasi.html";
        return;
      }

      if (this.session.exam.randomize_questions) {
        this.questions = this.shuffleQuestionsPreservingStimulus(qData);
      } else {
        this.questions = qData;
      }

      if (this.session.exam.randomize_options) {
        this.questions.forEach(q => {
          if (q.options) {
            q.options = this.shuffleArray([...q.options]);
          }
        });
      }

      this.renderCurrentQuestion();
      this.renderGridNumbers();
    } catch (err) {
      console.error("Gagal memuat butir soal ujian:", err);
      alert(`Gagal mengambil data soal: ${err.message}`);
    }
  },

  shuffleQuestionsPreservingStimulus(questionsList) {
    const units = [];
    const visitedStim = new Set();

    questionsList.forEach(q => {
      if (!q.stimulus_group_id) {
        units.push([q]);
      } else if (!visitedStim.has(q.stimulus_group_id)) {
        visitedStim.add(q.stimulus_group_id);
        const group = questionsList.filter(item => item.stimulus_group_id === q.stimulus_group_id);
        units.push(group);
      }
    });

    const shuffledUnits = this.shuffleArray(units);
    return shuffledUnits.flat();
  },

  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  },

  renderCurrentQuestion() {
    if (this.questions.length === 0) return;
    const q = this.questions[this.currentIndex];

    const stimContainer = document.getElementById("stimulus-block-container");
    if (q.stimulus_group_id && this.stimuliMap[q.stimulus_group_id]) {
      const stim = this.stimuliMap[q.stimulus_group_id];
      document.getElementById("stimulus-title").innerText = stim.title || "Wacana Stimulus";
      document.getElementById("stimulus-content").innerText = stim.content || "";
      
      const stimImgWrap = document.getElementById("stimulus-image-wrap");
      const stimImg = document.getElementById("stimulus-image");
      if (stim.image_url) {
        stimImg.src = stim.image_url;
        stimImgWrap.style.display = "block";
      } else {
        stimImgWrap.style.display = "none";
      }

      stimContainer.classList.remove("d-none");
      this.renderMath(stimContainer);
    } else {
      stimContainer.classList.add("d-none");
    }

    document.getElementById("display-q-number").innerText = `Soal No. ${this.currentIndex + 1}`;
    const typeLabel = q.question_type === 'pg' ? 'Pilihan Ganda' : 'PG Kompleks';
    document.getElementById("display-q-type").innerText = typeLabel;
    document.getElementById("display-q-points").innerText = `(${q.points || 1} Poin)`;

    const contentEl = document.getElementById("display-q-content");
    contentEl.innerText = q.content || "";
    this.renderMath(contentEl);

    const imgWrap = document.getElementById("display-q-image-wrap");
    const imgEl = document.getElementById("display-q-image");
    if (q.image_url) {
      imgEl.src = q.image_url;
      imgWrap.style.display = "block";
    } else {
      imgWrap.style.display = "none";
    }

    const optionsContainer = document.getElementById("display-options-list");
    const isPgk = q.question_type === 'pgk';
    const currentAns = this.userAnswers[q.id] || { keys: [], isDoubt: false };

    let optionsHtml = '';
    (q.options || []).forEach(opt => {
      const isChecked = currentAns.keys.includes(opt.option_label);
      const inputType = isPgk ? 'checkbox' : 'radio';
      const nameAttr = isPgk ? '' : 'name="active_exam_option"';
      const selectedClass = isChecked ? 'selected' : '';

      optionsHtml += `
        <label class="option-item ${selectedClass}" data-key="${opt.option_label}">
          <input type="${inputType}" ${nameAttr} value="${opt.option_label}" ${isChecked ? 'checked' : ''} onchange="ExamRunnerModule.handleOptionSelect('${q.id}', '${opt.option_label}', ${isPgk})">
          <div style="flex-grow: 1;">
            <strong>${opt.option_label}.</strong> <span class="math-opt-text">${opt.content}</span>
          </div>
        </label>
      `;
    });

    optionsContainer.innerHTML = optionsHtml;
    this.renderMath(optionsContainer);

    document.getElementById("check-doubt").checked = currentAns.isDoubt;
    document.getElementById("btn-prev-question").style.visibility = (this.currentIndex === 0) ? 'hidden' : 'visible';
    
    const isLast = this.currentIndex === this.questions.length - 1;
    const btnNext = document.getElementById("btn-next-question");
    const btnFinish = document.getElementById("btn-finish-exam");

    if (isLast) {
      btnNext.classList.add("d-none");
      btnFinish.classList.remove("d-none");
    } else {
      btnNext.classList.remove("d-none");
      btnFinish.classList.add("d-none");
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  handleOptionSelect(questionId, optionKey, isPgk) {
    if (!this.userAnswers[questionId]) {
      this.userAnswers[questionId] = { keys: [], isDoubt: false };
    }

    if (!isPgk) {
      this.userAnswers[questionId].keys = [optionKey];
    } else {
      const keys = this.userAnswers[questionId].keys;
      const index = keys.indexOf(optionKey);
      if (index > -1) {
        keys.splice(index, 1);
      } else {
        keys.push(optionKey);
      }
      this.userAnswers[questionId].keys = keys.sort();
    }

    this.saveLocalAnswers();
    this.renderCurrentQuestion();
    this.renderGridNumbers();
  },

  renderGridNumbers() {
    const container = document.getElementById("grid-numbers-container");
    if (!container) return;

    let gridHtml = '';
    this.questions.forEach((q, idx) => {
      const ans = this.userAnswers[q.id];
      let statusClass = '';
      if (ans && ans.isDoubt) {
        statusClass = 'doubt';
      } else if (ans && ans.keys && ans.keys.length > 0) {
        statusClass = 'answered';
      }

      const activeClass = (idx === this.currentIndex) ? 'active' : '';

      gridHtml += `
        <button type="button" class="btn-num ${statusClass} ${activeClass}" onclick="ExamRunnerModule.jumpToQuestion(${idx})">
          ${idx + 1}
        </button>
      `;
    });

    container.innerHTML = gridHtml;
  },

  navigate(direction) {
    const target = this.currentIndex + direction;
    if (target >= 0 && target < this.questions.length) {
      this.currentIndex = target;
      this.renderCurrentQuestion();
      this.renderGridNumbers();
    }
  },

  jumpToQuestion(index) {
    if (index >= 0 && index < this.questions.length) {
      this.currentIndex = index;
      this.renderCurrentQuestion();
      this.renderGridNumbers();
      document.getElementById("drawer-grid").classList.add("d-none");
    }
  },

  initTimer() {
    const storageKey = `timer_end_${this.session.exam.id}_${this.session.student.id}`;
    let endTime = localStorage.getItem(storageKey);

    if (!endTime) {
      const durationMs = (this.session.exam.duration_minutes || 60) * 60 * 1000;
      endTime = Date.now() + durationMs;
      localStorage.setItem(storageKey, endTime);
    } else {
      endTime = parseInt(endTime, 10);
    }

    const timerEl = document.getElementById("timer-display");

    const updateTimer = () => {
      const now = Date.now();
      const diffSec = Math.max(0, Math.floor((endTime - now) / 1000));
      this.remainingSeconds = diffSec;

      const hours = Math.floor(diffSec / 3600);
      const minutes = Math.floor((diffSec % 3600) / 60);
      const seconds = diffSec % 60;

      const hStr = String(hours).padStart(2, '0');
      const mStr = String(minutes).padStart(2, '0');
      const sStr = String(seconds).padStart(2, '0');

      timerEl.innerText = `⏱️ ${hStr}:${mStr}:${sStr}`;

      if (diffSec <= 300) {
        timerEl.classList.add("warning");
      }

      if (diffSec <= 0) {
        clearInterval(this.timerInterval);
        alert("Waktu pengerjaan ujian telah habis! Jawaban Anda akan dikumpulkan secara otomatis.");
        this.finishExam(true);
      }
    };

    updateTimer();
    this.timerInterval = setInterval(updateTimer, 1000);
  },

  saveLocalAnswers() {
    const storageKey = `answers_${this.session.exam.id}_${this.session.student.id}`;
    sessionStorage.setItem(storageKey, JSON.stringify(this.userAnswers));
  },

  restoreLocalAnswers() {
    const storageKey = `answers_${this.session.exam.id}_${this.session.student.id}`;
    const raw = sessionStorage.getItem(storageKey);
    if (raw) {
      try {
        this.userAnswers = JSON.parse(raw);
      } catch {
        this.userAnswers = {};
      }
    }
  },

  // Finalisasi Ujian, Kalkulasi Skor, & Simpan ke Supabase
  async finishExam(isAuto = false) {
    if (!isAuto) {
      const unansweredCount = this.questions.filter(q => !this.userAnswers[q.id] || this.userAnswers[q.id].keys.length === 0).length;
      let confirmMsg = "Apakah Anda yakin ingin menyelesaikan dan mengumpulkan ujian ini?";
      if (unansweredCount > 0) {
        confirmMsg = `Masih ada ${unansweredCount} butir soal yang belum Anda jawab!\n\nApakah Anda benar-benar yakin ingin mengumpulkan ujian sekarang?`;
      }
      if (!confirm(confirmMsg)) return;
    }

    clearInterval(this.timerInterval);
    const timerStorageKey = `timer_end_${this.session.exam.id}_${this.session.student.id}`;
    localStorage.removeItem(timerStorageKey);

    const btnFinish = document.getElementById("btn-finish-exam");
    if (btnFinish) {
      btnFinish.disabled = true;
      btnFinish.innerText = "Mengirim Jawaban...";
    }

    const client = getSupabaseClient();
    try {
      // 1. Kalkulasi Penilaian
      let totalEarnedScore = 0;
      let maxPossibleScore = 0;
      let correctCount = 0;
      const studentAnswersPayload = [];

      this.questions.forEach(q => {
        const qPoints = parseFloat(q.points) || 1.0;
        maxPossibleScore += qPoints;

        const userAns = this.userAnswers[q.id] || { keys: [] };
        const selectedKeys = userAns.keys || [];

        // Kunci benar dari database (array)
        const trueKeys = (q.correct_keys || []).map(k => String(k).toUpperCase().trim());
        const userKeysSorted = [...selectedKeys].map(k => String(k).toUpperCase().trim()).sort();
        const trueKeysSorted = [...trueKeys].sort();

        // Cek kecocokan kunci
        const isCorrect = (userKeysSorted.length === trueKeysSorted.length) &&
          userKeysSorted.every((val, index) => val === trueKeysSorted[index]);

        let scoreEarned = 0;
        if (isCorrect) {
          scoreEarned = qPoints;
          totalEarnedScore += qPoints;
          correctCount++;
        }

        studentAnswersPayload.push({
          question_id: q.id,
          selected_keys: selectedKeys,
          is_correct: isCorrect,
          score_earned: scoreEarned
        });
      });

      // Konversi nilai skala 0 - 100
      const finalPercentage = maxPossibleScore > 0 
        ? Math.round((totalEarnedScore / maxPossibleScore) * 100) 
        : 0;

      // 2. Simpan Rekaman ke Tabel exam_attempts
      const { data: attemptData, error: attemptErr } = await client
        .from('exam_attempts')
        .insert({
          exam_id: this.session.exam.id,
          student_id: this.session.student.id,
          score: finalPercentage,
          total_points: totalEarnedScore,
          started_at: this.startTimeIso,
          submitted_at: new Date().toISOString(),
          status: 'completed'
        })
        .select()
        .single();

      if (attemptErr) throw attemptErr;

      // 3. Simpan Detail Jawaban ke Tabel student_answers
      if (studentAnswersPayload.length > 0) {
        const answersData = studentAnswersPayload.map(a => ({
          attempt_id: attemptData.id,
          question_id: a.question_id,
          selected_keys: a.selected_keys,
          is_correct: a.is_correct,
          score_earned: a.score_earned
        }));

        const { error: ansInsertErr } = await client
          .from('student_answers')
          .insert(answersData);

        if (ansInsertErr) throw ansInsertErr;
      }

      // 4. Simpan ringkasan untuk selesai.html
      const finishSummary = {
        student_name: this.session.student.full_name,
        student_number: this.session.student.student_number,
        exam_title: this.session.exam.title,
        subject: this.session.exam.subject,
        total_questions: this.questions.length,
        correct_count: correctCount,
        final_score: finalPercentage,
        submitted_at: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
      };

      sessionStorage.setItem("exam_finish_result", JSON.stringify(finishSummary));

      // Hapus data sesi pengerjaan lokal
      const answersStorageKey = `answers_${this.session.exam.id}_${this.session.student.id}`;
      sessionStorage.removeItem(answersStorageKey);

      window.location.href = "selesai.html";
    } catch (err) {
      console.error("Gagal menyimpan hasil ujian:", err);
      alert(`Terjadi kendala saat mengirim jawaban: ${err.message}. Hubungi guru pengawas.`);
      if (btnFinish) {
        btnFinish.disabled = false;
        btnFinish.innerText = "Coba Kumpulkan Lagi";
      }
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  ExamRunnerModule.init();
});
