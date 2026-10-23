// CLI: node tools/patch.js [path-to-index.js]
// Without args, auto-discovers anthropic.claude-code webview/index.js across VS Code forks.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { patchFile } = require('../lib/translator');

const map = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'translations', 'built-in.json'), 'utf8'));

function find(explicitRoot) {
  const h = os.homedir();
  const roots = explicitRoot ? [explicitRoot] : ['.vscode', '.vscode-insiders', '.vscode-oss', '.cursor', '.windsurf', '.devin', '.trae', '.kiro']
    .map(d => path.join(h, d, 'extensions'));
  const found = [];
  for (const root of roots) {
    try {
      for (const d of fs.readdirSync(root)) {
        if (!/^anthropic\.claude-code-/.test(d)) continue;
        const f = path.join(root, d, 'webview', 'index.js');
        if (fs.existsSync(f)) {
          found.push(f);
        }
      }
    } catch (e) { }
  }
  if (found.length > 1) throw new Error('找到多个 Claude Code 安装，请显式传入目标 index.js 路径');
  return found[0];
}

const args = process.argv.slice(2);
let file, root, noDom = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--no-dom') noDom = true;
  else if (args[i] === '--extensions-dir') {
    root = args[++i];
    if (!root || root.startsWith('--')) throw new Error('--extensions-dir 需要目录参数');
  } else if (args[i].startsWith('--') || file) throw new Error('用法：node tools/patch.js [index.js] [--no-dom] [--extensions-dir DIR]');
  else file = args[i];
}
file = file || find(root);
if (!file) { console.log('webview/index.js not found — is the Claude Code extension installed?'); process.exit(1); }
console.log('target:', file);
try {
  let dom = {};
  try { dom = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'translations', 'dom.json'), 'utf8')); } catch (e) { }
  const r = patchFile(file, map, 'calls', noDom ? undefined : { ...dom, ...map });
  if (r.alreadyPatched) console.log('already patched — nothing to do');
  else {
    fs.writeFileSync(file + '.patch-report.json', JSON.stringify({
      file, mode: 'calls', at: new Date().toISOString(),
      applied: r.applied, literals: r.literals,
      translated: r.report, skipped: r.skipped,
    }, null, 2));
    console.log(`done: ${r.applied} replacements (literals scanned: ${r.literals})`);
    console.log('report ->', file + '.patch-report.json');
    console.log('reload the VS Code window to take effect');
  }
} catch (e) {
  console.log('patch FAILED (file untouched):', e.message);
  process.exit(1);
}
