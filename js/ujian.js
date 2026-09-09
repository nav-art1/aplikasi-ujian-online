// ==========================================================================
// MODUL LOGIKA PENGERJAAN UJIAN SISWA (FIX PILIHAN GANDA & FALLBACK OPTIONS)
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

    const titleEl = document.getElementById("header-exam-title");
    const studentInfoEl = document.getElementById("header-student-info");
    if (titleEl) titleEl.innerText = `${this.session.exam.title} (${this.session.exam.subject || '-'})`;
    if (studentInfoEl) studentInfoEl.innerText = `${this.session.student.full_name} (${this.session.student.class_name})`;

    this.setupEvents();
    this.restoreLocalAnswers();
    await this.loadExamContent();
    this.initTimer();
  },

  setupEvents() {
    const btnPrev = document.getElementById("btn-prev-question");
    const btnNext = document.getElementById("btn-next-question");
    const checkDoubt = document.getElementById("check-doubt");
    const drawer = document.getElementById("drawer-grid");
    const btnToggleGrid = document.getElementById("btn-toggle-grid");
    const btnCloseGrid = document.getElementById("btn-close-grid");
    const btnFinish = document.getElementById("btn-finish-exam");

    if (btnPrev) btnPrev.addEventListener("click", () => this.navigate(-1));
    if (btnNext) btnNext.addEventListener("click", () => this.navigate(1));
    
    if (checkDoubt) {
      checkDoubt.addEventListener("change", (e) => {
        const q = this.questions[this.currentIndex];
        if (!q) return;

        if (!this.userAnswers[q.id]) {
          this.userAnswers[q.id] = { keys: [], isDoubt: false };
        }
        this.userAnswers[q.id].isDoubt = e.target.checked;
        this.saveLocalAnswers();
        this.renderGridNumbers();
      });
    }

    if (btnToggleGrid && drawer) btnToggleGrid.addEventListener("click", () => drawer.classList.remove("d-none"));
    if (btnCloseGrid && drawer) btnCloseGrid.addEventListener("click", () => drawer.classList.add("d-none"));
    if (drawer) {
      drawer.addEventListener("click", (e) => {
        if (e.target === drawer) drawer.classList.add("d-none");
      });
    }

    if (btnFinish) btnFinish.addEventListener("click", () => this.finishExam(false));
  },

  async loadExamContent() {
    const client = getSupabaseClient();
    const examId = this.session.exam.id;

    try {
      // 1. Ambil data stimulus
      const { data: stimuli } = await client
        .from('stimulus_groups')
        .select('*')
        .eq('exam_id', examId);

      (stimuli || []).forEach(s => {
        this.stimuliMap[s.id] = s;
      });

      // 2. Ambil butir soal
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
            question_id,
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

      // 3. Cadangan (Fallback): jika relasi options di atas menghasilkan array kosong, ambil langsung dari tabel options
      let allNeedFallback = qData.some(q => !q.options || q.options.length === 0);
      if (allNeedFallback) {
        const questionIds = qData.map(q => q.id);
        const { data: directOptions, error: optErr } = await client
          .from('options')
          .select('id, question_id, option_label, content')
          .in('question_id', questionIds);

        if (!optErr && directOptions && directOptions.length > 0) {
          const optMap = {};
          directOptions.forEach(opt => {
            if (!optMap[opt.question_id]) optMap[opt.question_id] = [];
            optMap[opt.question_id].push(opt);
          });

          qData.forEach(q => {
            if (!q.options || q.options.length === 0) {
              q.options = optMap[q.id] || [];
            }
          });
        }
      }

      // 4. Pengacakan soal jika diaktifkan (tetap menjaga kelompok stimulus)
      if (this.session.exam.randomize_questions) {
        this.questions = this.shuffleQuestionsPreservingStimulus(qData);
      } else {
        this.questions = qData;
      }

      // 5. Pengacakan opsi jika diaktifkan
      if (this.session.exam.randomize_options) {
        this.questions.forEach(q => {
          if (q.options && q.options.length > 0) {
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
    if (!this.questions || this.questions.length === 0) return;
    const q = this.questions[this.currentIndex];
    if (!q) return;

    // 1. Render Blok Stimulus
    const stimContainer = document.getElementById("stimulus-block-container");
    if (stimContainer) {
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
    }

    // 2. Render Teks Pertanyaan & Poin
    const numEl = document.getElementById("display-q-number");
    const typeEl = document.getElementById("display-q-type");
    const pointsEl = document.getElementById("display-q-points");
    const contentEl = document.getElementById("display-q-content");

    if (numEl) numEl.innerText = `Soal No. ${this.currentIndex + 1}`;
    const typeLabel = q.question_type === 'pgk' ? 'PG Kompleks' : 'Pilihan Ganda';
    if (typeEl) typeEl.innerText = typeLabel;
    if (pointsEl) pointsEl.innerText = `(${q.points || 1} Poin)`;

    if (contentEl) {
      contentEl.innerText = q.content || "";
      this.renderMath(contentEl);
    }

    const imgWrap = document.getElementById("display-q-image-wrap");
    const imgEl = document.getElementById("display-q-image");
    if (imgWrap && imgEl) {
      if (q.image_url) {
        imgEl.src = q.image_url;
        imgWrap.style.display = "block";
      } else {
        imgWrap.style.display = "none";
      }
    }

    // 3. Render Pilihan Ganda (Opsi A s.d. F)
    const optionsContainer = document.getElementById("display-options-list");
    if (optionsContainer) {
      const isPgk = q.question_type === 'pgk';
      const currentAns = this.userAnswers[q.id] || { keys: [], isDoubt: false };
      
      // Ambil opsi yang tersedia dan urutkan
      const opts = (q.options || []).sort((a, b) => (a.option_label || '').localeCompare(b.option_label || ''));

      if (opts.length === 0) {
        optionsContainer.innerHTML = '<div class="alert alert-error">Pilihan jawaban belum tersedia pada butir soal ini. Hubungi pengawas.</div>';
      } else {
        let optionsHtml = '';
        opts.forEach(opt => {
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
      }
    }

    // 4. Status Ragu-Ragu
    const currentAnsObj = this.userAnswers[q.id] || { keys: [], isDoubt: false };
    const checkDoubtEl = document.getElementById("check-doubt");
    if (checkDoubtEl) checkDoubtEl.checked = !!currentAnsObj.isDoubt;

    // 5. Visibilitas Tombol Navigasi
    const btnPrev = document.getElementById("btn-prev-question");
    if (btnPrev) btnPrev.style.visibility = (this.currentIndex === 0) ? 'hidden' : 'visible';
    
    const isLast = this.currentIndex === this.questions.length - 1;
    const btnNext = document.getElementById("btn-next-question");
    const btnFinish = document.getElementById("btn-finish-exam");

    if (btnNext && btnFinish) {
      if (isLast) {
        btnNext.classList.add("d-none");
        btnFinish.classList.remove("d-none");
      } else {
        btnNext.classList.remove("d-none");
        btnFinish.classList.add("d-none");
      }
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  handleOptionSelect(questionId, optionKey, isPgk) {
    if (!this.userAnswers[questionId]) {
      this.userAnswers[questionId] = { keys: [], isDoubt: false };
    }

    if (!isPgk) {
      // Pilihan ganda biasa (1 pilihan)
      this.userAnswers[questionId].keys = [optionKey];
    } else {
      // PG Kompleks (multi pilihan)
      const keys = this.userAnswers[questionId].keys || [];
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
      const drawer = document.getElementById("drawer-grid");
      if (drawer) drawer.classList.add("d-none");
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

      if (timerEl) {
        timerEl.innerText = `⏱️ ${hStr}:${mStr}:${sStr}`;
        if (diffSec <= 300) {
          timerEl.classList.add("warning");
        }
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
      let totalEarnedScore = 0;
      let maxPossibleScore = 0;
      let correctCount = 0;
      const studentAnswersPayload = [];

      this.questions.forEach(q => {
        const qPoints = parseFloat(q.points) || 1.0;
        maxPossibleScore += qPoints;

        const userAns = this.userAnswers[q.id] || { keys: [] };
        const selectedKeys = userAns.keys || [];

        const trueKeys = (q.correct_keys || []).map(k => String(k).toUpperCase().trim());
        const userKeysSorted = [...selectedKeys].map(k => String(k).toUpperCase().trim()).sort();
        const trueKeysSorted = [...trueKeys].sort();

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

      const finalPercentage = maxPossibleScore > 0 
        ? Math.round((totalEarnedScore / maxPossibleScore) * 100) 
        : 0;

      // Simpan ke exam_attempts
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

      // Simpan ke student_answers
      if (studentAnswersPayload.length > 0) {
        const answersData = studentAnswersPayload.map(a => ({
          attempt_id: attemptData.id,
          question_id: a.question_id,
          selected_keys: a.selected_keys,
          is_correct: a.is_correct,
          score_earned: a.score_earned
        }));

        await client.from('student_answers').insert(answersData);
      }

      // Simpan ringkasan untuk selesai.html
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

      const answersStorageKey = `answers_${this.session.exam.id}_${this.session.student.id}`;
      sessionStorage.removeItem(answersStorageKey);

      window.location.href = "selesai.html";
    } catch (err) {
      console.error("Gagal menyimpan hasil ujian:", err);
      alert(`Terjadi kendala saat mengirim jawaban: ${err.message}`);
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
