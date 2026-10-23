const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { patchFile, restoreFile } = require('./lib/translator');
const { patchPackageJson, restorePackageJson } = require('./lib/pkgjson');
const userlang = require('./lib/userlang');

const EXT_ID = 'anthropic.claude-code';
const KEY = 'claudeZh.state';

let status;

function findWebview() {
  // 1) VS Code extension API (most reliable — works on every fork)
  try {
    const ext = vscode.extensions.getExtension(EXT_ID);
    if (ext) {
      const f = path.join(ext.extensionPath, 'webview', 'index.js');
      if (fs.existsSync(f)) return f;
    }
  } catch (e) { /* fall through */ }
  // Never patch a different editor's extension as a fallback.
  return null;
}

function loadMap(context) {
  const p = path.join(context.extensionPath, 'translations', 'built-in.json');
  let map = {};
  try { map = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { }
  // user custom rules: object {english: chinese}
  const custom = vscode.workspace.getConfiguration('claudeZh').get('customTranslations') || {};
  for (const [k, v] of Object.entries(custom)) {
    const kk = k.replace(/^["']|["']$/g, '');
    if (kk && v) map[kk] = String(v).replace(/^["']|["']$/g, '');
  }
  // user exclusions
  const excl = vscode.workspace.getConfiguration('claudeZh').get('exclude') || [];
  for (const k of excl) map[k.replace(/^["']|["']$/g, '')] = k.replace(/^["']|["']$/g, '');
  return map;
}

// runtime DOM layer map: built-in + dom.json (+ custom/exclude via loadMap). null when disabled.
function loadRuntimeMap(context, map) {
  if (vscode.workspace.getConfiguration('claudeZh').get('domLayer') === false) return null;
  let dom = {};
  try { dom = JSON.parse(fs.readFileSync(path.join(context.extensionPath, 'translations', 'dom.json'), 'utf8')); } catch (e) { }
  const out = { ...dom, ...map };
  // exclusions win over dom.json too
  const excl = vscode.workspace.getConfiguration('claudeZh').get('exclude') || [];
  for (const k of excl) { const kk = k.replace(/^["']|["']$/g, ''); out[kk] = kk; }
  return out;
}

function getMode() {
  const m = vscode.workspace.getConfiguration('claudeZh').get('mode');
  return ['safe', 'calls', 'all'].includes(m) ? m : 'calls';
}

async function apply(context, manual) {
  if (!manual && context.globalState.get('claudeZh.paused')) return;
  const file = findWebview();
  if (!file) {
    if (manual) vscode.window.showWarningMessage('未找到 Claude Code 扩展的 webview/index.js（请先安装 Claude Code 扩展）');
    return;
  }
  const map = loadMap(context);
  try {
    const r = patchFile(file, map, getMode(), loadRuntimeMap(context, map));
    if (r.state?.dom && !r.state.searchAliases) {
      vscode.window.showWarningMessage('当前 Claude Code 的菜单搜索结构未识别，中文显示已应用，菜单检索请暂用英文关键词');
    }
    const pkgPath = path.join(path.dirname(path.dirname(file)), 'package.json');
    const pr = patchPackageJson(pkgPath, map);
    if (manual) await context.globalState.update('claudeZh.paused', false);
    const st = context.globalState.get(KEY) || {};
    st.patchedFile = file;
    st.appliedAt = new Date().toISOString();
    if (!r.alreadyPatched || pr.changed) {
      st.applied = r.applied;
      // translate extension package.json settings descriptions too
      st.pkgTranslated = pr.translated;
      // persist patch report next to the webview bundle for review / evidence
      try {
        fs.writeFileSync(file + '.patch-report.json', JSON.stringify({
          file, mode: getMode(), at: st.appliedAt,
          applied: r.applied, literals: r.literals,
          translated: r.report, skipped: r.skipped,
        }, null, 2));
      } catch (e) { /* non-fatal */ }
      await context.globalState.update(KEY, st);
      status.text = `$(globe) Claude汉化 ${r.applied}`;
      const pick = await vscode.window.showInformationMessage(
        `Claude Code 界面已汉化（${r.applied} 处），需重载窗口生效`, '立即重载', '稍后');
      if (pick === '立即重载') vscode.commands.executeCommand('workbench.action.reloadWindow');
    } else {
      st.alreadyPatched = true;
      await context.globalState.update(KEY, st);
      status.text = '$(globe) Claude汉化 ✓';
      if (manual) vscode.window.showInformationMessage('webview 已是汉化状态，无需重复应用');
    }
  } catch (e) {
    status.text = '$(globe) Claude汉化 ✗';
    vscode.window.showErrorMessage('汉化应用失败: ' + e.message);
  }
}

async function restore(context) {
  // Pause before attempting recovery, including when a backup is damaged.
  await context.globalState.update('claudeZh.paused', true);
  try {
  const st = context.globalState.get(KEY) || {};
  // current install first: after a Claude Code update, st.patchedFile points at the old version's folder
  const file = findWebview();
  if (!file) {
    vscode.window.showWarningMessage('未找到当前编辑器的 Claude Code；自动汉化已暂停');
    return;
  }
  const pkgPath = path.join(path.dirname(path.dirname(file)), 'package.json');
  const restored = restoreFile(file);
  const pkgRestored = restorePackageJson(pkgPath);
  if (!restored && !pkgRestored) {
    vscode.window.showInformationMessage('没有需要还原的补丁；自动汉化已暂停，手动应用可重新开启');
    return;
  }
  try { fs.rmSync(file + '.patch-report.json'); } catch (e) { }
  st.restoredAt = new Date().toISOString();
  await context.globalState.update(KEY, st);
  status.text = '$(globe) Claude汉化(已还原)';
  const pick = await vscode.window.showInformationMessage('已还原英文并暂停自动汉化，重载窗口生效；手动应用可重新开启', '立即重载', '稍后');
  if (pick === '立即重载') vscode.commands.executeCommand('workbench.action.reloadWindow');
  } catch (e) {
    status.text = '$(globe) Claude汉化 ✗';
    vscode.window.showErrorMessage('还原未完成，自动汉化已暂停：' + e.message);
  }
}

// Claude 回复语言：写 ~/.claude/settings.json 的 language 键（只动这一个键）
async function setReplyLanguage(context, on) {
  try {
    const r = on ? userlang.setLanguage() : userlang.unsetLanguage();
    await context.globalState.update('claudeZh.langAsked', true);
    if (!r.changed) {
      vscode.window.showInformationMessage(on ? 'Claude 已设为中文回复，无需修改'
        : (r.previous ? `回复语言是 "${r.previous}"（不是本扩展设置的），未改动` : '未设置回复语言，无需还原'));
      return;
    }
    vscode.window.showInformationMessage(on
      ? `已设置 Claude 用中文回复（${r.path}），新会话生效`
      : `已移除回复语言设置（${r.path}），新会话生效`);
  } catch (e) {
    vscode.window.showErrorMessage('修改 Claude 设置失败: ' + e.message);
  }
}

// 首次启用时问一次；用户已有 language 设置或之前回答过就不再问
async function maybeAskReplyLanguage(context) {
  if (context.globalState.get('claudeZh.langAsked')) return;
  if (userlang.getLanguage() !== undefined) { await context.globalState.update('claudeZh.langAsked', true); return; }
  const pick = await vscode.window.showInformationMessage(
    '要让 Claude 也用中文回复吗？会在 ~/.claude/settings.json 加一行 "language": "chinese"，可随时用命令还原。',
    '设为中文', '不用');
  if (pick === '设为中文') await setReplyLanguage(context, true);
  else if (pick === '不用') await context.globalState.update('claudeZh.langAsked', true);
}

function openRules(context) {
  const p = path.join(context.extensionPath, 'translations', 'built-in.json');
  vscode.workspace.openTextDocument(p).then(d => vscode.window.showTextDocument(d));
}

async function activate(context) {
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'claude-zh.apply';
  status.text = '$(globe) Claude汉化';
  status.tooltip = '应用/重试 Claude Code 界面汉化';
  status.show();
  context.subscriptions.push(status);

  context.subscriptions.push(
    vscode.commands.registerCommand('claude-zh.apply', () => apply(context, true)),
    vscode.commands.registerCommand('claude-zh.restore', () => restore(context)),
    vscode.commands.registerCommand('claude-zh.openRules', () => openRules(context)),
    vscode.commands.registerCommand('claude-zh.setReplyZh', () => setReplyLanguage(context, true)),
    vscode.commands.registerCommand('claude-zh.unsetReplyZh', () => setReplyLanguage(context, false)),
  );
  const askTimer = setTimeout(() => maybeAskReplyLanguage(context).catch(() => { }), 5000);
  context.subscriptions.push({ dispose: () => clearTimeout(askTimer) });

  const auto = vscode.workspace.getConfiguration('claudeZh').get('autoApply');
  if (auto !== false && !context.globalState.get('claudeZh.paused')) {
    // deferred: let extension host settle, then check & patch if needed
    const applyTimer = setTimeout(() => apply(context, false).catch(() => { }), 3000);
    context.subscriptions.push({ dispose: () => clearTimeout(applyTimer) });
  } else {
    const file = findWebview();
    if (file) {
      try {
        const src = fs.readFileSync(file, 'utf8');
        const n = (src.match(/\\u[4-9a-f][0-9a-f]{3}/gi) || []).length + (src.match(/[一-鿿]/g) || []).length;
        if (n > 2000) status.text = '$(globe) Claude汉化 ✓';
      } catch (e) { }
    }
  }
}

function deactivate() { }

module.exports = { activate, deactivate };
