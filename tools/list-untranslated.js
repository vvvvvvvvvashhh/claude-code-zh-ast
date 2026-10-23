// Lists English literals in the webview bundle that are NOT in the dictionary.
// Usage: node tools/list-untranslated.js [index.js]  ->  prints candidates to translate
const fs = require('fs');
const os = require('os');
const path = require('path');
const acorn = require('../node_modules/acorn');

function find() {
  const h = os.homedir();
  const roots = ['.vscode', '.vscode-insiders', '.vscode-oss', '.cursor', '.windsurf', '.devin', '.trae', '.kiro']
    .map(d => path.join(h, d, 'extensions'));
  let best = null;
  for (const root of roots) {
    try {
      for (const d of fs.readdirSync(root)) {
        if (!/^anthropic\.claude-code-/.test(d)) continue;
        const f = path.join(root, d, 'webview', 'index.js');
        if (fs.existsSync(f)) {
          const mtime = fs.statSync(path.join(root, d)).mtimeMs;
          if (!best || mtime > best.mtime) best = { file: f, mtime };
        }
      }
    } catch (e) { }
  }
  return best && best.file;
}

const FILE = (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null) || find();
if (!FILE) { console.log('webview/index.js not found'); process.exit(1); }
const MAP = path.join(__dirname, '..', 'translations', 'built-in.json');
// 优先读英文原版备份：已汉化的文件里英文已被替换，扫出来不准
const src = fs.readFileSync(fs.existsSync(FILE + '.en-backup') ? FILE + '.en-backup' : FILE, 'utf8');
const map = JSON.parse(fs.readFileSync(MAP, 'utf8'));
function unesc(s){return s.replace(new RegExp('\\\\(u[0-9a-fA-F]{4}|u\\{[0-9a-fA-F]+\\}|x[0-9a-fA-F]{2}|[\'"\\\\`bfnrtv0]|.)','g'),(m,e)=>{if(e[0]==='u'){if(e[1]==='{')return String.fromCodePoint(parseInt(e.slice(2,-1),16));return String.fromCharCode(parseInt(e.slice(1),16));}if(e[0]==='x')return String.fromCharCode(parseInt(e.slice(1),16));const M={n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','0':'\0'};return M[e]!==undefined?M[e]:e;});}
const ok = s => {
  if (s.length < 4) return false;
  const toks = s.split(' ');
  if (toks.length >= 3 && toks.every(t => /^[a-z][a-zA-Z0-9]*$/.test(t))) return false; // event lists
  if (/^[a-z0-9.,'&+()\-\[\]\/|_]+( [a-z0-9.,'&+()\-\[\]\/|_]+)+$/.test(s)) return false;
  if (/[<>\\\/]/.test(s) || /^[@#.~]/.test(s) || /\$\{/.test(s)) return false;
  if (/^\$?\{/.test(s) || /^[%@#$\d\s.,:;()\-+*/=<>]+$/.test(s)) return false;
  if (!/[a-zA-Z]/.test(s)) return false;
  return true;
};
const ast = acorn.parse(src, { ecmaVersion: 'latest' });
const missing = new Map();
function walk(n) {
  if (!n || typeof n.type !== 'string') return;
  if (n.type === 'Literal' && typeof n.value === 'string') {
    const raw = src.slice(n.start, n.end), q = raw[0];
    if (q === '"' || q === "'") {
      const ri = raw.slice(1, -1), dec = unesc(ri);
      for (const cand of [ri, dec, n.value]) {
        if (cand && typeof cand === 'string' && cand.includes(' ') && ok(cand) && map[cand] === undefined) {
          missing.set(cand, (missing.get(cand) || 0) + 1);
        }
      }
    }
  }
  for (const k in n) {
    if (['start','end','type','raw','regex','bigint'].includes(k)) continue;
    const v = n[k];
    if (Array.isArray(v)) for (const c of v) { if (c && typeof c.type === 'string') walk(c); }
    else if (v && typeof v.type === 'string') walk(v);
  }
}
walk(ast);
const list = [...missing.entries()].sort((a, b) => b[1] - a[1]);
console.log('untranslated candidates:', list.length);
// --json <file>：把候选写成数组，交给 tools/translate-batch.js 机翻
const ji = process.argv.indexOf('--json');
if (ji > 0) { fs.writeFileSync(process.argv[ji + 1], JSON.stringify(list.map(x => x[0]), null, 1)); console.log('->', process.argv[ji + 1]); }
else for (const [s, n] of list) console.log(n + 'x  ' + s);
