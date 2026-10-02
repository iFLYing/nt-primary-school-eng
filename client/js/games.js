/**
 * 英语闯关营 - 趣味游戏乐园
 * 包含：拼词达人、翻牌记忆、连连看、填词高手
 * 联动：答对单词标记为"已掌握"，游戏结束刷新掌握进度
 */
(function () {
  'use strict';
  const ALL = () => QuizUtils.getAllWords() || [];
  const $ = id => document.getElementById(id);
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function shuffle(a) { return QuizUtils.shuffle(a); }
  function speak(t) { QuizUtils.speak(t); }
  function escRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // 主题中文名（分类挑战等使用）
  const TOPIC_CN = {
    animal: '动物', color: '颜色', number: '数字', time: '时间', weather: '天气', body: '身体',
    family: '家庭', school: '校园', stationery: '文具', food: '食物', fruit: '果蔬', clothes: '服装',
    sport: '运动', transport: '交通', place: '地点', job: '职业', action: '动作', adjective: '形容',
    household: '物品', function: '功能', nature: '自然', emotion: '情绪', festival: '节日'
  };

  // 答对单词标记为已掌握
  async function markWord(wordId) {
    const token = localStorage.getItem('token');
    if (!token) return;
    try { await fetch('/api/word-result', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ wordId, correct: true }) }); } catch (e) {}
  }

  function start(type) {
    const title = { wordbuild: '🔤 拼词达人', memory: '🃏 翻牌记忆', match: '🔗 连连看', fill: '✏️ 填词高手', sort: '🗂️ 分类挑战', whack: '🐭 打地鼠快选', chain: '🐉 单词接龙' }[type] || '游戏';
    $('gameTitle').textContent = title;
    $('gameInfo').textContent = '';
    const body = $('gameBody');
    body.innerHTML = '';
    const games = { wordbuild, memory, match, fill, sort: sortGame, whack, chain };
    if (games[type]) games[type](body); else body.innerHTML = '<p style="text-align:center;color:#888;margin-top:40px">未知游戏</p>';
  }

  /* ================= 1. 拼词达人 ================= */
  function wordbuild(body) {
    const ROUND = 10;
    let idx = 0, score = 0, correct = 0, mastered = [];
    let picked = [], chosen = [], cur = null;
    picked = shuffle(ALL()).slice(0, ROUND);

    function render() {
      cur = picked[idx];
      chosen = [];
      const letters = shuffle(cur.w.split(''));
      const h = document.createElement('div');
      h.className = 'game-wrap';
      h.innerHTML =
        '<div class="wb-info"><b>' + esc(cur.m) + '</b> <i>' + esc(cur.p || '') + '</i> <button class="speak-btn" id="wbSpeak">🔊</button></div>' +
        '<div class="wb-slot" id="wbSlot"></div>' +
        '<div class="wb-letters" id="wbLetters"></div>' +
        '<div class="wb-actions">' +
          '<button class="btn btn-ghost" id="wbUndo">撤销</button>' +
          '<button class="btn btn-ghost" id="wbHint">提示</button>' +
          '<button class="btn btn-primary" id="wbOk">确定</button>' +
        '</div>' +
        '<div class="game-progress">第 ' + (idx + 1) + ' / ' + ROUND + ' 题 · 得分 ' + score + '</div>';
      body.appendChild(h);
      $('wbSpeak').onclick = () => speak(cur.w);
      const slot = $('wbSlot');
      cur.w.split('').forEach(() => { const d = document.createElement('div'); d.className = 'wb-slot-cell'; slot.appendChild(d); });
      const lb = $('wbLetters');
      letters.forEach((ch, i) => {
        const b = document.createElement('button');
        b.className = 'wb-letter'; b.textContent = ch; b.dataset.key = i;
        b.onclick = () => place(b);
        lb.appendChild(b);
      });
      $('wbUndo').onclick = undo;
      $('wbHint').onclick = hint;
      $('wbOk').onclick = submit;
    }
    function place(b) {
      const cells = $('wbSlot').children;
      for (let i = 0; i < cells.length; i++) {
        if (!cells[i].textContent) {
          cells[i].textContent = b.textContent; cells[i].dataset.key = b.dataset.key;
          b.style.visibility = 'hidden'; chosen.push({ cell: i, key: b.dataset.key, btn: b });
          return;
        }
      }
    }
    function undo() {
      if (!chosen.length) return;
      const last = chosen.pop();
      const cells = $('wbSlot').children;
      cells[last.cell].textContent = ''; cells[last.cell].dataset.key = '';
      last.btn.style.visibility = 'visible';
    }
    function hint() {
      const cells = $('wbSlot').children;
      for (let i = 0; i < cells.length; i++) {
        if (!cells[i].textContent) {
          const ch = cur.w[i];
          cells[i].textContent = ch; cells[i].classList.add('wb-hint');
          const lb = $('wbLetters');
          for (const b of lb.children) {
            if (b.textContent === ch && b.style.visibility !== 'hidden' && !b.dataset.used) {
              b.style.visibility = 'hidden'; b.dataset.used = 1;
              chosen.push({ cell: i, key: 'hint', btn: b });
              break;
            }
          }
          break;
        }
      }
    }
    function submit() {
      const cells = $('wbSlot').children;
      const word = [...cells].map(c => c.textContent).join('');
      if (word.length !== cur.w.length) { $('gameInfo').textContent = '请先拼满所有字母'; return; }
      const ok = word === cur.w;
      if (ok) { correct++; score += 10; mastered.push(cur); markWord(cur.id); speak(cur.w); }
      [...cells].forEach((c, i) => {
        c.classList.add(ok ? 'wb-ok' : 'wb-no');
        if (!ok) c.textContent = cur.w[i];
      });
      $('gameInfo').textContent = ok ? '✓ 拼对了！' : '✗ 正确拼写：' + cur.w;
      setTimeout(next, ok ? 900 : 1600);
    }
    function next() {
      idx++;
      if (idx >= ROUND) return end(body, { type: '拼词达人', score, correct, total: ROUND, words: mastered });
      render();
    }
    render();
  }

  /* ================= 2. 翻牌记忆 ================= */
  function memory(body) {
    const PAIRS = 6;
    const words = shuffle(ALL()).slice(0, PAIRS);
    let cards = [];
    words.forEach(w => {
      cards.push({ id: w.id, text: w.w, en: true, w });
      cards.push({ id: w.id, text: w.m, en: false, w });
    });
    cards = shuffle(cards);
    let flipped = [], matched = 0, moves = 0, mastered = [];
    const h = document.createElement('div');
    h.className = 'game-wrap';
    h.innerHTML = '<div class="mem-grid" id="memGrid"></div><div class="game-progress" id="memInfo"></div>';
    body.appendChild(h);
    const grid = $('memGrid');
    cards.forEach((c, i) => {
      const d = document.createElement('div');
      d.className = 'mem-card'; d.dataset.i = i;
      d.innerHTML = '<div class="mem-inner"><div class="mem-front">?</div><div class="mem-back">' + esc(c.text) + '</div></div>';
      d.onclick = () => flip(d, i, c);
      grid.appendChild(d);
    });
    function upd() { $('memInfo').textContent = '翻牌 ' + moves + ' 次 · 已配对 ' + matched + ' / ' + PAIRS; }
    function flip(d, i, c) {
      if (d.classList.contains('flipped') || d.classList.contains('done')) return;
      if (flipped.length >= 2) return;
      d.classList.add('flipped');
      if (c.en) speak(c.text);
      flipped.push({ d, i, c });
      if (flipped.length === 2) {
        moves++;
        const [a, b] = flipped;
        if (a.c.id === b.c.id && a.c.en !== b.c.en) {
          matched++;
          a.d.classList.add('done'); b.d.classList.add('done');
          mastered.push(a.c.w); markWord(a.c.id);
          flipped = []; upd();
          if (matched === PAIRS) setTimeout(() => end(body, { type: '翻牌记忆', score: matched * 10, correct: matched, total: PAIRS, words: mastered }), 700);
        } else {
          upd();
          setTimeout(() => { a.d.classList.remove('flipped'); b.d.classList.remove('flipped'); flipped = []; }, 850);
        }
      }
    }
    upd();
  }

  /* ================= 3. 连连看 ================= */
  function match(body) {
    const N = 6;
    const words = shuffle(ALL()).slice(0, N);
    const left = shuffle(words), right = shuffle(words);
    let selLeft = null, done = 0, mastered = [];
    const h = document.createElement('div');
    h.className = 'game-wrap';
    h.innerHTML = '<div class="mm-grid" id="mmGrid"></div><div class="game-progress" id="mmInfo"></div>';
    body.appendChild(h);
    const grid = $('mmGrid');
    const lCol = document.createElement('div'); lCol.className = 'mm-col'; lCol.id = 'mmLeft';
    const rCol = document.createElement('div'); rCol.className = 'mm-col'; rCol.id = 'mmRight';
    grid.appendChild(lCol); grid.appendChild(rCol);
    left.forEach(w => {
      const b = document.createElement('button'); b.className = 'mm-item'; b.textContent = w.w; b.dataset.wid = w.id;
      b.onclick = () => pickLeft(b, w); lCol.appendChild(b);
    });
    right.forEach(w => {
      const b = document.createElement('button'); b.className = 'mm-item'; b.textContent = w.m; b.dataset.wid = w.id;
      b.onclick = () => pickRight(b, w); rCol.appendChild(b);
    });
    function upd() { $('mmInfo').textContent = '已连线 ' + done + ' / ' + N; }
    function pickLeft(b, w) {
      document.querySelectorAll('#mmLeft .mm-item').forEach(x => x.classList.remove('sel'));
      if (b.classList.contains('done')) { selLeft = null; return; }
      b.classList.add('sel'); selLeft = { b, w };
    }
    function pickRight(b, w) {
      if (!selLeft) return;
      const ok = selLeft.w.id === w.id;
      if (ok) {
        selLeft.b.classList.add('done'); b.classList.add('done'); selLeft.b.classList.remove('sel');
        speak(selLeft.w.w); mastered.push(selLeft.w); markWord(w.id);
        done++; selLeft = null; upd();
        if (done === N) setTimeout(() => end(body, { type: '连连看', score: done * 10, correct: done, total: N, words: mastered }), 600);
      } else {
        b.classList.add('shake'); setTimeout(() => b.classList.remove('shake'), 400);
      }
    }
    upd();
  }

  /* ================= 4. 填词高手 ================= */
  function fill(body) {
    const ROUND = 10;
    const withE = ALL().filter(w => w.e && w.ec);
    const pool = shuffle(withE.length >= ROUND ? withE : ALL()).slice(0, ROUND);
    let idx = 0, score = 0, correct = 0, mastered = [];
    function render() {
      const w = pool[idx];
      const distract = shuffle(ALL().filter(x => x.w !== w.w)).slice(0, 3).map(x => x.w);
      const opts = shuffle([w.w, ...distract]);
      const blanked = w.e ? w.e.replace(new RegExp('\\b' + escRegex(w.w) + '\\b', 'i'), '______') : '';
      const h = document.createElement('div');
      h.className = 'game-wrap';
      h.innerHTML =
        '<div class="fill-sent">' + (blanked ? esc(blanked) : '') + '</div>' +
        '<div class="fill-meaning">释义：<b>' + esc(w.m) + '</b> · 首字母 <b>' + esc(w.w[0]) + '</b> <button class="speak-btn" id="fillSpeak">🔊</button></div>' +
        '<div class="fill-opts" id="fillOpts"></div>' +
        '<div class="game-progress">第 ' + (idx + 1) + ' / ' + ROUND + ' 题 · 得分 ' + score + '</div>';
      body.innerHTML = ''; body.appendChild(h);
      $('fillSpeak').onclick = () => speak(w.w);
      const ob = $('fillOpts');
      opts.forEach(o => {
        const b = document.createElement('button'); b.className = 'fill-opt'; b.textContent = o;
        b.onclick = () => {
          const ok = o === w.w;
          if (ok) { correct++; score += 10; mastered.push(w); markWord(w.id); speak(w.w); }
          [...ob.children].forEach(x => { x.classList.add('disabled'); if (x.textContent === w.w) x.classList.add('ok'); if (x === b && !ok) x.classList.add('no'); });
          setTimeout(next, ok ? 900 : 1500);
        };
        ob.appendChild(b);
      });
    }
    function next() {
      idx++;
      if (idx >= ROUND) return end(body, { type: '填词高手', score, correct, total: ROUND, words: mastered });
      render();
    }
    render();
  }

  /* ================= 5. 分类挑战 ================= */
  function sortGame(body) {
    const topics = shuffle(Object.keys(TOPIC_CN)).slice(0, 3);
    let questions = [];
    topics.forEach(t => {
      shuffle(ALL().filter(w => w.topic === t)).slice(0, 3).forEach(w => questions.push(w));
    });
    questions = shuffle(questions);
    const topicsMeta = topics.map(t => ({ topic: t, cn: TOPIC_CN[t] }));
    let idx = 0, score = 0, correct = 0, mastered = [];
    function render() {
      const w = questions[idx];
      const h = document.createElement('div');
      h.className = 'game-wrap';
      h.innerHTML =
        '<div class="sort-word"><b>' + esc(w.w) + '</b> <i>' + esc(w.m) + '</i> <button class="speak-btn" id="sortSpeak">🔊</button></div>' +
        '<div class="sort-tip">这个单词属于哪个主题？</div>' +
        '<div class="sort-baskets" id="sortBaskets"></div>' +
        '<div class="game-progress">第 ' + (idx + 1) + ' / ' + questions.length + ' 题 · 得分 ' + score + '</div>';
      body.innerHTML = ''; body.appendChild(h);
      $('sortSpeak').onclick = () => speak(w.w);
      const bk = $('sortBaskets');
      topicsMeta.forEach(tm => {
        const b = document.createElement('button');
        b.className = 'sort-basket'; b.textContent = '🗂️ ' + tm.cn;
        b.onclick = () => {
          const ok = tm.topic === w.topic;
          if (ok) { correct++; score += 10; mastered.push(w); markWord(w.id); speak(w.w); [...bk.children].forEach(x => x.classList.add('disabled')); b.classList.add('ok'); setTimeout(next, 700); }
          else { b.classList.add('shake'); setTimeout(() => b.classList.remove('shake'), 400); }
        };
        bk.appendChild(b);
      });
    }
    function next() {
      idx++;
      if (idx >= questions.length) return end(body, { type: '分类挑战', score, correct, total: questions.length, words: mastered });
      render();
    }
    render();
  }

  /* ================= 6. 打地鼠快选 ================= */
  function whack(body) {
    const TOTAL = 25;
    let idx = 0, score = 0, correct = 0, mastered = [], target = null;
    function newRound() {
      if (idx >= TOTAL) return end(body, { type: '打地鼠快选', score, correct, total: TOTAL, words: mastered });
      target = shuffle(ALL())[0];
      const cells = shuffle(ALL().filter(w => w.w !== target.w)).slice(0, 8);
      const opts = shuffle([target, ...cells]);
      const h = document.createElement('div');
      h.className = 'game-wrap';
      h.innerHTML =
        '<div class="wh-target">快速找到：<b>' + esc(target.m) + '</b></div>' +
        '<div class="wh-grid" id="whGrid"></div>' +
        '<div class="game-progress">已出题 ' + (idx + 1) + ' / ' + TOTAL + ' · 答对 ' + correct + ' · 得分 ' + score + '</div>';
      body.innerHTML = ''; body.appendChild(h);
      const grid = $('whGrid');
      opts.forEach(w => {
        const b = document.createElement('button');
        b.className = 'wh-cell'; b.textContent = w.w;
        b.onclick = () => {
          const ok = w.id === target.id;
          if (ok) { correct++; score += 10; mastered.push(w); markWord(w.id); speak(w.w); }
          b.classList.add(ok ? 'ok' : 'no');
          [...grid.children].forEach(x => x.classList.add('disabled'));
          setTimeout(() => { idx++; newRound(); }, ok ? 650 : 950);
        };
        grid.appendChild(b);
      });
    }
    newRound();
  }

  /* ================= 7. 单词接龙 ================= */
  function chain(body) {
    const TOTAL = 10;
    let cur = shuffle(ALL())[0];
    let idx = 0, score = 0, correct = 0, mastered = [];
    function newRound() {
      if (idx >= TOTAL) return end(body, { type: '单词接龙', score, correct, total: TOTAL, words: mastered });
      const lastCh = cur.w.slice(-1).toLowerCase();
      const cands = shuffle(ALL().filter(w => w.w && w.w[0].toLowerCase() === lastCh));
      if (!cands.length) { cur = shuffle(ALL())[0]; return newRound(); }
      const ans = cands[0];
      const distract = shuffle(ALL().filter(w => w.w[0].toLowerCase() !== lastCh)).slice(0, 3).map(w => w.w);
      const opts = shuffle([ans.w, ...distract]);
      const h = document.createElement('div');
      h.className = 'game-wrap';
      h.innerHTML =
        '<div class="ch-cur">当前词：<b>' + esc(cur.w) + '</b> <i>' + esc(cur.m) + '</i></div>' +
        '<div class="ch-tip">下一个词要以字母 <b>' + esc(lastCh.toUpperCase()) + '</b> 开头：</div>' +
        '<div class="ch-opts" id="chOpts"></div>' +
        '<div class="game-progress">第 ' + (idx + 1) + ' / ' + TOTAL + ' 题 · 得分 ' + score + '</div>';
      body.innerHTML = ''; body.appendChild(h);
      const ob = $('chOpts');
      opts.forEach(o => {
        const b = document.createElement('button');
        b.className = 'ch-opt'; b.textContent = o;
        b.onclick = () => {
          const ok = o === ans.w;
          if (ok) { correct++; score += 10; mastered.push(ans); markWord(ans.id); speak(ans.w); cur = ans; }
          [...ob.children].forEach(x => { x.classList.add('disabled'); if (x.textContent === ans.w) x.classList.add('ok'); if (x === b && !ok) x.classList.add('no'); });
          setTimeout(() => { idx++; newRound(); }, ok ? 750 : 1200);
        };
        ob.appendChild(b);
      });
    }
    newRound();
  }

  /* ================= 结算 ================= */
  function end(body, r) {
    if (window.App && window.App.refreshProgress) window.App.refreshProgress();
    body.innerHTML =
      '<div class="result-card">' +
        '<h2 class="result-title">🎉 完成！</h2>' +
        '<p class="result-score">' + r.score + ' 分</p>' +
        '<p class="result-acc">' + r.type + ' · 答对 ' + r.correct + ' / ' + r.total + '</p>' +
        '<div class="game-end-words">本次掌握：' + (r.words && r.words.length ? r.words.map(x => '<span class="ew">' + esc(x.w) + '</span>').join(' ') : '暂无') + '</div>' +
        '<div class="result-btns">' +
          '<button class="btn btn-primary" id="btnGameAgain">再玩一次</button>' +
          '<button class="btn btn-ghost" id="btnGameHome">返回首页</button>' +
        '</div>' +
      '</div>';
    const again = $('btnGameAgain'), home = $('btnGameHome');
    const t = ({ '拼词达人': 'wordbuild', '翻牌记忆': 'memory', '连连看': 'match', '填词高手': 'fill', '分类挑战': 'sort', '打地鼠快选': 'whack', '单词接龙': 'chain' })[r.type];
    again.onclick = () => start(t);
    home.onclick = () => { document.getElementById('btnGameBack').click(); };
  }

  window.GameApp = { start };
})();
