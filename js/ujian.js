// ==========================================================================
// MODUL PENGERJAAN UJIAN: PENILAIAN PARSIAL PGK, ANTI-CURANG, & WEBHOOK
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
        .select('id, original_number, stimulus_group_id, question_type, points, image_url, content, correct_keys')
        .eq('exam_id', examId)
        .order('original_number', { ascending: true });

      if (qErr) throw qErr;

      const questionIds = qData.map(q => q.id);
      const { data: allOptions } = await client.from('options').select('id, question_id, option_label, content').in('question_id', questionIds);

      const optionsMap = {};
      (allOptions || []).forEach(opt => {
        if (!optionsMap[opt.question_id]) optionsMap[opt.question_id] = [];
        optionsMap[opt.question_id].push(opt);
      });

      qData.forEach(q => q.options = optionsMap[q.id] || []);

      if (this.session.exam.randomize_questions) {
        this.questions = this.shuffleQuestionsByType(qData);
      } else {
        this.questions = qData;
      }

      if (this.session.exam.randomize_options) {
        this.questions.forEach(q => {
          if (q.options && q.options.length > 0) q.options = this.shuffleArray([...q.options]);
        });
      }

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
    const opts = (q.options || []).sort((a, b) => (a.option_label || '').localeCompare(b.option_label || ''));

    let optionsHtml = '';
    opts.forEach(opt => {
      const isChecked = currentAns.keys.includes(opt.option_label);
      optionsHtml += `
        <label class="option-item ${isChecked ? 'selected' : ''}" data-key="${opt.option_label}">
          <input type="${isPgk ? 'checkbox' : 'radio'}" ${isPgk ? '' : 'name="active_option"'} value="${opt.option_label}" ${isChecked ? 'checked' : ''} onchange="ExamRunnerModule.handleOptionSelect('${q.id}', '${opt.option_label}', ${isPgk})">
          <div style="flex-grow: 1;">
            <strong>${opt.option_label}.</strong> <span class="math-opt-text">${opt.content}</span>
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

    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  handleOptionSelect(questionId, optionKey, isPgk) {
    if (!this.userAnswers[questionId]) this.userAnswers[questionId] = { keys: [], isDoubt: false };

    if (!isPgk) {
      this.userAnswers[questionId].keys = [optionKey];
    } else {
      const keys = this.userAnswers[questionId].keys || [];
      const idx = keys.indexOf(optionKey);
      if (idx > -1) keys.splice(idx, 1);
      else keys.push(optionKey);
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
      document.getElementById("drawer-grid")?.classList.add("d-none");
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

    this.isCheatGuardActive = false;
    clearInterval(this.timerInterval);
    localStorage.removeItem(`timer_end_${this.session.exam.id}_${this.session.student.id}`);

    const btnFinish = document.getElementById("btn-finish-exam");
    if (btnFinish) {
      btnFinish.disabled = true;
      btnFinish.innerText = "Mengirim Jawaban...";
    }

    const finalSubmissionType = isCheatForced ? 'forced_cheat' : 'normal';
    const client = getSupabaseClient();

    try {
      let totalEarnedScore = 0;
      let maxPossibleScore = 0;
      let correctCount = 0;
      const studentAnswersPayload = [];

      // =====================================================================
      // SISTEM PENILAIAN BARU: PGK BERBOBOT PARSIAL (SALAH 1 = 50%, SALAH >= 2 = 0)
      // =====================================================================
      this.questions.forEach((q) => {
        const qPoints = parseFloat(q.points) || 1.0;
        maxPossibleScore += qPoints;

        const userAns = this.userAnswers[q.id] || { keys: [] };
        const selectedKeys = (userAns.keys || []).map(k => String(k).toUpperCase().trim());
        const trueKeys = (q.correct_keys || []).map(k => String(k).toUpperCase().trim());

        let scoreEarned = 0;
        let isCorrect = false;

        const isPgk = (q.question_type || '').toLowerCase() === 'pgk';

        if (!isPgk) {
          // Pilihan Ganda Biasa (1 Kunci)
          const isMatch = (selectedKeys.length === trueKeys.length) &&
            selectedKeys.every((val, index) => val === trueKeys[index]);

          if (isMatch && selectedKeys.length > 0) {
            scoreEarned = qPoints;
            isCorrect = true;
            correctCount++;
          }
        } else {
          // PG Kompleks (Multi Kunci): Hitung selisih ketidakcocokan
          // missedKeys = Kunci benar yang tidak dicentang siswa
          const missedKeys = trueKeys.filter(k => !selectedKeys.includes(k));
          // wrongSelectedKeys = Opsi salah yang keliru dicentang siswa
          const wrongSelectedKeys = selectedKeys.filter(k => !trueKeys.includes(k));

          const totalErrors = missedKeys.length + wrongSelectedKeys.length;

          if (totalErrors === 0 && selectedKeys.length > 0) {
            // Benar semua tanpa cela -> Nilai Full (100%)
            scoreEarned = qPoints;
            isCorrect = true;
            correctCount++;
          } else if (totalErrors === 1) {
            // Salah 1 (bisa kurang 1 centangan atau lebih 1 centangan salah) -> Nilai Setengah (50%)
            scoreEarned = qPoints * 0.5;
            isCorrect = false;
          } else {
            // Salah 2 atau lebih -> Nilai 0
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
          total_points: totalEarnedScore,
          violation_count: this.violationCount,
          submission_type: finalSubmissionType,
          started_at: this.startTimeIso,
          submitted_at: new Date().toISOString(),
          status: 'completed'
        })
        .select()
        .single();

      if (attErr) throw attErr;

      // 2. Simpan Jawaban Siswa
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

      // 3. SUSUN DATA SPREADSHEET URUT NO. 1 S.D. N ASLI DARI BANK SOAL
      if (this.session.exam.spreadsheet_url) {
        try {
          const sortedOriginalQuestions = [...this.questions].sort((a, b) => (a.original_number || 0) - (b.original_number || 0));
          
          const itemAnalysisData = sortedOriginalQuestions.map(q => {
            const userAns = this.userAnswers[q.id] || { keys: [] };
            const selectedKeys = (userAns.keys || []).map(k => String(k).toUpperCase().trim());
            const trueKeys = (q.correct_keys || []).map(k => String(k).toUpperCase().trim());

            let isItemFullCorrect = false;
            let itemScoreLabel = "0";

            const isPgk = (q.question_type || '').toLowerCase() === 'pgk';
            if (!isPgk) {
              isItemFullCorrect = (selectedKeys.length === trueKeys.length) &&
                selectedKeys.every((val, index) => val === trueKeys[index]) && selectedKeys.length > 0;
              itemScoreLabel = isItemFullCorrect ? "1" : "0";
            } else {
              const missed = trueKeys.filter(k => !selectedKeys.includes(k));
              const wrong = selectedKeys.filter(k => !trueKeys.includes(k));
              const errs = missed.length + wrong.length;

              if (errs === 0 && selectedKeys.length > 0) {
                isItemFullCorrect = true;
                itemScoreLabel = "1";
              } else if (errs === 1) {
                isItemFullCorrect = false;
                itemScoreLabel = "0.5";
              } else {
                isItemFullCorrect = false;
                itemScoreLabel = "0";
              }
            }

            return {
              question_number: q.original_number,
              selected_keys: selectedKeys,
              is_correct: isItemFullCorrect,
              score_label: itemScoreLabel
            };
          });

          const payload = {
            student_name: this.session.student.full_name,
            student_number: this.session.student.student_number,
            attendance_number: this.session.student.attendance_number || "-",
            class_name: this.session.student.class_name,
            exam_title: this.session.exam.title,
            subject: this.session.exam.subject,
            submitted_at: new Date().toLocaleString("id-ID"),
            total_questions: this.questions.length,
            correct_count: correctCount,
            final_score: finalPercentage,
            submission_type: finalSubmissionType,
            violation_count: this.violationCount,
            item_analysis: itemAnalysisData
          };

          fetch(this.session.exam.spreadsheet_url, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }).catch(err => console.warn("Spreadsheet Notice:", err));
        } catch (e) {
          console.warn("Gagal sinkron spreadsheet:", e);
        }
      }

      // 4. Buka Halaman selesai.html
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
      window.location.href = "selesai.html";
    } catch (err) {
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
