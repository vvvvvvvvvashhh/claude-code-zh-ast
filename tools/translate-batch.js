// 批量机翻：把英文候选数组（list-untranslated.js --json 的输出）翻成中文，增量写进输出词典。
// 用法：node tools/translate-batch.js <todo.json> [out.json=translations/dom.json] [并发=4]
// 配置优先读环境变量，缺省回退 ~/.claude/settings.json 的 env 段；不写入任何文件。
//   ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY  密钥（必填）
//   ANTHROPIC_BASE_URL                         默认 https://api.anthropic.com
//   CLAUDE_ZH_MODEL / ANTHROPIC_MODEL          默认 claude-sonnet-5-5
const fs = require('fs');
const os = require('os');
const path = require('path');

const [todoFile, outArg, concArg] = process.argv.slice(2);
if (!todoFile) { console.log('用法：node tools/translate-batch.js <todo.json> [out.json] [并发]'); process.exit(1); }
const OUT = outArg || path.join(__dirname, '..', 'translations', 'dom.json');
const CONC = parseInt(concArg || '4', 10), BATCH = 40;

let senv = {};
try { senv = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8')).env || {}; } catch (e) { }
const pick = k => process.env[k] || senv[k] || '';
const BASE = (pick('ANTHROPIC_BASE_URL') || 'https://api.anthropic.com').replace(/\/$/, '');
const KEY = pick('ANTHROPIC_AUTH_TOKEN') || pick('ANTHROPIC_API_KEY');
const MODEL = pick('CLAUDE_ZH_MODEL') || pick('ANTHROPIC_MODEL') || 'claude-sonnet-5-5';
if (!KEY) { console.log('缺少 ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY'); process.exit(1); }

const todo = JSON.parse(fs.readFileSync(todoFile, 'utf8'));
let out = {};
try { out = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { }
const queue = todo.filter(s => out[s] === undefined);
console.log('待翻', queue.length, '/', todo.length, '| 模型', MODEL);
if (!queue.length) process.exit(0);

const prompt = arr => `把下面 JSON 数组里的英文界面文案翻成简体中文，用于 Claude Code 编辑器扩展的界面。
要求：保留 {0} {1} 等占位符、产品名、命令名、快捷键和代码标识符原样；简洁自然；只输出一个 JSON 对象 {"英文":"中文"}，不要解释。
${JSON.stringify(arr)}`;

async function translate(arr) {
  const res = await fetch(BASE + '/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages: [{ role: 'user', content: prompt(arr) }] }),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  const text = (j.content || []).map(c => c.text || '').join('');
  const m = text.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : {};
}

const save = () => { const t = OUT + '.tmp-' + process.pid; fs.writeFileSync(t, JSON.stringify(out, null, 1)); fs.renameSync(t, OUT); };
const batches = [];
for (let i = 0; i < queue.length; i += BATCH) batches.push(queue.slice(i, i + BATCH));
let done = 0, failed = 0;
(async () => {
  async function worker() {
    while (batches.length) {
      const b = batches.shift();
      try {
        const r = await translate(b);
        // 只收原文在本批里、占位符一致的结果
        for (const en of b) {
          const zh = r[en];
          if (typeof zh !== 'string' || !zh) continue;
          const ph = s => (s.match(/\{\d+\}/g) || []).sort().join();
          if (ph(en) === ph(zh)) out[en] = zh;
        }
        done += b.length; save();
        console.log('done', done, '/', queue.length);
      } catch (e) { failed++; console.log('批次失败：', e.message); }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log('完成，失败批次', failed, '（重跑会续上）');
})();
