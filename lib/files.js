const fs = require('fs');
const crypto = require('crypto');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const readOptional = file => fs.existsSync(file) ? fs.readFileSync(file) : null;
const equal = (a, b) => a === null || b === null ? a === b : Buffer.from(a).equals(Buffer.from(b));

// Prepare every write before replacing anything. A failed commit restores all
// files already replaced, including backups and state, or reports rollback errors.
function commit(changes, expected = new Map()) {
  const entries = [], done = [];
  const token = process.pid + '-' + crypto.randomBytes(6).toString('hex');
  try {
    for (const [file, value] of changes) {
      const before = readOptional(file);
      if (expected.has(file) && !equal(before, expected.get(file))) throw new Error(`文件在准备补丁时发生变化：${file}`);
      const after = value === null ? null : Buffer.from(value);
      if (equal(before, after)) continue;
      const tmp = file + '.tmp-' + token;
      const entry = { file, before, after, tmp };
      entries.push(entry);
      if (after !== null) fs.writeFileSync(tmp, after, { mode: before === null ? 0o600 : fs.statSync(file).mode });
    }
    for (const entry of entries) {
      if (!equal(readOptional(entry.file), entry.before)) throw new Error(`文件在提交补丁时发生变化：${entry.file}`);
      if (entry.after === null) fs.unlinkSync(entry.file);
      else fs.renameSync(entry.tmp, entry.file);
      done.push(entry);
    }
    return entries.map(e => e.file);
  } catch (error) {
    const failures = [];
    for (const entry of done.reverse()) {
      try {
        if (entry.before === null) fs.rmSync(entry.file, { force: true });
        else { fs.writeFileSync(entry.tmp, entry.before); fs.renameSync(entry.tmp, entry.file); }
      } catch (e) { failures.push(`${entry.file}: ${e.message}`); }
    }
    throw new Error(`${error.message}；${failures.length ? '部分回滚失败：' + failures.join('；') : '未提交的改动已取消，已提交的改动已回滚'}`);
  } finally {
    for (const entry of entries) { try { fs.rmSync(entry.tmp, { force: true }); } catch (_) { } }
  }
}

function state(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
module.exports = { sha, commit, state };
