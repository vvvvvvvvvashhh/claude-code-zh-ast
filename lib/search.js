// Add display-only fields to the action menu's Fuse index. The command objects,
// IDs, callbacks and the user's query remain unchanged.
const acorn = require('../node_modules/acorn');
const SEARCH_VERSION = 1;
const name = p => p.key?.type === 'Identifier' ? p.key.name : p.key?.value;
const property = (node, key) => node?.type === 'ObjectExpression' ? node.properties.find(p => p.type === 'Property' && name(p) === key) : undefined;
function walk(node, visit, parents = []) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parents);
  for (const [key, value] of Object.entries(node)) {
    if (['start', 'end', 'raw'].includes(key)) continue;
    if (Array.isArray(value)) for (const item of value) walk(item, visit, [...parents, node]);
    else if (value && typeof value.type === 'string') walk(value, visit, [...parents, node]);
  }
}
function addSearchAliases(src) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  const sites = [];
  walk(ast, (node, parents) => {
    if (node.type !== 'NewExpression') return;
    const keys = property(node.arguments[1], 'keys')?.value;
    if (keys?.type !== 'ArrayExpression' || keys.elements.length !== 4) return;
    const names = keys.elements.map(item => property(item, 'name')?.value?.value);
    if (!['cmd.label', 'cmd.aliases', 'cmd.id', 'cmd.description'].every(key => names.includes(key))) return;
    const owner = [...parents].reverse().find(n => /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n.type));
    if (!owner) return;
    const wrappers = [];
    walk(owner, n => {
      if (n.type !== 'ObjectExpression' || n.properties.length !== 2) return;
      const cmd = property(n, 'cmd')?.value, section = property(n, 'section')?.value;
      if (cmd?.type === 'Identifier' && section?.type === 'Identifier') wrappers.push({ node: n, cmd, section });
    });
    if (wrappers.length === 1) sites.push({ keys, ...wrappers[0] });
  });
  // Unknown upstream layouts are left untouched, never guessed by minified names.
  if (sites.length !== 1) return { src, applied: false, reason: 'action-search-site-not-found' };
  const { keys, node, cmd, section } = sites[0];
  const c = src.slice(cmd.start, cmd.end), s = src.slice(section.start, section.end);
  const alias = field => `(typeof globalThis.__claudeZhSearchLabel==="function"?globalThis.__claudeZhSearchLabel(${c}?.${field}):"")`;
  const edits = [
    { start: node.start, end: node.end,
      text: `({cmd:${c},section:${s},__claudeZhLabel:${alias('label')},__claudeZhDescription:${alias('description')}})` },
    { start: keys.start, end: keys.end,
      text: '[' + keys.elements.map(n => src.slice(n.start, n.end)).concat(
        '{name:"__claudeZhLabel",weight:3}', '{name:"__claudeZhDescription",weight:0.5}').join(',') + ']' },
  ].sort((a, b) => b.start - a.start);
  let out = src;
  for (const edit of edits) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  acorn.parse(out, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  return { src: out, applied: true };
}
module.exports = { addSearchAliases, SEARCH_VERSION };
