// ==========================================================================
// MODUL UJIAN SISWA: FIX SCROLL LOMPAT KE ATAS SAAT PILIH JAWABAN
// ==========================================================================

const ExamRunnerModule = {
  session: null,
  questions: [],
  stimuliMap: {},
  currentIndex: 0,
  userAnswers: {},
  timerInterval: null,
  remainingSeconds: 0,
  startTimeIso: null,

  violationCount: 0,
  maxViolations: 3,
  isCheatGuardActive: false,
  initialWindowHeight: window.innerHeight,
  isForcedSubmission: false,

  showLoader(message = "Mengirim Jawaban Ujian...") {
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
      alert("Sesi ujian tidak valid. Silakan login kembali.");
      window.location.href = "index.html";
      return;
    }

    this.startTimeIso = new Date().toISOString();

    const titleEl = document.getElementById("header-exam-title");
    const studentInfoEl = document.getElementById("header-student-info");
    if (titleEl) titleEl.innerText = `${this.session.exam.title} (${this.session.exam.subject || '-'})`;
    if (studentInfoEl) studentInfoEl.innerText = `[Absen ${this.session.student.attendance_number || '-'}] ${this.session.student.full_name} (${this.session.student.class_name})`;

    this.setupEvents();
    this.restoreLocalAnswers();
    await this.loadExamContent();
    this.initTimer();
    this.initAntiCheat();
  },

  initAntiCheat() {
    if (!this.session.exam.anti_cheat) return;

    this.isCheatGuardActive = true;
    this.maxViolations = this.session.exam.max_violations || 3;
    this.violationCount = 0;

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.isCheatGuardActive) {
        this.handleViolation("Anda terdeteksi meninggalkan halaman ujian (membuka tab lain atau aplikasi lain)!");
      }
    });

    window.addEventListener("blur", () => {
      setTimeout(() => {
        if (!document.hasFocus() && this.isCheatGuardActive) {
          this.handleViolation("Fokus layar ujian terputus! Dilarang membuka jendela lain.");
        }
      }, 500);
    });

    window.addEventListener("resize", () => {
      if (!this.isCheatGuardActive) return;
      const currentHeight = window.innerHeight;
      const heightDrop = (this.initialWindowHeight - currentHeight) / this.initialWindowHeight;

      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      const isTyping = (activeTag === 'input' || activeTag === 'textarea');

      if (heightDrop > 0.38 && !isTyping) {
        this.handleViolation("Terdeteksi perubahan ukuran layar (Layar Belah / Jendela Mengambang tidak diizinkan)!");
      }
    });
  },

  handleViolation(reason) {
    if (!this.isCheatGuardActive) return;

    this.violationCount++;
    const sisa = this.maxViolations - this.violationCount;

    if (sisa > 0) {
      alert(`⚠️ PERINGATAN KECURANGAN (${this.violationCount}/${this.maxViolations})\n\n${reason}\n\nSisa toleransi: ${sisa} kali lagi. Jika batas habis, ujian Anda otomatis dikunci dan dikumpulkan ke guru!`);
    } else {
      this.isCheatGuardActive = false;
      this.isForcedSubmission = true;
      alert(`🚨 BATAS PELANGGARAN TERLAMPAUI!\n\nAnda melanggar aturan ujian sebanyak ${this.maxViolations} kali. Lembar ujian dikunci dan dikumpulkan paksa.`);
      this.finishExam(true, true);
    }
  },

  setupEvents() {
    document.getElementById("btn-prev-question")?.addEventListener("click", () => this.navigate(-1));
    document.getElementById("btn-next-question")?.addEventListener("click", () => this.navigate(1));
    
    document.getElementById("check-doubt")?.addEventListener("change", (e) => {
      const q = this.questions[this.currentIndex];
      if (!q) return;

      if (!this.userAnswers[q.id]) this.userAnswers[q.id] = { keys: [], isDoubt: false };
      this.userAnswers[q.id].isDoubt = e.target.checked;
      this.saveLocalAnswers();
      this.renderGridNumbers();
    });

    const drawer = document.getElementById("drawer-grid");
    document.getElementById("btn-toggle-grid")?.addEventListener("click", () => drawer?.classList.remove("d-none"));
    document.getElementById("btn-close-grid")?.addEventListener("click", () => drawer?.classList.add("d-none"));
    drawer?.addEventListener("click", (e) => {
      if (e.target === drawer) drawer.classList.add("d-none");
    });

    document.getElementById("btn-finish-exam")?.addEventListener("click", () => this.finishExam(false, false));
  },

  async loadExamContent() {
    const client = getSupabaseClient();
    const examId = this.session.exam.id;

    try {
      const { data: stimuli } = await client.from('stimulus_groups').select('*').eq('exam_id', examId);
      (stimuli || []).forEach(s => this.stimuliMap[s.id] = s);

      const { data: qData, error: qErr } = await client
        .from('questions')
        .select('id, original_number, stimulus_group_id, question_type, points, pgk_score_err1, pgk_score_err2, pgk_score_err3, image_url, content, correct_keys')
        .eq('exam_id', examId)
        .order('original_number', { ascending: true });

      if (qErr) throw qErr;

      const questionIds = qData.map(q => q.id);
      const { data: allOptions } = await client
        .from('options')
        .select('id, question_id, option_label, content, is_correct')
        .in('question_id', questionIds);

      const optionsMap = {};
      (allOptions || []).forEach(opt => {
        if (!optionsMap[opt.question_id]) optionsMap[opt.question_id] = [];
        optionsMap[opt.question_id].push(opt);
      });

      qData.forEach(q => {
        q.options = optionsMap[q.id] || [];
      });

      const shouldRandomizeQuestions = (this.session.exam.randomize_questions === true || this.session.exam.randomize_questions === 'true');
      if (shouldRandomizeQuestions) {
        this.questions = this.shuffleQuestionsByType(qData);
      } else {
        this.questions = qData;
      }

      const shouldRandomizeOptions = (this.session.exam.randomize_options === true || this.session.exam.randomize_options === 'true');
      const standardLabels = ['A', 'B', 'C', 'D', 'E', 'F'];

      this.questions.forEach(q => {
        if (q.options && q.options.length > 1) {
          let opts = [...q.options];
          if (shouldRandomizeOptions) {
            opts = this.shuffleArray(opts);
          } else {
            opts.sort((a, b) => (a.option_label || '').localeCompare(b.option_label || ''));
          }

          q.displayOptions = opts.map((opt, idx) => ({
            ...opt,
            display_label: standardLabels[idx] || String.fromCharCode(65 + idx),
            original_label: opt.option_label
          }));
        } else {
          q.displayOptions = q.options || [];
        }
      });

      this.renderCurrentQuestion();
      this.renderGridNumbers();
    } catch (err) {
      alert(`Gagal mengambil data soal: ${err.message}`);
    }
  },

  shuffleQuestionsByType(questionsList) {
    const pgQuestions = questionsList.filter(q => (q.question_type || 'pg').toLowerCase() === 'pg');
    const pgkQuestions = questionsList.filter(q => (q.question_type || '').toLowerCase() === 'pgk');
    const otherQuestions = questionsList.filter(q => {
      const t = (q.question_type || '').toLowerCase();
      return t !== 'pg' && t !== 'pgk';
    });

    const shuffledPg = this.shuffleQuestionsPreservingStimulus(pgQuestions);
    const shuffledPgk = this.shuffleQuestionsPreservingStimulus(pgkQuestions);
    const shuffledOther = this.shuffleQuestionsPreservingStimulus(otherQuestions);

    return [...shuffledPg, ...shuffledPgk, ...shuffledOther];
  },

  shuffleQuestionsPreservingStimulus(subList) {
    if (!subList || subList.length === 0) return [];
    const units = [];
    const visitedStim = new Set();

    subList.forEach(q => {
      if (!q.stimulus_group_id) {
        units.push([q]);
      } else if (!visitedStim.has(q.stimulus_group_id)) {
        visitedStim.add(q.stimulus_group_id);
        const group = subList.filter(item => item.stimulus_group_id === q.stimulus_group_id);
        units.push(group);
      }
    });

    return this.shuffleArray(units).flat();
  },

  shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },

  renderCurrentQuestion() {
    if (!this.questions || this.questions.length === 0) return;
    const q = this.questions[this.currentIndex];
    if (!q) return;

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

    document.getElementById("display-q-number").innerText = `Soal No. ${this.currentIndex + 1}`;
    document.getElementById("display-q-type").innerText = q.question_type === 'pgk' ? 'PG Kompleks' : 'Pilihan Ganda';
    document.getElementById("display-q-points").innerText = `(${q.points || 1} Poin)`;

    const contentEl = document.getElementById("display-q-content");
    contentEl.innerText = q.content || "";
    this.renderMath(contentEl);

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

    const optionsContainer = document.getElementById("display-options-list");
    const isPgk = q.question_type === 'pgk';
    const currentAns = this.userAnswers[q.id] || { keys: [], isDoubt: false };
    
    const opts = q.displayOptions || q.options || [];

    let optionsHtml = '';
    opts.forEach(opt => {
      const optKey = opt.original_label || opt.option_label;
      const isChecked = currentAns.keys.includes(optKey);
      const letterLabel = opt.display_label || opt.option_label;

      optionsHtml += `
        <label class="option-item ${isChecked ? 'selected' : ''}" data-key="${optKey}">
          <input type="${isPgk ? 'checkbox' : 'radio'}" ${isPgk ? '' : 'name="active_option"'} value="${optKey}" ${isChecked ? 'checked' : ''} onchange="ExamRunnerModule.handleOptionSelect('${q.id}', '${optKey}', ${isPgk})">
          <div class="option-text-wrapper">
            <strong style="margin-right: 4px;">${letterLabel}.</strong> <span class="math-opt-text">${opt.content}</span>
          </div>
        </label>
      `;
    });
    optionsContainer.innerHTML = optionsHtml;
    this.renderMath(optionsContainer);

    document.getElementById("check-doubt").checked = !!currentAns.isDoubt;
    document.getElementById("btn-prev-question").style.visibility = (this.currentIndex === 0) ? 'hidden' : 'visible';

    const isLast = this.currentIndex === this.questions.length - 1;
    document.getElementById("btn-next-question")?.classList.toggle("d-none", isLast);
    document.getElementById("btn-finish-exam")?.classList.toggle("d-none", !isLast);

    // scrollTo DIHAPUS DARI SINI AGAR TIDAK MELOMPAT SAAT MEMILIH OPSI
  },

  // FIX: MEMPERBARUI STATUS CENTANG LANGSUNG DI DOM TANPA ME-RENDER ULANG (SCROLL TETAP DIAM)
  handleOptionSelect(questionId, optionKey, isPgk) {
    if (!this.userAnswers[questionId]) this.userAnswers[questionId] = { keys: [], isDoubt: false };

    if (!isPgk) {
      this.userAnswers[questionId].keys = [optionKey];
      // Update visual opsi radio secara instan tanpa reload halaman
      document.querySelectorAll("#display-options-list .option-item").forEach(item => {
        if (item.getAttribute("data-key") === optionKey) {
          item.classList.add("selected");
        } else {
          item.classList.remove("selected");
        }
      });
    } else {
      const keys = this.userAnswers[questionId].keys || [];
      const idx = keys.indexOf(optionKey);
      if (idx > -1) keys.splice(idx, 1);
      else keys.push(optionKey);
      this.userAnswers[questionId].keys = keys.sort();

      // Update visual opsi checkbox secara instan tanpa reload halaman
      const targetItem = document.querySelector(`#display-options-list .option-item[data-key="${optionKey}"]`);
      if (targetItem) {
        targetItem.classList.toggle("selected", keys.includes(optionKey));
      }
    }

    this.saveLocalAnswers();
    this.renderGridNumbers(); // Hanya mengupdate warna nomor di daftar nomor (tidak mengganggu scroll soal)
  },

  renderGridNumbers() {
    const container = document.getElementById("grid-numbers-container");
    if (!container) return;

    let gridHtml = '';
    this.questions.forEach((q, idx) => {
      const ans = this.userAnswers[q.id];
      let statusClass = '';
      if (ans && ans.isDoubt) statusClass = 'doubt';
      else if (ans && ans.keys && ans.keys.length > 0) statusClass = 'answered';

      gridHtml += `
        <button type="button" class="btn-num ${statusClass} ${idx === this.currentIndex ? 'active' : ''}" onclick="ExamRunnerModule.jumpToQuestion(${idx})">
          ${idx + 1}
        </button>
      `;
    });
    container.innerHTML = gridHtml;
  },

  // SCROLL KE ATAS HANYA SAAT BENAR-BENAR BERPINDAH NOMOR SOAL
  navigate(direction) {
    const target = this.currentIndex + direction;
    if (target >= 0 && target < this.questions.length) {
      this.currentIndex = target;
      this.renderCurrentQuestion();
      this.renderGridNumbers();
      window.scrollTo({ top: 0, behavior: 'smooth' }); // Scroll halus hanya saat ganti nomor
    }
  },

  // SCROLL KE ATAS HANYA SAAT LOMPAT NOMOR SOAL DARI DAFTAR NOMOR
  jumpToQuestion(index) {
    if (index >= 0 && index < this.questions.length) {
      this.currentIndex = index;
      this.renderCurrentQuestion();
      this.renderGridNumbers();
      document.getElementById("drawer-grid")?.classList.add("d-none");
      window.scrollTo({ top: 0, behavior: 'smooth' }); // Scroll halus hanya saat ganti nomor
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

      if (timerEl) {
        timerEl.innerText = `⏱️ ${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
        if (diffSec <= 300) timerEl.classList.add("warning");
      }

      if (diffSec <= 0) {
        clearInterval(this.timerInterval);
        alert("Waktu ujian habis! Jawaban Anda akan dikumpulkan otomatis.");
        this.finishExam(true, false);
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
      try { this.userAnswers = JSON.parse(raw); } catch { this.userAnswers = {}; }
    }
  },

  async finishExam(isAuto = false, isCheatForced = false) {
    if (!isAuto) {
      const unansweredCount = this.questions.filter(q => !this.userAnswers[q.id] || this.userAnswers[q.id].keys.length === 0).length;
      let msg = "Kumpulkan dan selesaikan ujian ini sekarang?";
      if (unansweredCount > 0) msg = `Masih ada ${unansweredCount} soal yang belum dijawab! Tetap kumpulkan?`;
      if (!confirm(msg)) return;
    }

    this.showLoader("Mengumpulkan Lembar Jawaban...");
    this.isCheatGuardActive = false;
    clearInterval(this.timerInterval);
    localStorage.removeItem(`timer_end_${this.session.exam.id}_${this.session.student.id}`);

    const btnFinish = document.getElementById("btn-finish-exam");
    if (btnFinish) btnFinish.disabled = true;

    const finalSubmissionType = isCheatForced ? 'forced_cheat' : 'normal';
    const client = getSupabaseClient();

    try {
      let totalEarnedScore = 0;
      let maxPossibleScore = 0;
      let correctCount = 0;
      const studentAnswersPayload = [];

      this.questions.forEach((q) => {
        const qPoints = parseFloat(q.points) || 1.0;
        maxPossibleScore += qPoints;

        const userAns = this.userAnswers[q.id] || { keys: [] };
        
        const rawSelected = Array.isArray(userAns.keys) ? userAns.keys : String(userAns.keys || '').split(/[,;\s]+/);
        const selectedKeys = rawSelected.map(k => String(k).toUpperCase().trim()).filter(Boolean);

        let trueKeys = [];
        if (q.correct_keys) {
          const rawTrue = Array.isArray(q.correct_keys) ? q.correct_keys : String(q.correct_keys || '').split(/[,;\s]+/);
          trueKeys = rawTrue.map(k => String(k).toUpperCase().trim()).filter(Boolean);
        } else if (q.options && q.options.length > 0) {
          trueKeys = q.options.filter(o => o.is_correct).map(o => String(o.option_label).toUpperCase().trim());
        }

        let scoreEarned = 0;
        let isCorrect = false;

        const isPgk = (q.question_type || '').toLowerCase() === 'pgk';

        if (!isPgk) {
          const isMatch = (selectedKeys.length === 1 && trueKeys.length === 1 && selectedKeys[0] === trueKeys[0]);
          if (isMatch) {
            scoreEarned = qPoints;
            isCorrect = true;
            correctCount++;
          }
        } else {
          const missedKeys = trueKeys.filter(k => !selectedKeys.includes(k));
          const wrongSelectedKeys = selectedKeys.filter(k => !trueKeys.includes(k));
          const totalErrors = missedKeys.length + wrongSelectedKeys.length;

          const parseScore = (val, defaultVal) => {
            if (val !== undefined && val !== null && val !== '') {
              const parsed = parseFloat(val);
              return isNaN(parsed) ? defaultVal : parsed;
            }
            return defaultVal;
          };

          const scoreErr1 = parseScore(q.pgk_score_err1, Number((qPoints * 0.5).toFixed(2)));
          const scoreErr2 = parseScore(q.pgk_score_err2, 0);
          const scoreErr3 = parseScore(q.pgk_score_err3, 0);

          if (totalErrors === 0 && selectedKeys.length > 0) {
            scoreEarned = qPoints;
            isCorrect = true;
            correctCount++;
          } else if (totalErrors === 1) {
            scoreEarned = scoreErr1;
            isCorrect = false;
          } else if (totalErrors === 2) {
            scoreEarned = scoreErr2;
            isCorrect = false;
          } else if (totalErrors === 3) {
            scoreEarned = scoreErr3;
            isCorrect = false;
          } else {
            scoreEarned = 0;
            isCorrect = false;
          }
        }

        totalEarnedScore += scoreEarned;

        studentAnswersPayload.push({
          question_id: q.id,
          selected_keys: selectedKeys,
          is_correct: isCorrect,
          score_earned: scoreEarned
        });
      });

      const finalPercentage = maxPossibleScore > 0 ? Math.round((totalEarnedScore / maxPossibleScore) * 100) : 0;

      // 1. Simpan Attempt ke Supabase
      const { data: attemptData, error: attErr } = await client
        .from('exam_attempts')
        .insert({
          exam_id: this.session.exam.id,
          student_id: this.session.student.id,
          score: finalPercentage,
          total_points: Number(totalEarnedScore.toFixed(2)),
          violation_count: this.violationCount,
          submission_type: finalSubmissionType,
          started_at: this.startTimeIso,
          submitted_at: new Date().toISOString(),
          status: 'completed'
        })
        .select()
        .single();

      if (attErr) throw attErr;

      // 2. Simpan Detail Jawaban Siswa
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

      // 3. Susun Data Spreadsheet: Urut No. 1 s.d. N Asli
      if (this.session.exam.spreadsheet_url) {
        try {
          const sortedOriginalQuestions = [...this.questions].sort((a, b) => (a.original_number || 0) - (b.original_number || 0));
          
          const itemAnalysisData = sortedOriginalQuestions.map(q => {
            const foundAns = studentAnswersPayload.find(a => a.question_id === q.id);
            const selectedKeys = foundAns ? foundAns.selected_keys : [];
            const earned = foundAns ? foundAns.score_earned : 0;
            const isCorr = foundAns ? foundAns.is_correct : false;

            return {
              question_number: q.original_number,
              selected_keys: selectedKeys,
              is_correct: isCorr,
              score_earned: earned
            };
          });

          const payload = {
            student_name: this.session.student.full_name,
            student_number: this.session.student.student_number || "-",
            attendance_number: this.session.student.attendance_number || "-",
            class_name: this.session.student.class_name,
            exam_title: this.session.exam.title,
            subject: this.session.exam.subject,
            submitted_at: new Date().toLocaleString("id-ID"),
            total_questions: this.questions.length,
            total_points: Number(totalEarnedScore.toFixed(2)),
            correct_count: correctCount,
            final_score: finalPercentage,
            submission_type: finalSubmissionType,
            violation_count: this.violationCount,
            item_analysis: itemAnalysisData
          };

          await fetch(this.session.exam.spreadsheet_url, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
          });
        } catch (e) {
          console.warn("Spreadsheet webhook notice:", e);
        }
      }

      // 4. Buka Halaman Selesai
      const finishSummary = {
        student_name: this.session.student.full_name,
        student_number: this.session.student.student_number,
        attendance_number: this.session.student.attendance_number,
        exam_title: this.session.exam.title,
        subject: this.session.exam.subject,
        total_questions: this.questions.length,
        correct_count: correctCount,
        final_score: finalPercentage,
        violation_count: this.violationCount,
        submission_type: finalSubmissionType,
        submitted_at: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
      };

      sessionStorage.setItem("exam_finish_result", JSON.stringify(finishSummary));
      sessionStorage.removeItem(`answers_${this.session.exam.id}_${this.session.student.id}`);
      
      setTimeout(() => {
        window.location.href = "selesai.html";
      }, 500);

    } catch (err) {
      this.hideLoader();
      alert(`Kendala pengiriman jawaban: ${err.message}`);
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
