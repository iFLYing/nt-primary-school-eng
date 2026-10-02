/**
 * 英语闯关学习游戏 - 后端服务
 * 纯 Node 内置模块实现，零 npm 依赖，离线可运行
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const CLIENT_DIR = path.join(ROOT, 'client');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PORT = Number(process.env.PORT) || 5173;

/* ---------- 管理后台 ---------- */
// 管理员密码：可用环境变量 ADMIN_PASS 覆盖（Render 后台可配置），默认 admin123
const ADMIN_PASS = process.env.ADMIN_PASS || 'Admin@123';
const adminToken = crypto.createHash('sha256').update('admin:' + ADMIN_PASS + ':vocab').digest('hex');

/* ---------- 数据层：JSON 文件存储 ---------- */
function loadDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const init = {
      users: [],
      sessions: {},
      progress: {},
      stats: { registeredUsers: 0, totalPlays: 0, totalCheckins: 0 },
      seq: { user: 0 }
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2), 'utf8');
    return init;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    console.error('DB 读取失败，重新初始化:', e.message);
    const init = { users: [], sessions: {}, progress: {}, stats: { registeredUsers: 0, totalPlays: 0, totalCheckins: 0 }, seq: { user: 0 } };
    fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2), 'utf8');
    return init;
  }
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}
function getToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ---------- 安全工具 ---------- */
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha256').toString('hex');
}
function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

/* ---------- 读取词表与关卡 ---------- */
const vocabFull = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'vocab-full.json'), 'utf8'));
const levels = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'levels.json'), 'utf8'));
const vocabByTopic = {};
vocabFull.forEach(v => {
  if (!vocabByTopic[v.topic]) vocabByTopic[v.topic] = [];
  vocabByTopic[v.topic].push(v);
});

/* ---------- 工具 ---------- */
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 2e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('JSON 解析失败')); } });
    req.on('error', reject);
  });
}
function auth(req, db) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const uid = db.sessions[token];
  if (!uid) return null;
  const user = db.users.find(u => u.id === uid);
  return user || null;
}
function getUserProgress(db, userId) {
  if (!db.progress[userId]) {
    db.progress[userId] = {
      levelScores: {},       // levelId -> bestScore
      totalScore: 0,
      totalCorrect: 0,
      totalAttempts: 0,
      totalQuestions: 0,     // 累计答题总题数
      completedLevels: 0,
      checkinStreak: 0,
      lastCheckin: null,
      checkinHistory: [],
      wordMastered: {},      // wordId -> true（已掌握）
      wordSeen: {}           // wordId -> true（见过）
    };
  }
  return db.progress[userId];
}

/* ---------- API 路由 ---------- */
function handleApi(req, res, url, db) {
  const pathname = url.pathname;
  const method = req.method;

  // 获取词表（仅当前关内，由前端筛选）与关卡
  if (method === 'GET' && pathname === '/api/levels') {
    return json(res, 200, { levels });
  }
  if (method === 'GET' && pathname === '/api/words') {
    return json(res, 200, { count: vocabFull.length, byTopic: Object.fromEntries(Object.keys(vocabByTopic).map(k => [k, vocabByTopic[k].length])) });
  }
  if (method === 'GET' && pathname === '/api/words/topic') {
    const topic = url.searchParams.get('topic');
    const list = vocabByTopic[topic] || [];
    return json(res, 200, { topic, list });
  }
  if (method === 'GET' && pathname === '/api/vocab-all') {
    // 精简全词表：供前端出题与干扰项使用
    const list = vocabFull.map(v => ({ id: v.id, w: v.w, m: v.m, topic: v.topic, p: v.p || '', pos: v.pos || '', e: v.e || '', ec: v.ec || '' }));
    return json(res, 200, { count: list.length, list });
  }

  // 注册（家长注册，自动附带生成一个孩子账号）
  if (method === 'POST' && pathname === '/api/register') {
    return readBody(req).then(body => {
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const childNickname = String(body.childNickname || '').trim();
      // 家长用户名限 2-14 位，保证自动生成的孩子用户名（+_child 共 6 字符）不超过 20 位
      if (!/^[\w\u4e00-\u9fa5]{2,14}$/.test(username)) return json(res, 400, { error: '家长用户名需 2-14 位字母、数字、下划线或中文' });
      if (password.length < 4) return json(res, 400, { error: '家长密码至少 4 位' });
      if (db.users.find(u => u.username === username)) return json(res, 400, { error: '该家长用户名已存在' });
      const childUsername = username + '_child';
      if (db.users.find(u => u.username === childUsername)) return json(res, 400, { error: '孩子账号已存在，请更换家长用户名' });

      // 创建家长账号
      const salt = crypto.randomBytes(8).toString('hex');
      const pid = ++db.seq.user;
      const parent = { id: pid, username, salt, passwordHash: hashPassword(password, salt), isParent: true, parentId: null, nickname: body.nickname || username, createdAt: new Date().toISOString() };
      db.users.push(parent);
      getUserProgress(db, pid);

      // 自动创建孩子账号（默认密码 1234，绑定到该家长）
      const csalt = crypto.randomBytes(8).toString('hex');
      const cid = ++db.seq.user;
      const child = { id: cid, username: childUsername, salt: csalt, passwordHash: hashPassword('1234', csalt), isParent: false, parentId: pid, nickname: childNickname || childUsername, createdAt: new Date().toISOString() };
      db.users.push(child);
      getUserProgress(db, cid);

      db.stats.registeredUsers = db.users.length;
      const token = makeToken();
      db.sessions[token] = pid;
      saveDB(db);
      return json(res, 200, {
        token,
        user: publicUser(parent),
        child: { ...publicUser(child), defaultPassword: '1234' }
      });
    }).catch(e => json(res, 400, { error: e.message }));
  }

  // 登录
  if (method === 'POST' && pathname === '/api/login') {
    return readBody(req).then(body => {
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const user = db.users.find(u => u.username === username);
      if (!user) return json(res, 400, { error: '用户不存在' });
      if (user.passwordHash !== hashPassword(password, user.salt)) return json(res, 400, { error: '密码错误' });
      const token = makeToken();
      db.sessions[token] = user.id;
      saveDB(db);
      return json(res, 200, { token, user: publicUser(user) });
    }).catch(e => json(res, 400, { error: e.message }));
  }

  // 当前用户信息（含进度与统计）
  if (method === 'GET' && pathname === '/api/me') {
    const user = auth(req, db);
    if (!user) return json(res, 401, { error: '未登录' });
    const p = getUserProgress(db, user.id);
    return json(res, 200, { user: publicUser(user), progress: publicProgress(p) });
  }

  // 每日打卡
  if (method === 'POST' && pathname === '/api/checkin') {
    const user = auth(req, db);
    if (!user) return json(res, 401, { error: '未登录' });
    const p = getUserProgress(db, user.id);
    const today = getToday();
    if (p.lastCheckin === today) return json(res, 200, { done: false, streak: p.checkinStreak, message: '今天已打过卡' });
    if (p.lastCheckin === addDays(today, -1)) p.checkinStreak = (p.checkinStreak || 0) + 1;
    else p.checkinStreak = 1;
    p.lastCheckin = today;
    if (!p.checkinHistory.includes(today)) p.checkinHistory.push(today);
    db.stats.totalCheckins++;
    saveDB(db);
    return json(res, 200, { done: true, streak: p.checkinStreak, message: '打卡成功' });
  }

  // 保存通关成绩
  if (method === 'POST' && pathname === '/api/save-progress') {
    const user = auth(req, db);
    if (!user) return json(res, 401, { error: '未登录' });
    return readBody(req).then(body => {
      const p = getUserProgress(db, user.id);
      const levelId = Number(body.levelId);
      const score = Number(body.score) || 0;
      const correct = Number(body.correct) || 0;
      const total = Number(body.total) || 0;
      const wordIds = Array.isArray(body.wordIds) ? body.wordIds : [];
      const masteredIds = Array.isArray(body.masteredIds) ? body.masteredIds : [];
      const passed = correct >= Math.ceil(total * 0.6); // 60% 通关

      p.totalAttempts++;
      p.totalCorrect += correct;
      p.totalQuestions = (p.totalQuestions || 0) + total;
      if (passed) {
        if (!(levelId in p.levelScores)) p.completedLevels++;
        p.levelScores[levelId] = Math.max(p.levelScores[levelId] || 0, score);
        p.totalScore += score; // 累计得分
      }
      wordIds.forEach(wid => { p.wordSeen[wid] = true; });
      masteredIds.forEach(wid => { p.wordMastered[wid] = true; });
      db.stats.totalPlays++;
      saveDB(db);
      return json(res, 200, { passed, levelId, progress: publicProgress(p) });
    }).catch(e => json(res, 400, { error: e.message }));
  }

  // 记录单词掌握情况（答对标记已掌握）
  if (method === 'POST' && pathname === '/api/word-result') {
    const user = auth(req, db);
    if (!user) return json(res, 401, { error: '未登录' });
    return readBody(req).then(body => {
      const p = getUserProgress(db, user.id);
      const wid = Number(body.wordId);
      if (body.correct) p.wordMastered[wid] = true;
      p.wordSeen[wid] = true;
      saveDB(db);
      return json(res, 200, { ok: true });
    });
  }

  // 排行榜
  if (method === 'GET' && pathname === '/api/rank') {
    const rows = db.users
      .filter(u => !u.isParent)
      .map(u => {
        const p = getUserProgress(db, u.id);
        return { username: u.username, nickname: u.nickname, score: p.totalScore, completed: p.completedLevels, streak: p.checkinStreak };
      })
      .sort((a, b) => b.score - a.score || b.completed - a.completed)
      .slice(0, 20);
    return json(res, 200, { rows });
  }

  // 使用统计
  if (method === 'GET' && pathname === '/api/stats') {
    return json(res, 200, { registeredUsers: db.stats.registeredUsers, totalPlays: db.stats.totalPlays, totalCheckins: db.stats.totalCheckins });
  }

  // 家长查看孩子进度（不传 username 时返回当前家长绑定的所有孩子概览）
  if (method === 'GET' && pathname === '/api/parent/progress') {
    const user = auth(req, db);
    if (!user) return json(res, 401, { error: '未登录' });
    if (!user.isParent) return json(res, 403, { error: '仅家长账号可查看' });
    const childName = url.searchParams.get('username') || '';
    // 指定查看某个孩子详情（限当前家长绑定的孩子）
    if (childName) {
      const child = db.users.find(u => u.username === childName);
      if (!child) return json(res, 404, { error: '未找到该孩子账号' });
      if (child.parentId !== user.id) return json(res, 403, { error: '该孩子不属于当前家长账号' });
      const p = getUserProgress(db, child.id);
      const levelDetail = levels.map(l => ({
        levelId: l.id, title: l.title, topic: l.topic,
        bestScore: p.levelScores[l.id] || 0, passed: !!(l.id in p.levelScores)
      }));
      const wordsSeen = Object.keys(p.wordSeen).length;
      const wordsMastered = Object.keys(p.wordMastered).length;
      return json(res, 200, {
        child: publicUser(child),
        progress: publicProgress(p),
        levelDetail,
        wordStats: { wordsSeen, wordsMastered, totalWords: vocabFull.length }
      });
    }
    // 返回当前家长绑定的所有孩子（概览）
    const children = db.users.filter(u => u.parentId === user.id).map(u => {
      const p = getUserProgress(db, u.id);
      return { child: publicUser(u), progress: publicProgress(p) };
    });
    return json(res, 200, { children });
  }

  // 管理后台：登录（返回管理员令牌）
  if (method === 'POST' && pathname === '/api/admin/login') {
    return readBody(req).then(body => {
      if (String(body.password || '') !== ADMIN_PASS) return json(res, 401, { error: '管理员密码错误' });
      return json(res, 200, { adminToken });
    });
  }
  // 管理后台：查看全部用户数据
  if (method === 'GET' && pathname === '/api/admin/users') {
    const h = req.headers['authorization'] || '';
    const tk = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (tk !== adminToken) return json(res, 401, { error: '管理员鉴权失败' });
    const users = db.users.map(u => {
      const p = db.progress[u.id];
      const prog = p ? {
        totalScore: p.totalScore || 0,
        completedLevels: p.completedLevels || 0,
        mastered: Object.keys(p.wordMastered || {}).length,
        seen: Object.keys(p.wordSeen || {}).length,
        totalQuestions: p.totalQuestions || 0,
        accuracy: p.totalAttempts > 0 ? Math.min(100, Math.max(0, Math.round((p.totalCorrect / p.totalAttempts) * 100))) : 0,
        checkinStreak: p.checkinStreak || 0,
        checkinDays: (p.checkinHistory || []).length
      } : null;
      return {
        id: u.id, username: u.username, nickname: u.nickname,
        isParent: !!u.isParent, parentId: u.parentId || null, createdAt: u.createdAt, progress: prog
      };
    });
    const parents = users.filter(u => u.isParent);
    const children = users.filter(u => !u.isParent);
    return json(res, 200, {
      users,
      stats: { totalUsers: users.length, parents: parents.length, children: children.length }
    });
  }
  // 管理后台：重置用户密码（管理员自行设置新密码）
  if (method === 'POST' && pathname === '/api/admin/reset-password') {
    const h = req.headers['authorization'] || '';
    const tk = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (tk !== adminToken) return json(res, 401, { error: '管理员鉴权失败' });
    return readBody(req).then(body => {
      const username = String(body.username || '').trim();
      const newPassword = String(body.newPassword || '');
      const user = db.users.find(u => u.username === username);
      if (!user) return json(res, 404, { error: '用户不存在' });
      if (newPassword.length < 4) return json(res, 400, { error: '新密码至少 4 位' });
      user.salt = crypto.randomBytes(8).toString('hex');
      user.passwordHash = hashPassword(newPassword, user.salt);
      saveDB(db);
      return json(res, 200, { ok: true, username });
    });
  }

  return json(res, 404, { error: '接口不存在' });
}

function publicUser(u) {
  return { id: u.id, username: u.username, nickname: u.nickname, isParent: !!u.isParent, parentId: u.parentId || null, createdAt: u.createdAt };
}
function publicProgress(p) {
  return {
    levelScores: p.levelScores,
    totalScore: p.totalScore,
    totalCorrect: p.totalCorrect,
    totalAttempts: p.totalAttempts,
    totalQuestions: p.totalQuestions || 0,
    completedLevels: p.completedLevels,
    checkinStreak: p.checkinStreak,
    lastCheckin: p.lastCheckin,
    checkinHistory: p.checkinHistory,
    wordsMastered: Object.keys(p.wordMastered).length,
    wordsSeen: Object.keys(p.wordSeen).length
  };
}

/* ---------- 静态文件服务 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};
function serveStatic(req, res, url) {
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  // 防路径穿越
  const safe = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(CLIENT_DIR, safe);
  if (!filePath.startsWith(CLIENT_DIR)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(CLIENT_DIR, 'index.html'); // SPA 回退
  }
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(filePath).pipe(res);
}

/* ---------- 服务器 ---------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    const db = loadDB();
    try {
      handleApi(req, res, url, db);
    } catch (e) {
      console.error('API 错误:', e);
      if (!res.headersSent) json(res, 500, { error: '服务器错误' });
      else res.end();
    }
  } else {
    serveStatic(req, res, url);
  }
});

// 打印局域网访问地址
const os = require('os');
function lanIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}
server.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('  英语闯关学习游戏 已启动');
  console.log('========================================');
  console.log('  本机访问:   http://localhost:' + PORT);
  console.log('  局域网手机: http://' + lanIP() + ':' + PORT);
  console.log('  关闭服务:   在启动窗口按 Ctrl+C');
  console.log('========================================');
});
