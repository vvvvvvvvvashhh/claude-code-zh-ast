const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm'), assert = require('assert');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cczh-host-'));
const install = path.join(temp, 'anthropic.claude-code-test');
const file = path.join(install, 'webview/index.js'), original = 'var label={label:"Open file"};';
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, original);
fs.writeFileSync(path.join(install, 'package.json'), '{"version":"1","contributes":{"commands":[{"command":"x","title":"Open file"}]}}');
const savedState = new Map();
function host(found = true) {
  const commands = {}, timers = [], messages = [];
  const api = {
    StatusBarAlignment: { Right: 1 },
    extensions: { getExtension: () => found ? { extensionPath: install } : undefined },
    workspace: { getConfiguration: () => ({ get: key => ({ autoApply: true, mode: 'calls', domLayer: true })[key] }) },
    commands: { registerCommand: (key, fn) => { commands[key] = fn; return {}; }, executeCommand() {} },
    window: { createStatusBarItem: () => ({ show() {} }),
      showInformationMessage: async text => { messages.push(['info', text]); },
      showWarningMessage: async text => { messages.push(['warn', text]); },
      showErrorMessage: async text => { messages.push(['error', text]); } },
  };
  const context = { extensionPath: root, subscriptions: [], globalState: {
    get: key => savedState.get(key), update: async (key, value) => savedState.set(key, value),
  } };
  const sandbox = {
    module: { exports: {} }, console, setTimeout: fn => { timers.push(fn); return 1; },
    require: name => name === 'vscode' ? api : name === './lib/userlang' ? { getLanguage: () => 'chinese' }
      : require(name.startsWith('.') ? path.join(root, name) : name),
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'extension.js'), 'utf8'), sandbox);
  return { activate: () => sandbox.module.exports.activate(context), commands, timers, messages };
}
(async () => {
  try {
    const first = host(); await first.activate();
    await first.commands['claude-zh.apply']();
    assert.ok(fs.readFileSync(file, 'utf8').includes('__claudeZhDom'));
    await first.commands['claude-zh.restore']();
    assert.strictEqual(fs.readFileSync(file, 'utf8'), original);
    const next = host(); await next.activate();
    for (const timer of next.timers) await timer();
    assert.strictEqual(fs.readFileSync(file, 'utf8'), original);
    console.log('ok 还原后重启保持英文');
    await next.commands['claude-zh.apply']();
    assert.strictEqual(savedState.get('claudeZh.paused'), false);
    assert.ok(fs.readFileSync(file, 'utf8').includes('__claudeZhDom'));
    console.log('ok 手动应用恢复自动汉化');
    const absent = host(false); await absent.activate();
    await absent.commands['claude-zh.apply']();
    assert.ok(absent.messages.some(([type]) => type === 'warn'));
    console.log('ok 不跨编辑器目录回落');
    await next.commands['claude-zh.restore']();
    const result = spawnSync(process.execPath, [path.join(root, 'tools/patch.js'), '--no-dom', '--extensions-dir', temp], { encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.ok(!fs.readFileSync(file, 'utf8').includes('__claudeZhDom'));
    console.log('ok --no-dom 无位置参数形式正常解析');
    console.log('4 passed');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
