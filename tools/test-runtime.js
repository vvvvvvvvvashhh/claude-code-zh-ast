// 回归测试：运行时显示层，在本机无头 Chrome/Edge 里用 CDP 跑真实 DOM，无需额外依赖。
// 用法：node tools/test-runtime.js   （可设 CHROME_PATH 指定浏览器）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { buildRuntime } = require('../lib/dom-runtime');

const dict = {
  'Slash commands': '斜杠命令', 'Open file': '打开文件', 'Search': '搜索',
  '{0} file': '{0} 个文件', '{0} days ago': '{0} 天前', 'Open {0}': '打开 {0}', '{0} rules': '{0} 条规则', 'The {0} entry is invalid': '{0} 条目无效',
  'Type "{0}" to confirm': 'Type "{0}" to confirm', 'Type "DELETE" to confirm': '输入',
  'main': '主要', 'Delete "{0}"? This cannot be undone.': '删除“{0}”吗？此操作无法撤销。',
  'Sandbox': '沙箱',
};

// 每个用例：setup 建 DOM，check 返回 [实际, 期望]
const cases = `
const T = [];
const add = (name, setup, check, wait) => T.push({ name, setup, check, wait: wait || 300 });
const el = (tag, txt, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = txt; document.body.appendChild(e); return e; };

add('精确词条', () => el('button', 'Slash commands'), e => [e.textContent, '斜杠命令']);
add('模板正常替换', () => el('span', '3 days ago'), e => [e.textContent, '3 天前']);
add('模板不吞独立词条（Open file 不变成 打开 个文件）', () => el('button', 'Open file'), e => [e.textContent, '打开文件']);
add('模板拒绝散文捕获', () => el('span', 'Open a new session in this space now'), e => [e.textContent, 'Open a new session in this space now']);
add('计数模板要求数字槽位（Manage rules 不成 Manage 条规则）', () => el('button', 'Manage rules'), e => [e.textContent, 'Manage rules']);
add('计数模板正常计数', () => el('button', '3 rules'), e => [e.textContent, '3 条规则']);
add('「条目」不算计数量词', () => el('span', 'The hooks entry is invalid'), e => [e.textContent, 'hooks 条目无效']);
add('用户消息不翻', () => { const d = el('div', '', 'userMessage_abc'); d.appendChild(Object.assign(document.createElement('p'), { textContent: 'Search' })); return d; }, e => [e.textContent, 'Search']);
add('代码块不翻', () => el('code', 'Slash commands'), e => [e.textContent, 'Slash commands']);
add('动态改回英文后重翻', () => { const d = el('div', 'Search'); setTimeout(() => { d.firstChild.data = 'Search'; }, 150); return d; }, e => [e.textContent, '搜索'], 500);
add('属性翻译', () => { const i = document.createElement('input'); i.placeholder = 'Search'; document.body.appendChild(i); return i; }, e => [e.placeholder, '搜索']);
add('排除模板优先于更具体的内置译文', () => el('label', 'Type "DELETE" to confirm'), e => [e.textContent, 'Type "DELETE" to confirm']);
add('确认句中的对象名保留且不被普通词条守卫误拦', () => el('button', 'Delete "main"? This cannot be undone.'), e => [e.textContent, '删除“main”吗？此操作无法撤销。']);
add('搜索别名与实际显示译文一致', () => el('button', 'Sandbox'), e => [window.__claudeZhSearchLabel('Sandbox'), e.textContent]);
add('动态进入保护区恢复原文', () => { const d = el('button', 'Search'); setTimeout(() => d.setAttribute('data-zh-skip', ''), 150); return d; }, e => [e.textContent, 'Search'], 500);
add('元素移入聊天区恢复原文', () => { const d = el('div', ''); const b = document.createElement('button'); b.textContent = 'Search'; d.appendChild(b); setTimeout(() => { const p = document.createElement('div'); p.className = 'userMessage_test'; d.appendChild(p); p.appendChild(b); }, 150); return d; }, e => [e.textContent, 'Search'], 500);
add('原有保护区切换后不使用旧缓存', () => { const d = el('div', '', 'userMessage_test'); const s = document.createElement('span'); s.textContent = 'Search'; d.appendChild(s); setTimeout(() => { d.className = ''; }, 150); return d; }, e => [e.textContent, '搜索'], 500);

(async () => {
  const out = [];
  for (const c of T) {
    const e = c.setup();
    await new Promise(r => setTimeout(r, c.wait));
    const [got, want] = c.check(e);
    out.push({ name: c.name, ok: got === want, got, want });
    e.remove();
  }
  const pre = document.createElement('pre'); pre.id = 'result'; pre.textContent = JSON.stringify(out);
  document.body.appendChild(pre);
})();
`;

async function runCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = {};
  ws.onmessage = e => { const m = JSON.parse(e.data); if (pend[m.id]) { pend[m.id](m); delete pend[m.id]; } };
  const call = (method, params, sessionId) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const { result: { targetId } } = await call('Target.createTarget', { url: 'about:blank' });
  const { result: { sessionId } } = await call('Target.attachToTarget', { targetId, flatten: true });
  const ev = expr => call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId).then(m => m.result && m.result.result && m.result.result.value);
  await ev('document.open();document.write("<!doctype html><meta charset=utf-8><body></body>");document.close();delete window.__claudeZhDom');
  await ev(buildRuntime(dict).code);
  await ev(cases);
  let out = null;
  for (let k = 0; k < 100 && !out; k++) { await new Promise(r => setTimeout(r, 200)); out = await ev('(document.getElementById("result")||{}).textContent||null'); }
  await call('Target.closeTarget', { targetId });
  ws.close();
  return out;
}

function report(json) {
  if (!json) { console.log('未拿到结果'); process.exit(1); }
  const res = JSON.parse(json);
  let fail = 0;
  for (const r of res) {
    console.log(r.ok ? 'ok  ' : 'FAIL', r.name, r.ok ? '' : `\n     得到 ${JSON.stringify(r.got)}，期望 ${JSON.stringify(r.want)}`);
    if (!r.ok) fail++;
  }
  console.log(`\n${res.length - fail}/${res.length} passed`);
  process.exit(fail ? 1 : 0);
}

const browser = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(p => fs.existsSync(p));
if (!browser) { console.log('未找到 Chrome/Edge，设 CHROME_PATH'); process.exit(1); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cczh-rt-'));
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(dir, 'profile')}`, 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { proc.kill(); } catch (e) { } setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { } }, 500); };
(async () => {
  let ws = null;
  for (let k = 0; k < 60 && !ws; k++) {
    await new Promise(r => setTimeout(r, 250));
    try { ws = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch (e) { }
  }
  if (!ws) { cleanup(); console.log('浏览器调试端口没起来'); process.exit(1); }
  const out = await runCdp(ws);
  cleanup();
  setTimeout(() => report(out), 600);
})();
