const fs = require('fs');
const path = require('path');

const topicsDir = path.join(__dirname, '..', 'data', 'topics');
const files = fs.readdirSync(topicsDir).filter(f => f.endsWith('.json')).sort();

let allRaw = [];
let totalRaw = 0;
const meta = [];

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(topicsDir, file), 'utf8'));
  totalRaw += data.length;
  const topicName = (data[0] && data[0].topic) ? 'extra' : file.replace(/^\d+-/, '').replace('.json', '');
  const topicLabel = topicName;
  data.forEach(d => { d._topic = d.topic || topicName; d._file = file; });
  allRaw = allRaw.concat(data);
  meta.push({ file, topic: topicName, count: data.length });
}

// 清理 word 中的数字后缀（误标重复），还原基本词
function cleanWord(w) {
  return w.replace(/\d+$/, '');
}

// 去重：按 word(清理后)+pos+meaning
const seen = new Map();
const vocab = [];
let dropped = 0;
for (const d of allRaw) {
  const w = cleanWord(d.w);
  const key = w + '|' + (d.pos || '') + '|' + (d.m || '');
  if (seen.has(key)) {
    // 若已有版本无例句而当前有例句，则替换
    const idx = seen.get(key);
    const existing = vocab[idx];
    if (!existing.e && d.e) {
      vocab[idx] = { ...d, w };
    }
    dropped++;
    continue;
  }
  seen.set(key, vocab.length);
  vocab.push({ ...d, w });
}

// 分配 id
vocab.forEach((v, i) => { v.id = i + 1; });

// 统计每个主题的词数
const byTopic = {};
vocab.forEach(v => { byTopic[v._topic] = (byTopic[v._topic] || 0) + 1; });

console.log('原始词条总数:', totalRaw);
console.log('去重后词条总数:', vocab.length);
console.log('丢弃重复:', dropped);
console.log('--- 各主题词数 ---');
for (const m of meta) {
  console.log(m.topic.padEnd(20), '原始:', String(m.count).padStart(4), '去重后:', String(byTopic[m.topic] || 0));
}

// 输出 vocab.json
const out = vocab.map(({ w, p, pos, m, e, ec }) => ({ w, p, pos, m, ...(e ? { e, ec } : {}) }));
fs.writeFileSync(path.join(__dirname, '..', 'data', 'vocab.json'), JSON.stringify(out, null, 1), 'utf8');

// 输出带主题的完整数据供关卡使用
const full = vocab.map(({ id, w, p, pos, m, e, ec, _topic }) => ({ id, w, p, pos, m, ...(e ? { e, ec } : {}), topic: _topic }));
fs.writeFileSync(path.join(__dirname, '..', 'data', 'vocab-full.json'), JSON.stringify(full, null, 1), 'utf8');

console.log('\n已写出 data/vocab.json 与 data/vocab-full.json');
