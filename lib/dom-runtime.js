// Runtime DOM layer, appended to the webview bundle as an isolated IIFE.
// It only rewrites the *data* of existing text nodes and a few display attributes
// (never adds/removes/moves nodes), so React reconciliation and app logic are untouched:
// JS string values stay English, only what is painted changes. Chat content, code,
// editors and inputs are skipped. Any error disables the layer, never the app.

/* eslint-disable no-var */
function zhRuntime(D, T) {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined' || window.__claudeZhDom) return;
  window.__claudeZhDom = 1;
  var SKIP = [
    'pre', 'code', 'kbd', 'textarea', 'input', 'select', 'script', 'style', 'svg',
    '[contenteditable]:not([contenteditable="false"])', '[data-engine-markdown]', '.monaco-editor',
    '[class*="userMessage_"]', '[class*="thinkingContent_"]', '[class*="toolBody"]', '[class*="output_"]',
    '[class*="bashCommand_"]', '[class*="commandText_"]', '[class*="fileName_"]', '[class*="sessionName_"]',
    '[class*="gitOutput"]', '[class*="mentionMirror_"]', '[class*="diffEditor"]', '[class*="codeBlock"]',
    '[class*="typedAnswer_"]', '[class*="questionText"]', '[class*="selectedTextPreview"]', '[data-zh-skip]', '.xterm', '[role="log"]',
  ].join(',');
  var ATTRS = ['placeholder', 'title', 'aria-label', 'data-placeholder', 'aria-description', 'alt'];
  var hasOwn = Object.prototype.hasOwnProperty;

  // templates: "{0} days ago" -> anchored regex, with a literal hint for a cheap pre-check
  var tpl = [];
  for (var key in T) {
    if (!hasOwn.call(T, key)) continue;
    var parts = key.split(/\{(\d+)\}/), re = '^', order = [], hint = '';
    for (var i = 0; i < parts.length; i++) {
      if (i % 2) { re += '([\\s\\S]+?)'; order.push(parts[i]); }
      else { re += parts[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); if (parts[i].length > hint.length) hint = parts[i]; }
    }
    if (hint.replace(/\s/g, '').length < 3) continue; // too generic to match safely
    var count = {}, cm, cre = /\{(\d+)\}\s*[个条项次份张位台篇处行字种轮天小分秒周月年](?![目理])/g; // 排除"条目""处理"等普通词
    while ((cm = cre.exec(T[key]))) count[cm[1]] = 1;
    var generic = hint.replace(/\s/g, '').length < 16 && !/["'“]\{\d+\}["'”]/.test(key);
    tpl.push({ re: new RegExp(re + '$'), order: order, hint: hint, zh: T[key], count: count, identity: T[key] === key, generic: generic });
  }
  tpl.sort(function (a, b) { return Number(b.identity) - Number(a.identity) || b.hint.length - a.hint.length; });

  function tr(s) {
    if (!s || s.length > 600 || !/[A-Za-z]/.test(s)) return null;
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s), core = m[2];
    for (var j = 0; j < tpl.length && tpl[j].identity; j++) if (tpl[j].re.test(core)) return s;
    if (hasOwn.call(D, s)) return D[s];
    if (core !== s && hasOwn.call(D, core)) return m[1] + D[core] + m[3];
    for (var j = 0; j < tpl.length; j++) {
      var t = tpl[j];
      if (core.indexOf(t.hint) < 0) continue;
      var r = t.re.exec(core);
      if (!r) continue;
      var vals = {};
      for (var g = 0; g < t.order.length; g++) vals[t.order[g]] = r[g + 1];
      // 槽位守卫：槽位必须是名字/数字而非散文（防 "Open {0}" 吞整句）；
      // 槽位本身是独立词条说明这是"标签+后缀"而非计数；计数模板的槽位必须含数字
      var bad = false;
      for (var g = 0; g < t.order.length && !bad; g++) {
        var v = vals[t.order[g]];
        if ((t.generic && (/[A-Za-z]+ [A-Za-z]+ [A-Za-z]+ [A-Za-z]+/.test(v) || hasOwn.call(D, v.trim()))) ||
            (t.count[t.order[g]] && !/\d/.test(v))) bad = true;
      }
      if (bad) continue;
      var out = t.zh.replace(/\{(\d+)\}/g, function (x, n) { return hasOwn.call(vals, n) ? vals[n] : x; });
      if (out.length > core.length * 4 + 40) return null; // 失控替换守卫
      return m[1] + out + m[3];
    }
    return null;
  }

  // Used only by the action menu's local search index. Never changes a command
  // object's label/id or rewrites the text typed into the search input.
  window.__claudeZhSearchLabel = function (s) {
    if (typeof s !== 'string') return '';
    var translated = tr(s);
    return translated && translated !== s ? translated : '';
  };

  function skipped(el) {
    return !el || !!el.closest(SKIP);
  }
  var textEdits = new WeakMap(), attrEdits = new WeakMap();
  function restoreZone(root) {
    function restoreText(n) {
      var edit = textEdits.get(n);
      if (edit && n.data === edit.out) n.data = edit.source;
      textEdits.delete(n);
    }
    function restoreAttrs(el) {
      var edits = attrEdits.get(el);
      if (edits) for (var key in edits) if (el.getAttribute(key) === edits[key].out) el.setAttribute(key, edits[key].source);
      attrEdits.delete(el);
    }
    if (root.nodeType === 3) { restoreText(root); return; }
    if (root.nodeType !== 1) return;
    restoreAttrs(root);
    var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT), x;
    while ((x = w.nextNode())) { if (x.nodeType === 3) restoreText(x); else restoreAttrs(x); }
  }
  function canAttrs(el) {
    return !skipped(el.parentElement) && (!el.matches(SKIP) || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  }
  function doText(n) {
    var previous = textEdits.get(n);
    if (previous && n.data === previous.out) return;
    textEdits.delete(n);
    var v = tr(n.data);
    if (v != null && v !== n.data) { textEdits.set(n, { source: n.data, out: v }); n.data = v; }
  }
  function doAttrs(el) {
    for (var k = 0; k < ATTRS.length; k++) {
      var a = el.getAttribute(ATTRS[k]);
      if (!a) continue;
      var edits = attrEdits.get(el) || {};
      if (edits[ATTRS[k]] && edits[ATTRS[k]].out === a) continue;
      var v = tr(a);
      if (v != null && v !== a) {
        edits[ATTRS[k]] = { source: a, out: v }; attrEdits.set(el, edits);
        el.setAttribute(ATTRS[k], v);
      }
    }
  }
  var FILTER = {
    acceptNode: function (x) {
      if (x.nodeType === 1 && x.matches(SKIP)) { restoreZone(x); if (canAttrs(x)) doAttrs(x); return NodeFilter.FILTER_REJECT; }
      return NodeFilter.FILTER_ACCEPT;
    },
  };
  function scan(root) {
    if (root.nodeType === 3) { if (skipped(root.parentElement)) restoreZone(root); else doText(root); return; }
    if (root.nodeType !== 1) return;
    if (skipped(root)) { restoreZone(root); if (canAttrs(root)) doAttrs(root); return; }
    doAttrs(root);
    var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, FILTER), x;
    while ((x = w.nextNode())) { if (x.nodeType === 3) doText(x); else doAttrs(x); }
  }

  var broken = false;
  var obs = new MutationObserver(function (ms) {
    if (broken) return;
    try {
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (m.type === 'childList') { for (var j = 0; j < m.addedNodes.length; j++) scan(m.addedNodes[j]); }
        else if (m.type === 'characterData') scan(m.target);
        else if (m.type === 'attributes') {
          if (ATTRS.indexOf(m.attributeName) < 0) scan(m.target);
          else if (canAttrs(m.target)) doAttrs(m.target);
        }
      }
    } catch (e) { broken = true; obs.disconnect(); }
  });
  try {
    obs.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat(['class', 'contenteditable', 'data-zh-skip', 'data-engine-markdown', 'role']) });
    if (document.body) scan(document.body);
  } catch (e) { broken = true; obs.disconnect(); }
}

const asciiJson = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

// split a flat {en: zh} map into exact entries and {n}-placeholder templates
function buildRuntime(map) {
  const D = {}, T = {};
  for (const [en, zh] of Object.entries(map)) {
    if (typeof zh !== 'string' || !zh) continue;
    if (/\{\d+\}/.test(en)) T[en] = zh; else D[en] = zh;
  }
  const code = '\n;(function(){try{(' + zhRuntime.toString() + ')(' + asciiJson(D) + ',' + asciiJson(T) + ')}catch(e){}})();\n';
  return { code, exact: Object.keys(D).length, templates: Object.keys(T).length };
}

module.exports = { buildRuntime, zhRuntime };
