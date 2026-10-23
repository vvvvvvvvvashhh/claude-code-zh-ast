// 回归测试：补丁/备份/还原在 Claude Code 更新场景下的行为。用法：node tools/test-restore.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const vm = require('vm');
const { addSearchAliases } = require('../lib/search');
const { patchFile, restoreFile, translateContent } = require('../lib/translator');
const { patchPackageJson, restorePackageJson } = require('../lib/pkgjson');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cczh-test-'));
const file = path.join(dir, 'index.js');
const pkgFile = path.join(dir, 'package.json');
const bundle = ver => `var V="${ver}";function L(k,m){return m}var a={label:"Open file"};L("x.y","Search");`;
const map = { 'Open file': '打开文件', 'Search': '搜索' };
const pkg = ver => JSON.stringify({ version: ver, contributes: { commands: [{ command: 'x', title: 'Open file' }] } });
const read = f => fs.readFileSync(f, 'utf8');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

try {
  t('首次补丁生成备份并带显示层', () => {
    fs.writeFileSync(file, bundle('v1'));
    const r = patchFile(file, map, 'calls', map);
    assert.ok(!r.alreadyPatched && r.applied > 0);
    assert.ok(read(file).includes('__claudeZhDom'));
    assert.ok(read(file + '.en-backup').includes('V="v1"') && !read(file + '.en-backup').includes('__claudeZhDom'));
  });
  t('同词典重复补丁幂等', () => assert.ok(patchFile(file, map, 'calls', map).alreadyPatched));
  t('词典变化从备份重打', () => {
    const m2 = { ...map, 'Search': '查找' };
    const r = patchFile(file, m2, 'calls', m2);
    assert.ok(!r.alreadyPatched);
    assert.ok(read(file).includes('查找') || read(file).includes('\\u67e5\\u627e'));
  });
  t('Claude Code 原地更新后刷新备份', () => {
    fs.writeFileSync(file, bundle('v2'));
    patchFile(file, map, 'calls', map);
    assert.ok(read(file + '.en-backup').includes('V="v2"'));
    assert.ok(read(file).includes('V="v2"'));
  });
  t('更新后（文件已是新版原文）还原不覆盖', () => {
    fs.writeFileSync(file, bundle('v3'));
    assert.strictEqual(restoreFile(file), false);
    assert.ok(read(file).includes('V="v3"'));
  });
  t('正常还原', () => {
    patchFile(file, map, 'calls', map);
    assert.ok(restoreFile(file));
    assert.strictEqual(read(file), bundle('v3'));
  });
  t('备份丢失时不把补丁产物当原版', () => {
    patchFile(file, map, 'calls', map);
    fs.rmSync(file + '.en-backup');
    fs.rmSync(file + '.zh-state.json');
    assert.throws(() => patchFile(file, map, 'calls', map), /不匹配/);
    assert.ok(!fs.existsSync(file + '.en-backup'));
  });
  t('嵌套构造参数/未知调用/结构属性不被翻译，明确显示属性仍翻译', () => {
    const input = 'new C(0,"visible scrollbar "+extra);send(flag?"Open file":"Other");send({message:"Open file"});var x={className:"visible scrollbar "+extra,label:flag?"Open file":"Other"};';
    const out = translateContent(input, { ...map, 'visible scrollbar ': '可见滚动条 ' }, 'calls');
    assert.ok(out.src.includes('"visible scrollbar "+extra'));
    assert.ok(out.src.includes('send(flag?"Open file":"Other")'));
    assert.ok(out.src.includes('send({message:"Open file"})'));
    assert.strictEqual(out.applied, 1);
  });
  t('状态丢失时保留英文备份并明确拒绝，不污染备份', () => {
    const f = path.join(dir, 'lost-state.js');
    fs.writeFileSync(f, bundle('small'));
    patchFile(f, map, 'calls', map);
    const backup = read(f + '.en-backup');
    fs.rmSync(f + '.zh-state.json');
    assert.throws(() => patchFile(f, map, 'calls', map), /不匹配/);
    assert.strictEqual(read(f + '.en-backup'), backup);
    assert.throws(() => restoreFile(f), /不匹配/);
  });
  t('错误版本备份不能写回', () => {
    const f = path.join(dir, 'wrong-backup.js');
    fs.writeFileSync(f, bundle('current'));
    patchFile(f, map, 'calls', map);
    const patched = read(f);
    fs.writeFileSync(f + '.en-backup', bundle('old'));
    assert.throws(() => restoreFile(f), /不匹配/);
    assert.strictEqual(read(f), patched);
  });
  t('package.json 汉化与同版本还原', () => {
    fs.writeFileSync(pkgFile, pkg('1.0.0'));
    assert.ok(patchPackageJson(pkgFile, map).changed);
    assert.strictEqual(JSON.parse(read(pkgFile)).contributes.commands[0].title, '打开文件');
    assert.ok(restorePackageJson(pkgFile));
    assert.strictEqual(JSON.parse(read(pkgFile)).contributes.commands[0].title, 'Open file');
  });
  t('package.json 升级后旧备份不写回', () => {
    patchPackageJson(pkgFile, map);
    fs.writeFileSync(pkgFile, pkg('2.0.0'));
    assert.strictEqual(restorePackageJson(pkgFile), false);
    assert.strictEqual(JSON.parse(read(pkgFile)).version, '2.0.0');
  });
  t('排除最后一个 package.json 词条时恢复英文', () => {
    patchPackageJson(pkgFile, map);
    assert.ok(patchPackageJson(pkgFile, { 'Open file': 'Open file' }).changed);
    assert.strictEqual(JSON.parse(read(pkgFile)).contributes.commands[0].title, 'Open file');
  });
  t('菜单可中英文检索，返回原命令对象且不改 ID/回调/输入', () => {
    const src = 'function search(groups,query){let rows=Object.entries(groups).flatMap(([section,commands])=>commands.map(command=>({cmd:command,section:section})));return new Fuse(rows,{includeScore:true,keys:[{name:"cmd.label",weight:3},{name:"cmd.aliases",weight:2},{name:"cmd.id",weight:2},{name:"cmd.description",weight:0.5}]}).search(query).map(row=>row.item.cmd)}';
    const patched = addSearchAliases(src);
    assert.ok(patched.applied);
    const action = { id: 'sandbox', label: 'Sandbox', description: 'Manage sandbox', aliases: ['sandbox'], run() {} };
    const before = { ...action, aliases: [...action.aliases] };
    class Fuse {
      constructor(rows, options) { this.rows = rows; this.options = options; }
      search(query) { return this.rows.filter(row => this.options.keys.some(key => {
        const value = key.name.split('.').reduce((object, part) => object?.[part], row);
        return String(value || '').toLowerCase().includes(query.toLowerCase());
      })).map(item => ({ item })); }
    }
    const context = { Fuse, groups: { actions: [action] }, __claudeZhSearchLabel: value => value === 'Sandbox' ? '沙箱' : '' };
    vm.runInNewContext(patched.src, context);
    for (const query of ['Sandbox', '沙箱']) {
      context.query = query;
      assert.strictEqual(vm.runInNewContext('search(groups,query)[0]', context), action);
      assert.strictEqual(context.query, query);
    }
    assert.deepStrictEqual(action, before);
  });
  t('未识别到菜单索引结构时不修改其他搜索逻辑', () => {
    const src = 'function other(){return new Search(items,{keys:["id","label"]})}';
    const result = addSearchAliases(src);
    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.src, src);
  });
  console.log(`\n${n} passed`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
