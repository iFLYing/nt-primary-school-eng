/**
 * 英语单词闯关营 - 前端主逻辑
 */
(function () {
  'use strict';

  // ---------- 全局状态 ----------
  let TOKEN = localStorage.getItem('token') || '';
  let USER = null;
  let LEVELS = [];
  let CURRENT_LEVEL = null;   // 当前关卡对象
  let QUIZ = [];              // 当前题目
  let QUIZ_IDX = 0;
  let QUIZ_SCORE = 0;         // 本关得分（每题10分）
  let QUIZ_RECORDS = [];      // 每题答题记录 {q, chosen, correct}
  const QUESTION_TYPES = ['en2zh', 'zh2en', 'listen'];
  const PER_LEVEL = 10;

  // ---------- 工具 ----------
  const $ = id => document.getElementById(id);
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2200);
  }
  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
    const res = await fetch('/api' + path, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || '请求失败'); e.status = res.status; throw e; }
    return data;
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ---------- 页面切换 ----------
  function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    $('view-' + name).classList.add('active');
    if (name === 'main') window.scrollTo(0, 0);
  }
  function showTab(name) {
    document.querySelectorAll('.tabpage').forEach(v => v.style.display = 'none');
    $('view-' + name).style.display = 'block';
    document.querySelectorAll('.navtab').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  }

  // ---------- 登录 / 注册 ----------
  function bindAuth() {
    $('tabLogin').onclick = () => { $('tabLogin').classList.add('active'); $('tabRegister').classList.remove('active'); $('loginForm').style.display = 'block'; $('registerForm').style.display = 'none'; $('authMsg').textContent = ''; };
    $('tabRegister').onclick = () => { $('tabRegister').classList.add('active'); $('tabLogin').classList.remove('active'); $('loginForm').style.display = 'none'; $('registerForm').style.display = 'block'; $('authMsg').textContent = ''; };
    $('btnLogin').onclick = async () => {
      try {
        const d = await api('/login', { method: 'POST', body: JSON.stringify({ username: $('loginName').value, password: $('loginPass').value }) });
        enterApp(d.token, d.user);
      } catch (e) { $('authMsg').textContent = e.message; }
    };
    $('btnRegister').onclick = async () => {
      try {
        const d = await api('/register', { method: 'POST', body: JSON.stringify({
          username: $('regName').value,
          password: $('regPass').value,
          childNickname: $('regChildNick').value
        }) });
        // 展示自动生成的孩子账号信息
        window.alert('家长账号注册成功！\n\n📱 孩子登录账号：\n  用户名：' + d.child.username + '\n  密码：' + d.child.defaultPassword + '\n\n请把这组账号告诉孩子，孩子用它登录闯关。\n（家长账号 ' + d.user.username + ' 已自动登录）');
        enterApp(d.token, d.user);
      } catch (e) { $('authMsg').textContent = e.message; }
    };
    // 回车提交
    $('loginPass').onkeydown = e => { if (e.key === 'Enter') $('btnLogin').click(); };
  }

  function enterApp(token, user) {
    TOKEN = token; USER = user;
    localStorage.setItem('token', token);
    showView('main');
    showTab('home');
    initMain();
  }

  // ---------- 主界面初始化 ----------
  async function initMain() {
    bindTopbar();
    try {
      const [lv, me, stats, allWords] = await Promise.all([
        api('/levels'),
        api('/me'),
        api('/stats'),
        api('/vocab-all')
      ]);
      LEVELS = lv.levels;
      QuizUtils.setWords(allWords.list);
      applyMe(me);
      renderLevels();
      applyStats(stats);
    } catch (e) {
      // 令牌失效
      if (e.status === 401) { logout(); }
      else toast(e.message);
    }
  }

  function applyMe(me) {
    const p = me.progress;
    $('statStreak').textContent = p.checkinStreak;
    $('statScore').textContent = p.totalScore;
    $('statMastered').textContent = p.wordsMastered;
    $('statPassed').textContent = p.completedLevels + '/' + LEVELS.length;
    $('statSeen').textContent = p.wordsSeen;
    $('statTotal').textContent = 1200;
    const acc = p.totalQuestions ? Math.round(p.totalCorrect / p.totalQuestions * 100) : 0;
    $('statAccuracy').textContent = acc + '%';
    $('profName').textContent = USER.username;
    $('profNick').textContent = USER.nickname;
    $('profPassed').textContent = p.completedLevels;
    $('profScore').textContent = p.totalScore;
    $('profAcc').textContent = acc + '%';
    $('profMastered').textContent = p.wordsMastered;
    $('profStreak').textContent = p.checkinStreak;
    // 打卡按钮状态
    const today = new Date().toISOString().slice(0, 10);
    const done = p.lastCheckin === today;
    $('checkinBtn').textContent = done ? '已打卡 ✓' : '打卡';
    $('checkinBtn').classList.toggle('done', done);
  }

  function applyStats(stats) {
    $('statUsers').textContent = stats.registeredUsers;
  }

  // 关卡渲染
  function renderLevels() {
    const grid = $('levelGrid');
    grid.innerHTML = '';
    const me = $('profileView');
    LEVELS.forEach((lv, i) => {
      // 通关条件：第1关直接开放，其余需前一关已通关
      const unlocked = i === 0 || hasPassed(LEVELS[i - 1].id);
      const passed = hasPassed(lv.id);
      const card = document.createElement('div');
      card.className = 'level-card' + (unlocked ? '' : ' locked') + (passed ? ' passed' : '');
      card.style.borderTopColor = lv.color;
      const score = getScore(lv.id);
      card.innerHTML =
        '<span class="lv-icon">' + (passed ? '✅' : lv.icon) + '</span>' +
        '<div class="lv-title">' + esc(lv.title) + '</div>' +
        '<div class="lv-sub">' + esc(lv.subtitle) + '</div>' +
        '<div class="lv-score">' + (passed ? '已通关 · ' + score + ' 分' : (unlocked ? '点击挑战' : '🔒 先通过上一关')) + '</div>';
      if (unlocked) card.onclick = () => startLevel(lv);
      grid.appendChild(card);
    });
  }
  function hasPassed(id) {
    // 从 profileView 里我们没存，改用查询 /me 进度 —— 存本地缓存
    return PROGRESS ? (id in PROGRESS.levelScores) : false;
  }
  function getScore(id) { return PROGRESS ? (PROGRESS.levelScores[id] || 0) : 0; }
  let PROGRESS = null;

  // ---------- 打卡 ----------
  function bindTopbar() {
    const doCheckin = async () => {
      try {
        const d = await api('/checkin', { method: 'POST', body: '{}' });
        if (d.done) {
          toast('✅ 打卡成功，已连续 ' + d.streak + ' 天！');
          $('checkinBtn').textContent = '已打卡 ✓';
          $('checkinBtn').classList.add('done');
          $('statStreak').textContent = d.streak;
          $('profStreak').textContent = d.streak;
        } else toast('今天已经打过卡啦');
      } catch (e) { toast(e.message); }
    };
    $('checkinBtn').onclick = doCheckin;
    $('btnCheckin').onclick = doCheckin;
    $('logoutBtn').onclick = logout;
  }
  function logout() {
    TOKEN = ''; USER = null; PROGRESS = null;
    localStorage.removeItem('token');
    showView('auth');
  }

  // ---------- 闯关 ----------
  async function startLevel(lv) {
    CURRENT_LEVEL = lv;
    const topicWords = QuizUtils.wordsOf(lv.topic);
    const count = Math.min(PER_LEVEL, topicWords.length);
    QUIZ = QuizUtils.generateQuiz(lv.topic, count, QUESTION_TYPES);
    QUIZ_IDX = 0; QUIZ_SCORE = 0; QUIZ_RECORDS = [];
    $('quizTitle').textContent = lv.title;
    $('quizProgress').textContent = '1 / ' + QUIZ.length;
    showView('quiz');
    renderQuestion();
  }

  function renderQuestion() {
    const q = QUIZ[QUIZ_IDX];
    $('qPrompt').textContent = q.prompt;
    if (q.type === 'listen') {
      $('qDisplay').innerHTML = '<button class="speak-btn" onclick="App.speakWord()">🔊 播放发音</button><span class="q-sub">' + esc(q.sub) + '</span>';
    } else {
      $('qDisplay').innerHTML = esc(q.display) + (q.sub ? '<span class="q-sub">' + esc(q.sub) + '</span>' : '');
    }
    // 选项
    const tags = ['A', 'B', 'C', 'D'];
    const box = $('qOptions');
    box.innerHTML = '';
    q.options.forEach((opt, i) => {
      const b = document.createElement('button');
      b.className = 'q-option';
      b.innerHTML = '<span class="opt-tag">' + tags[i] + '</span>' + esc(opt);
      b.onclick = () => answer(i);
      box.appendChild(b);
    });
    $('qFeedback').style.display = 'none';
    $('btnNext').style.display = 'none';
    $('quizProgress').textContent = (QUIZ_IDX + 1) + ' / ' + QUIZ.length;
  }

  function answer(idx) {
    const q = QUIZ[QUIZ_IDX];
    const correct = idx === q.answer;
    const options = document.querySelectorAll('.q-option');
    options.forEach((o, i) => {
      o.classList.add('disabled');
      if (i === q.answer) o.classList.add('correct');
      if (i === idx && !correct) o.classList.add('wrong');
    });
    if (correct) { QUIZ_SCORE += 10; }
    QUIZ_RECORDS.push({ q, chosen: idx, correct });
    // 反馈
    const fb = $('qFeedback');
    fb.style.display = 'block';
    fb.innerHTML =
      (correct ? '<span class="fb-ok">✓ 答对了！</span>' : '<span class="fb-no">✗ 答错了</span>') +
      '<div class="fb-answer">' + esc(q.explanation) + '</div>';
    $('btnNext').style.display = 'block';
    $('btnNext').textContent = QUIZ_IDX === QUIZ.length - 1 ? '查看成绩' : '下一题';
  }

  $('btnNext') && ($('btnNext').onclick = () => {
    if (QUIZ_IDX === QUIZ.length - 1) finishLevel();
    else { QUIZ_IDX++; renderQuestion(); }
  });

  async function finishLevel() {
    const total = QUIZ.length;
    const correct = QUIZ_RECORDS.filter(r => r.correct).length;
    const passed = correct >= Math.ceil(total * 0.6);
    const wordIds = QUIZ.map(q => q.word.id);
    const masteredIds = QUIZ_RECORDS.filter(r => r.correct).map(r => r.q.word.id);
    let progress;
    try {
      const d = await api('/save-progress', { method: 'POST', body: JSON.stringify({ levelId: CURRENT_LEVEL.id, score: QUIZ_SCORE, correct, total, wordIds, masteredIds }) });
      progress = d.progress;
    } catch (e) { progress = null; }
    if (progress) { PROGRESS = progress; applyMe({ progress, user: USER }); }

    // 结算
    $('resultTitle').textContent = passed ? '🎉 通关成功！' : '😅 再接再厉';
    $('resultTitle').className = 'result-title' + (passed ? '' : ' fail');
    $('resultScore').textContent = QUIZ_SCORE + ' 分';
    $('resultAcc').textContent = '答对 ' + correct + ' / ' + total + ' 题 · 正确率 ' + Math.round(correct / total * 100) + '%' + (passed ? ' · 解锁下一关' : ' · 答对60%即可通关');
    // 错题回顾
    const wrong = QUIZ_RECORDS.filter(r => !r.correct);
    const wb = $('resultWrong');
    if (wrong.length) {
      wb.style.display = 'block';
      wb.innerHTML = '<b>错题回顾：</b><br>' + wrong.map(r =>
        '<div style="margin-top:6px">' + esc(r.q.word.w) + ' <i>(' + esc(r.q.word.m) + ')</i></div>'
      ).join('');
    } else { wb.style.display = 'none'; }
    $('btnNextLevel').style.display = passed ? 'block' : 'none';
    showView('result');
    // 刷新关卡状态
    try { const me = await api('/me'); PROGRESS = me.progress; renderLevels(); } catch (e) {}
  }

  // 全局暴露供 HTML onclick
  window.App = {
    speakWord() {
      const q = QUIZ[QUIZ_IDX];
      if (q && q.speak) QuizUtils.speak(q.speak);
    },
    // 供游戏乐园刷新掌握进度
    async refreshProgress() {
      try {
        const me = await api('/me');
        PROGRESS = me.progress;
        applyMe(me);
        renderLevels();
      } catch (e) {}
    }
  };

  // 结算按钮
  $('btnRetry').onclick = () => { if (CURRENT_LEVEL) startLevel(CURRENT_LEVEL); };
  $('btnNextLevel').onclick = () => {
    const idx = LEVELS.findIndex(l => l.id === CURRENT_LEVEL.id);
    const next = LEVELS[idx + 1];
    if (next) startLevel(next); else { showView('main'); showTab('home'); }
  };
  $('btnBackHome').onclick = () => { showView('main'); showTab('home'); renderLevels(); };
  $('btnQuit').onclick = () => { showView('main'); showTab('home'); };

  // ---------- 排行榜 ----------
  async function loadRank() {
    try {
      const d = await api('/rank');
      const list = $('rankList');
      if (!d.rows.length) { list.innerHTML = '<div class="empty">暂无排行数据</div>'; return; }
      list.innerHTML = d.rows.map((r, i) =>
        '<div class="rank-item">' +
        '<span class="rank-no">' + (i + 1) + '</span>' +
        '<span class="rank-name">' + esc(r.nickname || r.username) + '</span>' +
        '<span class="rank-meta">' + r.completed + '关 · ' + r.streak + '天</span>' +
        '<span class="rank-score">' + r.score + '</span></div>'
      ).join('');
    } catch (e) { toast(e.message); }
  }

  // ---------- 家长看板 ----------
  // 加载当前家长绑定的孩子列表
  async function loadParent() {
    const box = $('parentResult');
    if (!USER || !USER.isParent) {
      box.innerHTML = '<div class="parent-block"><p style="color:#e53935">仅家长账号可查看学习看板。</p><p class="hint">请退出后用家长账号登录，或登录后进入“我的”查看孩子账号。</p></div>';
      return;
    }
    try {
      const d = await api('/parent/progress');
      if (!d.children.length) {
        box.innerHTML = '<div class="parent-block"><p>你还没有绑定孩子账号。</p><p class="hint">注册家长账号时会自动创建一个孩子账号。</p></div>';
        return;
      }
      box.innerHTML = '<p class="hint" style="margin-bottom:8px">点击孩子可查看详细学习进度：</p>' +
        d.children.map(c => {
          const p = c.progress;
          const acc = p.totalQuestions ? Math.round(p.totalCorrect / p.totalQuestions * 100) : 0;
          return '<div class="parent-card" data-username="' + esc(c.child.username) + '">' +
            '<div class="pc-top"><b>👦 ' + esc(c.child.nickname || c.child.username) + '</b><span class="pc-user">' + esc(c.child.username) + '</span></div>' +
            '<div class="pc-meta">已通关 <b>' + p.completedLevels + '</b> 关 · 正确率 <b>' + acc + '%</b> · 连续 <b>' + p.checkinStreak + '</b> 天 · 掌握 <b>' + p.wordsMastered + '</b> 词</div>' +
            '<span class="pc-view">查看详情 ›</span></div>';
        }).join('');
      box.querySelectorAll('.parent-card').forEach(el => {
        el.onclick = () => loadChildDetail(el.dataset.username);
      });
    } catch (e) {
      box.innerHTML = '<div class="parent-block"><p style="color:#e53935">' + esc(e.message) + '</p></div>';
    }
  }

  // 查看某个孩子的详细进度
  async function loadChildDetail(username) {
    const box = $('parentResult');
    try {
      const d = await api('/parent/progress?username=' + encodeURIComponent(username));
      const p = d.progress;
      const acc = p.totalQuestions ? Math.round(p.totalCorrect / p.totalQuestions * 100) : 0;
      let html = '<div class="parent-block">' +
        '<button class="btn btn-ghost" id="btnParentBack" style="margin-bottom:8px">‹ 返回孩子列表</button>' +
        '<h3>' + esc(d.child.nickname || d.child.username) + ' 的学习进度</h3>' +
        '<div class="stats-row sub"><div class="stat"><b>' + p.completedLevels + '</b><span>已通关</span></div>' +
        '<div class="stat"><b>' + acc + '%</b><span>正确率</span></div>' +
        '<div class="stat"><b>' + p.checkinStreak + '</b><span>连续天数</span></div>' +
        '<div class="stat"><b>' + p.wordsMastered + '</b><span>掌握单词</span></div></div>' +
        '<p style="font-size:13px;color:#8a7a5c;margin:8px 0">已学习 <b>' + d.wordStats.wordsSeen + '</b> / ' + d.wordStats.totalWords + ' 词 · 累计得分 <b>' + p.totalScore + '</b></p>' +
        '<h3 style="margin-top:14px">各关卡进度</h3><div class="parent-chart">';
      d.levelDetail.forEach(l => {
        const pct = l.passed ? 100 : Math.min(100, Math.round(l.bestScore / 100 * 100));
        html += '<div class="parent-bar-row"><span class="lb">' + esc(l.title) + '</span>' +
          '<div class="parent-bar"><div class="parent-bar-fill" style="width:' + pct + '%"></div></div>' +
          '<span class="val">' + (l.passed ? '✅' : l.bestScore + '分') + '</span></div>';
      });
      html += '</div></div>';
      box.innerHTML = html;
      $('btnParentBack').onclick = loadParent;
    } catch (e) {
      box.innerHTML = '<div class="parent-block"><p style="color:#e53935">' + esc(e.message) + '</p></div>';
    }
  }

  // ---------- 导航绑定 ----------
  document.querySelectorAll('.navtab').forEach(b => {
    b.onclick = () => {
      showTab(b.dataset.view);
      if (b.dataset.view === 'rank') loadRank();
      if (b.dataset.view === 'home') renderLevels();
      if (b.dataset.view === 'parent') loadParent();
    };
  });

  // ---------- 游戏乐园 ----------
  document.querySelectorAll('.game-card').forEach(card => {
    card.onclick = () => {
      showView('game');
      if (window.GameApp) window.GameApp.start(card.dataset.game);
    };
  });
  $('btnGameBack').onclick = () => { showView('main'); showTab('home'); };

  // ---------- 启动 ----------
  bindAuth();
  if (TOKEN) {
    // 尝试用已有 token 自动登录
    api('/me').then(me => { USER = me.user; PROGRESS = me.progress; showView('main'); showTab('home'); initMain(); })
      .catch(() => { TOKEN = ''; localStorage.removeItem('token'); showView('auth'); });
  } else {
    showView('auth');
  }
})();
