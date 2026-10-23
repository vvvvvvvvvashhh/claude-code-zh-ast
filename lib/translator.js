// AST-aware webview string translator for Claude Code extension.
// Translates ONLY literals in display-value positions; skips structural roles
// (property keys, discriminants, lookups, event names, Map/Set keys, etc).
const fs = require('fs');
const acorn = require('../node_modules/acorn');

const BS = String.fromCharCode(92);

// ---------- string-level danger filter ----------
const isDangerous = en => {
  const toks = en.split(' ');
  if (toks.length >= 3 && toks.every(t => /^[a-z][a-zA-Z0-9]*$/.test(t))) return true;
  if (/^[a-z0-9.,'&+()\-\[\]\/|_]+( [a-z0-9.,'&+()\-\[\]\/|_]+)+$/.test(en)) return true;
  if (/^[dMyHhmsSWwAa]+[ ,.\-\/]*$/.test(en)) return true;
  if (/^[%@#$\d\s.,:;()\-+*/=<>]+$/.test(en)) return true;
  if (/^\$?\{/.test(en)) return true;
  if (/[<>\\\/]/.test(en)) return true;
  if (/^[@#.~]/.test(en)) return true;
  if (/\.(js|ts|css|json|html|svg|png|jpg|jpeg|gif|ico|woff2?|map|wasm|node|exe|dll|sh|bat|cmd|ps1|py|md|txt|xml|ya?ml|toml|lock|env)$/i.test(en)) return true;
  if (/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/.test(en)) return true;
  if (/^(data|https?|wss?|ftp|file|vscode|vscode-webview|chrome|about|blob|javascript|mailto):/.test(en)) return true;
  if (/^[a-z-]+:\/\//.test(en)) return true;
  if (/\$\{/.test(en)) return true;
  if (/^(utf-?8|ascii|base64|hex|utf-16|latin1|binary|ucs-?2)/i.test(en)) return true;
  return false;
};

const BAD_CALLS = new Set(['require','eval','RegExp','Symbol','Proxy','btoa','atob','fetch','open','send','navigate','importScripts','setTimeout','setInterval','postMessage','sendMessage','executeCommand','registerActions','unregisterAction','registerCommand','t','localize','formatMessage','nls','i18n','assert','invariant','expect','addEventListener','removeEventListener','dispatchEvent','querySelector','querySelectorAll','getElementById','getElementsByClassName','getElementsByTagName','getElementsByName','createElement','createElementNS','createTextNode','setAttribute','getAttribute','hasAttribute','removeAttribute','matches','closest','getContext','WebSocket','EventSource','Worker','SharedWorker','XMLHttpRequest','Notification']);
const BAD_METHODS = new Set(['includes','indexOf','lastIndexOf','startsWith','endsWith','split','replace','replaceAll','test','match','matchAll','search','slice','substring','substr','concat','join','localeCompare','normalize','parse','stringify','get','set','has','delete','add','setItem','getItem','removeItem','defineProperty','defineProperties','getOwnPropertyDescriptor','getOwnPropertyNames','hasOwnProperty','propertyIsEnumerable','keys','values','entries','fromEntries','assign','freeze','seal','preventExtensions','isExtensible','create','getPrototypeOf','setPrototypeOf','on','once','off','emit','fire','addListener','removeListener','prependListener','removeAllListeners','trigger','subscribe','unsubscribe','publish','postMessage','sendMessage','addEventListener','removeEventListener','dispatchEvent','querySelector','querySelectorAll','getElementById','getElementsByClassName','getElementsByTagName','getElementsByName','setAttribute','getAttribute','hasAttribute','removeAttribute','toggleAttribute','matches','closest','observe','unobserve','register','unregister','executeCommand','open','pushState','replaceState','send','sendBeacon','require','resolve','lookup','getState','setState','localize','formatMessage','measureText','getComputedStyle','insertRule','deleteRule','execCommand','import','load','invoke','call','apply','bind','compile','for','push','unshift','splice','exec','contains','data','is','equals','compare','assert','Assert','createOverviewRuler','createDecorationsCollection','deltaDecorations','getModel','createModel','setModel','registerContribution','getContribution','registerEditorInput','registerView','registerViews','resolveTreeItem','getTreeItem','provideTreeItems','getChildren','registerSerializer','registerWebviewPanelSerializer','registerFileSystemProvider','registerTextDocumentContentProvider','registerCompletionItemProvider','registerHoverProvider','registerDefinitionProvider','registerReferenceProvider','registerCodeActionProvider','registerDocumentSymbolProvider','registerWorkspaceSymbolProvider','registerRenameProvider','registerFormattingProvider','registerLinkProvider','registerColorProvider','registerFoldingRangeProvider','registerSelectionRangeProvider','registerSemanticTokensProvider','registerInlayHintsProvider','registerInlineCompletionProvider','registerTerminalLinkProvider','registerQuickAccessProvider','registerTaskProvider','registerDebugConfigurationProvider','registerDebugAdapterDescriptorFactory','registerUriHandler','registerFileDecorationProvider','registerTreeDataProvider','createFileSystemWatcher','executeInTerminal','sendToTerminal','showNotification','setContext','getContext','updateValue','inspect','update','overrideIdentifier']);
const BAD_OBJECTS = new Set(['JSON','Object','Reflect','localStorage','sessionStorage','document','navigator','location','history','chrome','browser','indexedDB','caches','cookieStore','customElements','Intl','Math','RegExp','Symbol','URL','URLSearchParams','Headers','FormData']);
const BAD_VALUE_KEYS = new Set(['type','kind','id','key','class','className','style','command','action','event','eventName','role','method','mode','tag','as','component','status','state','severity','variant','intent','size','align','alignItems','placement','behavior','strategy','scheme','channel','platform','os','arch','env','locale','language','unit','field','column','attr','prop','param','option','feature','permission','grant','session','header','path','route','endpoint','url','uri','href','src','srcset','ref','dependency','module','version','output','input','result','error','stage','phase','group','category','view','panel','layout','icon','cursor','trigger','handler','effect','axis','edge','side','format','reason','step','level','priority','scope','target','source','name','filename','file','dir','directory','ext','extension','mime','protocol','host','hostname','port','origin','namespace','ns','slot','part','theme','color','background','font','fontFamily','border','animation','transition','transform','filter','display','position','overflow','visibility','float','clear','value','defaultValue','data','rel','media','charset','encoding','contentType','enctype','shape','wrap','preload','loading','decoding','referrerpolicy','sandbox','allow','crossorigin','hidden','draggable','contenteditable','spellcheck','translate','autofocus','required','disabled','readonly','multiple','selected','checked','open','controls','loop','muted','autoplay','novalidate','async','defer','ismap','reversed','itemscope','playsinline']);
const BAD_VAR = /^[A-Z][A-Z0-9_]{2,}$|(Key|Keys|Type|Types|Event|Events|EventName|Command|Commands|Action|Actions|Id|ID|Ids|IDs|Name|Names|Method|Methods|Mode|Modes|Format|Formats|Protocol|Scheme|Endpoint|Endpoints|Path|Paths|Url|URL|Urls|URLs|Pattern|Patterns|Regex|Reason|Reasons|Code|Codes|Status|State|States|Kind|Kinds|Category|Categories)$/;
const BAD_BINOPS = new Set(['==','!=','===','!==','<','>','<=','>=','in','instanceof']);
const UI_KEYS = new Set(['children','label','title','placeholder','description','text','message','aria-label','ariaLabel','tooltip','header','body','emptyText','hint','footer','content','caption','summary','subtitle','alt','confirmText','cancelText','okText','buttonText','linkText','emptyMessage','loadingText','errorMessage','successMessage','warningMessage','noResultsText','searchPlaceholder','helpText','subtext','headline','banner','announcement','notice','note','instructions','intro','greeting','cta','prompt','question','answer','explanation','details','overview','quote','tagline','copyright','legal','disclaimer']);
// display-only callees are detected per bundle (see findLocalizeCallees); minified names change every build
let CALL_WHITELIST = new Set();
const CALL_WHITELIST_METHODS = new Set(['error','warn','log','info','debug','trace','group','groupEnd','dir','table','localize','format','formatMessage','t','translate']);

const inR = (n, r) => r && n.start >= r.start && n.end <= r.end;
const propName = m => !m ? null : (m.property ? (m.property.type === 'Identifier' && !m.computed ? m.property.name : (m.property.type === 'Literal' ? String(m.property.value) : null)) : (m.key ? (m.key.type === 'Identifier' && !m.computed ? m.key.name : (m.key.type === 'Literal' ? String(m.key.value) : null)) : null));

function isSafe(node, anc) {
  // Follow the value through expressions to a proven display sink. Checking
  // only direct call arguments lets concatenations/conditionals escape guards.
  let display = false;
  for (let k = anc.length - 2; k >= 0; k--) {
    const a = anc[k], child = anc[k + 1];
    if (a.type === 'Property') {
      display = a.value === child && UI_KEYS.has(propName(a)) && !BAD_VALUE_KEYS.has(propName(a));
      // A display-looking field in an immediately transmitted object is still
      // protocol data. Only a native JSX call is an allowed
      // immediate consumer; opaque component/helper calls stay in the DOM layer.
      if (display) for (let j = k - 1; j >= 0; j--) {
        const outer = anc[j];
        if (outer.type === 'CallExpression' || outer.type === 'NewExpression') {
          const tag = outer.arguments[0], callee = outer.callee;
          const name = callee.type === 'Identifier' ? callee.name : propName(callee);
          display = outer.type === 'CallExpression' && tag?.type === 'Literal' &&
            /^(div|span|button|label|p|a|input|textarea|select|option|h[1-6]|header|footer|nav|section|main|aside|ul|ol|li|table|thead|tbody|tr|td|th|form|dialog|summary|details)$/.test(tag.value) &&
            inR(node, outer.arguments[1]) && !BAD_CALLS.has(name) && !BAD_METHODS.has(name);
          break;
        }
        if (/^(VariableDeclarator|ReturnStatement|FunctionExpression|ArrowFunctionExpression|FunctionDeclaration)$/.test(outer.type)) break;
      }
      break;
    }
    if (a.type === 'CallExpression') {
      display = a.callee.type === 'Identifier' && CALL_WHITELIST.has(a.callee.name) &&
        a.arguments[1] === child && a.arguments[0]?.type === 'Literal' && DOTTED_KEY.test(a.arguments[0].value);
      break;
    }
    if (a.type === 'ConditionalExpression') {
      if (child === a.test) return false;
    } else if (a.type === 'LogicalExpression') {
      if (child === a.left) return false;
    } else if (a.type === 'BinaryExpression') {
      if (a.operator !== '+') return false;
    } else if (a.type !== 'ArrayExpression') return false;
  }
  if (!display) return false;
  for (let k = anc.length - 1; k >= 0; k--) {
    const a = anc[k];
    if ((a.type === 'MemberExpression' || a.type === 'OptionalMemberExpression') && a.computed && inR(node, a.property)) return false;
    if (a.type === 'SwitchCase' && inR(node, a.test)) return false;
    if (a.type === 'SwitchStatement' && inR(node, a.discriminant)) return false;
    if (a.type === 'BinaryExpression' && BAD_BINOPS.has(a.operator)) return false;
    if (a.type === 'UnaryExpression' || a.type === 'UpdateExpression') return false;
    if (a.type === 'ThrowStatement' && inR(node, a.argument)) return false;
    if ((a.type === 'ForOfStatement' || a.type === 'ForInStatement') && inR(node, a.right)) return false;
    if (a.type === 'TaggedTemplateExpression') return false;
    if (a.type === 'ImportDeclaration' || a.type === 'ExportAllDeclaration' || a.type === 'ImportExpression' || a.type === 'ExportSpecifier' || a.type === 'ImportSpecifier') return false;
    if (a.type === 'ExportNamedDeclaration' && inR(node, a.source)) return false;
    if (a.type === 'CallExpression' || a.type === 'NewExpression' || a.type === 'OptionalCallExpression') {
      const child = anc[k + 1];
      const direct = (child === node) || (child && child.type === 'ArrayExpression' && anc[k + 2] === node);
      if (direct) {
        const c = a.callee;
        if (c) {
          if (c.type === 'Super') return false; // super("error message") — Error-family messages
          if (c.type === 'Identifier') {
            if (BAD_CALLS.has(c.name) || /Error$|Exception$|Assert$|^assert|invariant|expect|require|import|^Super$|^_+$|^__$/i.test(c.name)) return false;
            if (!CALL_WHITELIST.has(c.name)) return false;
          }
          if (a.type === 'NewExpression') return false;
          if (c.type === 'MemberExpression' || c.type === 'OptionalMemberExpression') {
            const pn = propName(c);
            if (pn && BAD_METHODS.has(pn)) return false;
            if (c.object && c.object.type === 'Identifier' && BAD_OBJECTS.has(c.object.name)) return false;
            if (!(pn && CALL_WHITELIST_METHODS.has(pn))) return false;
          }
        }
      }
    }
    if (a.type === 'AssignmentExpression' && a.left && a.left.type === 'MemberExpression') {
      const pn = propName(a.left);
      if (pn && /^(href|src|srcset|pathname|hash|host|hostname|origin|action|formaction|className|id|value|innerHTML|outerHTML|nonce|integrity|rel|type|name|charset|method|target|pattern|min|max|step|rows|cols|colspan|rowSpan|scope|useMap|classId)$/.test(pn)) return false;
    }
  }
  const p = anc[anc.length - 2];
  if (!p) return false;
  if ((p.type === 'Property' || p.type === 'PropertyDefinition' || p.type === 'MethodDefinition' || p.type === 'AccessorProperty') && p.key === node) return false;
  if (p.type === 'Property' && p.value === node) { const kn = propName(p); if (kn && BAD_VALUE_KEYS.has(kn)) return false; }
  if ((p.type === 'MemberExpression' || p.type === 'OptionalMemberExpression') && p.object === node) { const mn = propName(p); if (mn && BAD_METHODS.has(mn)) return false; }
  if (p.type === 'VariableDeclarator' && p.id.type === 'Identifier' && BAD_VAR.test(p.id.name)) return false;
  if (p.type === 'ExpressionStatement' && p.expression === node && 'directive' in p) return false;
  return true;
}

function unesc(s) {
  return s.replace(new RegExp('\\\\(u[0-9a-fA-F]{4}|u\\{[0-9a-fA-F]+\\}|x[0-9a-fA-F]{2}|[\'"\\\\`bfnrtv0]|.)', 'g'), (m, e) => {
    if (e[0] === 'u') { if (e[1] === '{') return String.fromCodePoint(parseInt(e.slice(2, -1), 16)); return String.fromCharCode(parseInt(e.slice(1), 16)); }
    if (e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
    const M = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
    return M[e] !== undefined ? M[e] : e;
  });
}
function escZh(s) {
  let o = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === BS) o += BS + BS;
    else if (ch === '"') o += BS + '"';
    else if (ch === "'") o += BS + "'";
    else if (ch === '\n') o += BS + 'n';
    else if (ch === '\r') o += BS + 'r';
    else if (ch === '\t') o += BS + 't';
    else if (c < 32 || c > 126) { if (c > 0xFFFF) o += BS + 'u{' + c.toString(16) + '}'; else o += BS + 'u' + c.toString(16).padStart(4, '0'); }
    else o += ch;
  }
  return o;
}

// localize-style callee: declared as function f(key, message, ...args), and a large share of
// its calls look like f("dotted.key", "English message"). Both must hold, so a renamed
// non-localize function can never be whitelisted by name collision.
const DOTTED_KEY = /^[\w$-]+(\.[\w$-]+)+$/;
function findLocalizeCallees(ast) {
  const decl = new Set(), stats = new Map();
  (function w(n) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'FunctionDeclaration' && n.id && n.params.length === 3 &&
        n.params[0].type === 'Identifier' && n.params[1].type === 'Identifier' && n.params[2].type === 'RestElement') decl.add(n.id.name);
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier') {
      const a = n.arguments, st = stats.get(n.callee.name) || { n: 0, shape: 0 };
      st.n++;
      if (a.length >= 2 && a[0].type === 'Literal' && typeof a[0].value === 'string' && DOTTED_KEY.test(a[0].value) &&
          a[1].type === 'Literal' && typeof a[1].value === 'string') st.shape++;
      stats.set(n.callee.name, st);
    }
    for (const k in n) {
      if (k === 'start' || k === 'end') continue;
      const v = n[k];
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') w(c); }
      else if (v && typeof v.type === 'string') w(v);
    }
  })(ast);
  const out = new Set();
  for (const [name, st] of stats) if (decl.has(name) && st.shape >= 20 && st.shape / st.n >= 0.3) out.add(name);
  return out;
}

const RISKY = {
  safe: new Set(['CallExpression','NewExpression','VariableDeclarator','ReturnStatement','ArrowFunctionExpression','AssignmentExpression','AssignmentPattern','TemplateLiteral']),
  calls: new Set(['VariableDeclarator','ReturnStatement','NewExpression','ArrowFunctionExpression','AssignmentExpression','AssignmentPattern','TemplateLiteral']),
  all: new Set(),
};

/**
 * translate webview bundle source text.
 * returns {src, applied, literals, report:[{en,zh}], skipped:[{en,reason}]}
 * self-verifies: re-parses translated output; throws if broken (never returns bad JS).
 */
function translateContent(src, map, mode) {
  const risky = RISKY[mode] || RISKY.calls;
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true }); }
  catch (e) { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' }); }
  CALL_WHITELIST = findLocalizeCallees(ast);
  const repls = [];
  const reportMap = new Map();
  const skippedMap = new Map();
  const skip = (en, reason) => { if (!skippedMap.has(en)) skippedMap.set(en, reason); };
  let seen = 0;
  const seenNodes = new Set();
  function walk(node, anc) {
    if (!node || typeof node.type !== 'string') return;
    anc.push(node);
    if (node.type === 'Literal' && typeof node.value === 'string' && !seenNodes.has(node)) {
      seenNodes.add(node); seen++;
      const raw = src.slice(node.start, node.end), q = raw[0];
      if (q === '"' || q === "'") {
        const ri = raw.slice(1, -1), dec = unesc(ri);
        let zh;
        if (map[ri] !== undefined && map[ri] !== ri) zh = map[ri];
        else if (dec !== ri && map[dec] !== undefined && map[dec] !== dec) zh = map[dec];
        else if (node.value !== dec && node.value !== ri && map[node.value] !== undefined && map[node.value] !== node.value) zh = map[node.value];
        const enVal = zh !== undefined ? (map[ri] !== undefined ? ri : (map[dec] !== undefined ? dec : node.value)) : null;
        if (zh && enVal) {
          if (isDangerous(enVal)) skip(enVal, 'dangerous-value');
          else {
            const hasSpace = enVal.includes(' ');
            let ok = hasSpace;
            if (!ok) {
              const p = anc[anc.length - 2];
              if (p && p.type === 'Property' && p.value === node) { const kn = propName(p); if (kn && UI_KEYS.has(kn)) ok = true; }
            }
            if (!ok) skip(enVal, 'single-word-non-ui');
            else if (!isSafe(node, anc)) skip(enVal, 'unsafe-position');
            else if (risky.has((anc[anc.length - 2] || {}).type)) skip(enVal, 'risky-parent:' + (anc[anc.length - 2] || {}).type);
            else {
              repls.push({ start: node.start, end: node.end, text: q + escZh(zh) + q });
              reportMap.set(enVal, zh);
            }
          }
        }
      }
    }
    for (const key in node) {
      if (key === 'start' || key === 'end' || key === 'type' || key === 'raw' || key === 'regex' || key === 'bigint') continue;
      const v = node[key];
      if (Array.isArray(v)) { for (const c of v) { if (c && typeof c.type === 'string') walk(c, anc); } }
      else if (v && typeof v.type === 'string') walk(v, anc);
    }
    anc.pop();
  }
  walk(ast, []);
  repls.sort((a, b) => b.start - a.start);
  let out = src;
  for (const r of repls) out = out.slice(0, r.start) + r.text + out.slice(r.end);
  acorn.parse(out, { ecmaVersion: 'latest', sourceType: ast.sourceType, allowHashBang: true });
  return {
    src: out, applied: repls.length, literals: seen, localizeCallees: [...CALL_WHITELIST],
    report: [...reportMap.entries()].map(([en, zh]) => ({ en, zh })),
    skipped: [...skippedMap.entries()].map(([en, reason]) => ({ en, reason })),
  };
}

const crypto = require('crypto');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

/**
 * patch a webview file (creates .en-backup on first run, writes .zh-state.json sidecar).
 * returns {applied, literals, alreadyPatched, report, skipped}
 */
// bump when patch output changes, so already-patched installs are redone from the backup
const ENGINE_VERSION = 3;

/**
 * @param runtimeMap optional {en: zh} for the runtime DOM layer (display-only, see dom-runtime.js);
 *   omit to skip the layer.
 */
function patchFile(file, map, mode, runtimeMap) {
  const { commit, state: readState } = require('./files');
  const { addSearchAliases, SEARCH_VERSION } = require('./search');
  const backup = file + '.en-backup';
  const currentSrc = fs.readFileSync(file, 'utf8');
  let src = currentSrc;
  let srcHash = sha(src);
  const stateFile = file + '.zh-state.json';
  const st = readState(stateFile);
  const orig = fs.existsSync(backup) ? fs.readFileSync(backup, 'utf8') : null;
  const dictHash = sha(JSON.stringify([map, runtimeMap || null]));
  if ((st && st.patchedHash === srcHash) || looksPatched(file, src)) {
    if (!st || st.patchedHash !== srcHash || orig === null || sha(orig) !== st.sourceHash) {
      throw new Error('补丁状态或英文备份不匹配，已保留全部文件；请重新安装 Claude Code 后应用');
    }
    const current = st.engineVersion === ENGINE_VERSION && st.searchVersion === SEARCH_VERSION &&
      st.mode === (mode || 'calls') && st.dom === !!runtimeMap && st.dictHash === dictHash;
    if (current) {
      return { applied: 0, literals: 0, alreadyPatched: true, report: [], skipped: [] };
    }
    src = orig; srcHash = st.sourceHash;
  } else if (!st && orig !== null && sha(orig) !== srcHash) {
    throw new Error('状态文件缺失，无法确认现有文件与备份的归属；未覆盖英文备份');
  }
  const r = translateContent(src, map, mode);
  let out = r.src + '\n/*claude-zh-ast*/\n', dom = null;
  let search = { applied: false };
  if (runtimeMap) {
    search = addSearchAliases(out);
    out = search.src;
    dom = require('./dom-runtime').buildRuntime(runtimeMap);
    out += dom.code;
    acorn.parse(out, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  }
  r.src = out;
  const state = {
    engine: 'claude-zh-ast',
    engineVersion: ENGINE_VERSION,
    searchVersion: SEARCH_VERSION,
    searchAliases: search.applied,
    searchReason: search.reason,
    dom: !!runtimeMap,
    domExact: dom ? dom.exact : 0,
    domTemplates: dom ? dom.templates : 0,
    mode: mode || 'calls',
    dictHash,
    sourceHash: srcHash,
    patchedHash: sha(r.src),
    applied: r.applied,
    literals: r.literals,
    at: new Date().toISOString(),
  };
  commit(new Map([[backup, src], [file, out], [stateFile, JSON.stringify(state, null, 2)]]), new Map([[file, currentSrc]]));
  return { applied: r.applied, literals: r.literals, alreadyPatched: false, report: r.report, skipped: r.skipped, state };
}

// 当前文件是不是本扩展的补丁产物（状态哈希吻合 / 带显示层标记 / 大量中文）
function looksPatched(file, src) {
  try { if (JSON.parse(fs.readFileSync(file + '.zh-state.json', 'utf8')).patchedHash === sha(src)) return true; } catch (e) { }
  return src.includes('__claudeZhDom') || src.includes('/*claude-zh-ast*/');
}

function restoreFile(file) {
  const backup = file + '.en-backup';
  if (!fs.existsSync(backup)) return false;
  // Claude Code 原地更新后文件已是新版原文：不能用旧版备份覆盖它
  if (!looksPatched(file, fs.readFileSync(file, 'utf8'))) return false;
  const { commit, state } = require('./files');
  const st = state(file + '.zh-state.json'), original = fs.readFileSync(backup, 'utf8'), current = fs.readFileSync(file, 'utf8');
  if (!st || st.sourceHash !== sha(original) || st.patchedHash !== sha(current)) {
    throw new Error('还原被拒绝：英文备份或当前补丁与状态不匹配；请重新安装 Claude Code');
  }
  commit(new Map([[file, original], [file + '.zh-state.json', null]]), new Map([[file, current]]));
  return true;
}

module.exports = { translateContent, patchFile, restoreFile };
