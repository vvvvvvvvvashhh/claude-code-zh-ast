// Claude response language: the "language" key in Claude Code's user settings
// (~/.claude/settings.json, or $CLAUDE_CONFIG_DIR/settings.json). Touches only that key;
// refuses to write if the file exists but isn't valid JSON. Atomic write, keeps indent/EOL.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ZH = 'chinese';

function settingsPath() {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(dir, 'settings.json');
}

function read(p) {
  if (!fs.existsSync(p)) return { obj: {}, indent: 2, eol: '\n', bom: false };
  let raw = fs.readFileSync(p, 'utf8');
  const bom = raw.charCodeAt(0) === 0xfeff;
  if (bom) raw = raw.slice(1);
  let obj;
  try { obj = raw.trim() ? JSON.parse(raw) : {}; } catch (e) { throw new Error(`${p} 不是合法 JSON，未修改（${e.message}）`); }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error(`${p} 顶层不是对象，未修改`);
  const m = raw.match(/\n([ \t]+)"/);
  return { obj, indent: m ? m[1] : 2, eol: raw.includes('\r\n') ? '\r\n' : '\n', bom };
}

function write(p, { obj, indent, eol, bom }) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  let out = JSON.stringify(obj, null, indent) + '\n';
  if (eol !== '\n') out = out.replace(/\n/g, eol);
  const tmp = p + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, (bom ? '﻿' : '') + out);
  fs.renameSync(tmp, p);
}

function getLanguage(p = settingsPath()) {
  try { return read(p).obj.language; } catch (e) { return undefined; }
}

/** @returns {{path, previous, changed}} */
function setLanguage(lang = ZH, p = settingsPath()) {
  const f = read(p);
  const previous = f.obj.language;
  if (previous === lang) return { path: p, previous, changed: false };
  f.obj.language = lang;
  write(p, f);
  return { path: p, previous, changed: true };
}

/** removes the key only if it still equals `expected` (so a user's own later choice is kept) */
function unsetLanguage(expected = ZH, p = settingsPath()) {
  const f = read(p);
  if (f.obj.language === undefined || (expected !== undefined && f.obj.language !== expected)) {
    return { path: p, previous: f.obj.language, changed: false };
  }
  const previous = f.obj.language;
  delete f.obj.language;
  write(p, f);
  return { path: p, previous, changed: true };
}

module.exports = { ZH, settingsPath, getLanguage, setLanguage, unsetLanguage };
