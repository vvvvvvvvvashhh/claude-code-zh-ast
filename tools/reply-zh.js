// CLI: node tools/reply-zh.js           -> set "language": "chinese" in Claude Code user settings
//      node tools/reply-zh.js --unset   -> remove it (only if it is still "chinese")
//      node tools/reply-zh.js --status  -> show current value
const { setLanguage, unsetLanguage, getLanguage, settingsPath } = require('../lib/userlang');

const arg = process.argv[2];
try {
  if (arg === '--status') {
    console.log(settingsPath(), '-> language =', JSON.stringify(getLanguage()));
  } else if (arg === '--unset') {
    const r = unsetLanguage();
    console.log(r.changed ? `removed language (was ${JSON.stringify(r.previous)})` : `unchanged (language = ${JSON.stringify(r.previous)})`, '->', r.path);
  } else {
    const r = setLanguage();
    console.log(r.changed ? `set language = "chinese" (was ${JSON.stringify(r.previous)})` : 'already "chinese"', '->', r.path);
    if (r.changed) console.log('takes effect in new Claude Code sessions');
  }
} catch (e) {
  console.log('FAILED (file untouched):', e.message);
  process.exit(1);
}
