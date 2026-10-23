// translates contributes.configuration descriptions in an extension's package.json
// using the same en->zh map. backs up to package.json.en-backup, atomic write.
const fs = require('fs');
const { sha, commit, state } = require('./files');

// Migration from <=0.2.4: those versions did not save package state. Only
// display-field differences are acceptable; executable/manifest structure must agree.
function structure(pkg) {
  const copy = JSON.parse(JSON.stringify(pkg)), c = copy.contributes || {};
  for (const command of c.commands || []) for (const k of ['title', 'shortTitle', 'category']) delete command[k];
  const cfgs = c.configuration ? (Array.isArray(c.configuration) ? c.configuration : [c.configuration]) : [];
  for (const cfg of cfgs) for (const p of Object.values(cfg.properties || {})) {
    for (const k of ['description', 'markdownDescription', 'deprecationMessage', 'enumDescriptions', 'markdownEnumDescriptions']) delete p[k];
  }
  return JSON.stringify(copy);
}

function originalPackage(pkgPath) {
  const current = fs.readFileSync(pkgPath, 'utf8'), pkg = JSON.parse(current);
  const backup = pkgPath + '.en-backup', st = state(pkgPath + '.zh-state.json');
  if (!fs.existsSync(backup)) {
    if (st) throw new Error('package.json 英文备份丢失，未修改');
    return { current, raw: current, pkg };
  }
  const raw = fs.readFileSync(backup, 'utf8'), original = JSON.parse(raw);
  if (pkg.version !== original.version) return { current, raw: current, pkg };
  if (st) {
    if (st.sourceHash !== sha(raw) || (st.patchedHash !== sha(current) && sha(raw) !== sha(current))) throw new Error('package.json 状态或备份不匹配');
  } else if (structure(pkg) !== structure(original)) throw new Error('旧 package.json 备份与当前清单结构不匹配');
  return { current, raw, pkg: original };
}

/**
 * @returns {translated:number, changed:boolean}
 */
function patchPackageJson(pkgPath, map) {
  if (!fs.existsSync(pkgPath)) return { translated: 0, changed: false };
  const backup = pkgPath + '.en-backup';
  const { current, raw, pkg } = originalPackage(pkgPath);
  const contrib = pkg.contributes;
  if (!contrib) return { translated: 0, changed: false };
  const cfgs = contrib.configuration;
  const list = cfgs ? (Array.isArray(cfgs) ? cfgs : [cfgs]) : [];
  let n = 0;
  const tr = v => (typeof v === 'string' && Object.hasOwn(map, v) && typeof map[v] === 'string' && map[v] !== v) ? (n++, map[v]) : v;
  // command palette titles (only display fields; command ids untouched)
  if (Array.isArray(contrib.commands)) {
    for (const c of contrib.commands) {
      if (!c || typeof c !== 'object') continue;
      if (c.title) c.title = tr(c.title);
      if (c.shortTitle) c.shortTitle = tr(c.shortTitle);
      if (c.category) c.category = tr(c.category);
    }
  }
  for (const cfg of list) {
    const props = cfg && cfg.properties;
    if (!props) continue;
    for (const key of Object.keys(props)) {
      const p = props[key];
      if (!p || typeof p !== 'object') continue;
      if (p.description) p.description = tr(p.description);
      if (p.markdownDescription) p.markdownDescription = tr(p.markdownDescription);
      if (p.deprecationMessage) p.deprecationMessage = tr(p.deprecationMessage);
      if (p.enumDescriptions && Array.isArray(p.enumDescriptions)) p.enumDescriptions = p.enumDescriptions.map(tr);
      if (p.markdownEnumDescriptions && Array.isArray(p.markdownEnumDescriptions)) p.markdownEnumDescriptions = p.markdownEnumDescriptions.map(tr);
    }
  }
  const out = n ? JSON.stringify(pkg, null, 2) + '\n' : raw;
  if (out === current) return { translated: n, changed: false };
  commit(new Map([[backup, raw], [pkgPath, out], [pkgPath + '.zh-state.json',
    JSON.stringify({ sourceHash: sha(raw), patchedHash: sha(out) })]]), new Map([[pkgPath, current]]));
  return { translated: n, changed: true };
}

function restorePackageJson(pkgPath) {
  const backup = pkgPath + '.en-backup';
  if (!fs.existsSync(backup)) return false;
  // 备份版本与当前不同 = Claude Code 已更新，旧备份写回会把扩展清单降级
  try {
    if (JSON.parse(fs.readFileSync(backup, 'utf8')).version !== JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version) return false;
  } catch (e) { return false; }
  const { current, raw } = originalPackage(pkgPath);
  if (current === raw) return false;
  const changes = new Map([[pkgPath, raw]]);
  if (fs.existsSync(pkgPath + '.zh-state.json')) changes.set(pkgPath + '.zh-state.json', null);
  commit(changes, new Map([[pkgPath, current]]));
  return true;
}

module.exports = { patchPackageJson, restorePackageJson };
