/**
 * 题库生成与随机出题工具
 * 运行时动态生成题目，保证每次进入关卡题目不同
 */
(function (global) {
  'use strict';

  // 全词表（启动时从后端加载）：{id,w,m,topic,p,pos,e,ec}
  let ALL_WORDS = [];
  // 主题 → 词列表
  const byTopic = {};
  // 各主题词数
  const topicCount = {};

  function setWords(list) {
    ALL_WORDS = list;
    list.forEach(v => {
      if (!byTopic[v.topic]) byTopic[v.topic] = [];
      byTopic[v.topic].push(v);
    });
    Object.keys(byTopic).forEach(k => { topicCount[k] = byTopic[k].length; });
  }

  function wordsOf(topic) {
    return byTopic[topic] || [];
  }

  // Fisher-Yates 洗牌
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 生成题目：为一关抽 count 题
  // types: ['en2zh','zh2en','listen'] 混合轮换
  function generateQuiz(topic, count, types) {
    const pool = wordsOf(topic);
    if (pool.length < 4) return [];
    const picked = shuffle(pool).slice(0, count);
    const q = [];
    picked.forEach((word, i) => {
      const type = types[i % types.length];
      q.push(makeQuestion(word, type));
    });
    // 均匀化答案位置：保证 A/B/C/D 分布接近
    balanceAnswers(q);
    return q;
  }

  // 干扰项：从全词表中取与正确项释义不同的候选（优先同主题，其次全表）
  function pickDistractors(correctMeaning, n) {
    const seen = new Set([correctMeaning]);
    const result = [];
    const candidates = shuffle(ALL_WORDS.filter(v => v.m && v.m !== correctMeaning));
    for (const c of candidates) {
      if (result.length >= n) break;
      const m = c.m;
      if (seen.has(m)) continue;
      seen.add(m);
      result.push(m);
    }
    return result;
  }
  function pickDistractorsEn(correctWord, n) {
    const seen = new Set([correctWord]);
    const result = [];
    const candidates = shuffle(ALL_WORDS.filter(v => v.w && v.w !== correctWord));
    for (const c of candidates) {
      if (result.length >= n) break;
      if (seen.has(c.w)) continue;
      seen.add(c.w);
      result.push(c.w);
    }
    return result;
  }

  function makeQuestion(word, type) {
    const options4 = () => {
      // 返回 4 个选项，answerIndex 为正确项位置
      const distract = type === 'zh2en' ? pickDistractorsEn(word.w, 3) : pickDistractors(word.m, 3);
      const opts = shuffle([...distract, type === 'zh2en' ? word.w : word.m]);
      const answerIndex = opts.indexOf(type === 'zh2en' ? word.w : word.m);
      return { options: opts, answerIndex };
    };
    const { options, answerIndex } = options4();

    // 解析：展示单词、音标、词性、中文、例句
    let expl = `${word.w} ${word.p || ''} [${word.pos || ''}] 意为“${word.m}”。`;
    if (word.e && word.ec) expl += ` 例句：${word.e}（${word.ec}）`;

    const q = { word: word, options, answer: answerIndex, explanation: expl };

    if (type === 'en2zh') {
      q.type = 'en2zh';
      q.prompt = '选择正确的中文意思';
      q.display = `${word.w}`;
      q.sub = word.p || '';
      q.speak = word.w;
    } else if (type === 'zh2en') {
      q.type = 'zh2en';
      q.prompt = '选择正确的英文单词';
      q.display = `${word.m}`;
      q.sub = '';
      q.speak = '';
    } else { // listen 听音选义
      q.type = 'listen';
      q.prompt = '🔊 听发音，选择正确的中文意思';
      q.display = '🎧 点击播放发音';
      q.sub = word.w;
      q.speak = word.w;
    }
    return q;
  }

  // 均匀化答案位置（近似 25% 分布）
  function balanceAnswers(questions) {
    const n = questions.length;
    const target = [Math.round(n / 4), Math.round(n / 4), n - 2 * Math.round(n / 4), Math.round(n / 4)];
    let counts = [0, 0, 0, 0];
    questions.forEach(q => counts[q.answer]++);
    // 贪心重排
    for (let i = 0; i < n; i++) {
      const cur = questions[i].answer;
      if (counts[cur] > target[cur]) {
        // 找一个欠分配的位置
        for (let pos = 0; pos < 4; pos++) {
          if (counts[pos] < target[pos]) {
            const idx = questions[i].options.indexOf(
              questions[i].type === 'zh2en' ? questions[i].word.w : questions[i].word.m
            );
            // 交换到目标位置
            [questions[i].options[questions[i].answer], questions[i].options[pos]] =
              [questions[i].options[pos], questions[i].options[questions[i].answer]];
            questions[i].answer = pos;
            counts[cur]--;
            counts[pos]++;
            break;
          }
        }
      }
    }
  }

  // 发音（Web Speech API，自动选用系统最自然的美式英文语音）
  // 排除 macOS 的搞笑/音效类合成音，避免发音怪异
  const NOVELTY = new Set(['Bahh','Bells','Boing','Bubbles','Cellos','Good News','Jester','Organ','Ralph','Superstar','Trinoids','Whisper','Wobble','Zarvox','Bad News']);
  const PREFER = ['Samantha', 'Sandy', 'Eddy', 'Flo', 'Reed', 'Rocko', 'Shelley', 'Grandma', 'Daniel'];
  let cachedVoice = null;
  function pickVoice() {
    try {
      const voices = window.speechSynthesis.getVoices();
      if (!voices.length) return null;
      const us = voices.filter(v => v.lang && v.lang.toLowerCase().indexOf('en-us') === 0);
      for (const name of PREFER) {
        const m = us.find(v => v.name.indexOf(name) !== -1);
        if (m) return m;
      }
      const natural = us.find(v => !NOVELTY.has(v.name)) || us[0];
      return natural || voices[0];
    } catch (e) { return null; }
  }
  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (!cachedVoice) { const v = pickVoice(); if (v) cachedVoice = v; }
    if (cachedVoice) u.voice = cachedVoice;
    u.lang = cachedVoice ? cachedVoice.lang : 'en-US';
    u.rate = 0.9;
    u.pitch = 1;
    window.speechSynthesis.speak(u);
  }

  global.QuizUtils = {
    setWords, wordsOf, generateQuiz, speak, shuffle,
    getTopicCount: () => topicCount,
    getWordById: id => ALL_WORDS.find(v => v.id === id) || null,
    getAllWords: () => ALL_WORDS
  };
})(window);
