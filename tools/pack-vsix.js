// 离线打包 vsix（不依赖 vsce 下载）：按 .vscodeignore 过滤文件，生成 manifest 并用系统 tar 打成 zip。
// 用法：node tools/pack-vsix.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const out = path.join(ROOT, `${pkg.name}-${pkg.version}.vsix`);

// .vscodeignore → 正则（支持 ** / * / ! 取反）
const rules = fs.readFileSync(path.join(ROOT, '.vscodeignore'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  .map(r => {
    const neg = r.startsWith('!'); if (neg) r = r.slice(1);
    const re = '^' + r.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*') + '$';
    return { neg, re: new RegExp(re) };
  });
const ignored = rel => { let ig = false; for (const r of rules) if (r.re.test(rel)) ig = !r.neg; return ig; };

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name), rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (e.isDirectory()) { if (!ignored(rel + '/x')) walk(abs); }
    else if (!ignored(rel)) files.push(rel);
  }
})(ROOT);

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hasReadme = files.includes('README.md');
const manifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${pkg.name}" Version="${pkg.version}" Publisher="${pkg.publisher}" />
    <DisplayName>${esc(pkg.displayName)}</DisplayName>
    <Description xml:space="preserve">${esc(pkg.description)}</Description>
    <Tags>${esc(pkg.keywords.join(','))}</Tags>
    <Categories>${esc(pkg.categories.join(','))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${pkg.engines.vscode}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="${(pkg.extensionKind || ['ui']).join(',')}" />
      <Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true" />
    </Properties>
    <License>extension/LICENSE</License>${pkg.icon ? `
    <Icon>extension/${esc(pkg.icon)}</Icon>` : ''}
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true" />${hasReadme ? `
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />` : ''}${pkg.icon ? `
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/${esc(pkg.icon)}" Addressable="true" />` : ''}
  </Assets>
</PackageManifest>
`;
const types = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".json" ContentType="application/json"/><Default Extension=".js" ContentType="application/javascript"/><Default Extension=".md" ContentType="text/markdown"/><Default Extension="png" ContentType="image/png"/><Default Extension=".vsixmanifest" ContentType="text/xml"/><Default Extension=".xml" ContentType="text/xml"/><Default Extension="" ContentType="application/octet-stream"/></Types>
`;

// 暂存到系统临时目录再打包
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'cczh-pack-'));
fs.writeFileSync(path.join(stage, 'extension.vsixmanifest'), manifest);
fs.writeFileSync(path.join(stage, '[Content_Types].xml'), types);
for (const rel of files) {
  const dst = path.join(stage, 'extension', rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(ROOT, rel), dst);
}
// Validate the uploadable artifact's staging tree, not the development tree.
try {
  if (pkg.icon) {
    if (!files.includes(pkg.icon)) throw new Error('图标未包含在发布包中：' + pkg.icon);
    const image = fs.readFileSync(path.join(stage, 'extension', pkg.icon));
    if (image.length < 24 || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
        image.readUInt32BE(16) < 128 || image.readUInt32BE(16) !== image.readUInt32BE(20)) {
      throw new Error('图标必须是至少 128×128 的正方形 PNG');
    }
  }
  for (const rel of ['node_modules/acorn/package.json', 'node_modules/acorn/dist/acorn.js', 'node_modules/acorn/LICENSE',
    'lib/translator.js', 'lib/search.js', 'lib/dom-runtime.js', 'lib/files.js', 'lib/pkgjson.js', 'lib/userlang.js',
    'translations/built-in.json', 'translations/dom.json']) {
    if (!files.includes(rel) || !fs.existsSync(path.join(stage, 'extension', rel))) throw new Error('缺少运行时文件：' + rel);
  }
  execFileSync(process.execPath, ['-e', 'require(process.argv[1]);require(process.argv[2]);',
    path.join(stage, 'extension/lib/translator.js'), path.join(stage, 'extension/lib/search.js')], { stdio: 'pipe' });
  console.log('staged runtime and production dependency verified');
} catch (e) {
  fs.rmSync(stage, { recursive: true, force: true });
  throw new Error('发布包检查失败，请先 npm ci 并检查 .vscodeignore：' + e.message);
}
try { fs.rmSync(out); } catch (e) { }
// Windows 10+ 自带 bsdtar（System32/tar.exe），-a 按扩展名选 zip；Git Bash 的 GNU tar 不支持
const tmpZip = path.join(os.tmpdir(), path.basename(stage) + '.zip');
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:/Windows', 'System32/tar.exe') : process.platform === 'darwin' ? 'tar' : 'bsdtar';
execFileSync(tar, ['-a', '-c', '-f', tmpZip, '-C', stage, 'extension.vsixmanifest', '[Content_Types].xml', 'extension'], { stdio: 'inherit' });
fs.copyFileSync(tmpZip, out);
fs.rmSync(tmpZip);
fs.rmSync(stage, { recursive: true, force: true });
console.log(`packed ${files.length} files -> ${path.basename(out)}`);
console.log(files.map(f => '  ' + f).join('\n'));
