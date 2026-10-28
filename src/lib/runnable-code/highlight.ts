/**
 * Minimal, self-contained Python syntax highlighter for the LIVE editor.
 *
 * Why this exists: the authored code is highlighted at build time by Shiki, but
 * once a cell becomes editable we re-render the underlay on every keystroke, and
 * Shiki does not run in the browser. Rather than let the editor go colourless
 * while typing, this tiny tokeniser re-highlights the text on each edit. It only
 * loads with the runnable-code island (never on the static read path) and is
 * intentionally small: it handles the Python token classes that carry almost all
 * the visual signal (comments, strings incl. f-strings and triple-quotes,
 * numbers, keywords, builtins, and function-call names) and leaves everything
 * else as default-coloured text. It is not a parser; it is a lexical colouriser.
 *
 * The colour ROLES map to the same GitHub-light / GitHub-dark values Shiki emits
 * for this project, applied as inline `color` + `--shiki-dark` CSS variables on
 * each span, so `[data-theme="dark"]` swapping (handled globally in global.css
 * for `--shiki-dark`) themes the live editor exactly like a static block.
 */

/**
 * Token colour roles with their GitHub-light / GitHub-dark hex pairs, chosen to
 * match exactly what Shiki's `github-light` / `github-dark` themes emit for this
 * project, so a cell looks identical before the first edit (Shiki) and after it
 * (this colouriser). In that theme:
 *   - `entity`  (blue)   = a `def` name, `self`/`cls`, and builtins; and
 *   - `class`   (purple) = a class name after `class` and a called name.
 */
const ROLE = {
  comment: ['#6A737D', '#6A737D'],
  string: ['#032F62', '#9ECBFF'],
  number: ['#005CC5', '#79B8FF'],
  keyword: ['#D73A49', '#F97583'],
  entity: ['#005CC5', '#79B8FF'],
  class: ['#6F42C1', '#B392F0'],
  plain: ['#24292E', '#E1E4E8'],
} as const;

type Role = keyof typeof ROLE;

/** Python keywords (the red-violet set). */
const KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for',
  'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not',
  'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield', 'match',
  'case',
]);

/** Common builtins worth tinting (kept small; unknown names stay plain). */
const BUILTINS = new Set([
  'print', 'len', 'range', 'int', 'float', 'str', 'bool', 'list', 'dict', 'set',
  'tuple', 'abs', 'min', 'max', 'sum', 'sorted', 'enumerate', 'zip', 'map',
  'filter', 'type', 'isinstance', 'round', 'open', 'input', 'format',
]);

/**
 * Names Shiki tints as the blue `entity` colour wherever they appear — the
 * conventional instance / class reference parameters. Kept separate from
 * builtins only for readability.
 */
const SELF_NAMES = new Set(['self', 'cls']);

/** Escape text for safe insertion as an HTML text node's content. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Wrap `text` in a span carrying the role's light colour + dark variable. */
function span(text: string, role: Role): string {
  if (role === 'plain') return esc(text);
  const [light, dark] = ROLE[role];
  return `<span style="color:${light};--shiki-dark:${dark}">${esc(text)}</span>`;
}

/**
 * Highlight one logical line of Python into an HTML string (text nodes escaped,
 * token spans carrying inline colours). Exported and pure so it is unit-testable
 * without a DOM. Triple-quoted strings spanning multiple lines are handled by
 * `highlightPython` tracking state across lines.
 */
export function highlightPython(source: string): string {
  // Token regex, ordered by priority. The first alternative that matches at the
  // cursor wins. Groups:
  //   1 comment | 2 triple-string | 3 string | 4 number | 5 name | 6 operator
  // Operators are the symbols Shiki tints red (= + - * / % etc. and compounds);
  // structural punctuation (`.`, `,`, `:`, `;`, brackets, braces, parens) is
  // deliberately NOT in group 6 so it stays plain, exactly like Shiki.
  const re =
    /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?''')|([rbfRBF]{0,2}"(?:\\.|[^"\\])*"|[rbfRBF]{0,2}'(?:\\.|[^'\\])*')|(\b\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?j?\b)|([A-Za-z_][A-Za-z0-9_]*)|([=+\-*/%@&|^~<>!]+)/g;

  let out = '';
  let last = 0;
  // The last NAME token seen, so `def NAME` / `class NAME` colour their name
  // like Shiki (blue entity for a def, purple for a class) rather than guessing
  // only from a trailing "(".
  let prevName = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    // Default-coloured text between tokens (operators, punctuation, whitespace).
    if (m.index > last) out += span(source.slice(last, m.index), 'plain');

    if (m[1] !== undefined) {
      out += span(m[1], 'comment');
    } else if (m[2] !== undefined) {
      out += span(m[2], 'string');
    } else if (m[3] !== undefined) {
      out += span(m[3], 'string');
    } else if (m[4] !== undefined) {
      out += span(m[4], 'number');
    } else if (m[5] !== undefined) {
      const name = m[5];
      let role: Role = 'plain';
      if (prevName === 'def') {
        // The name being defined: Shiki tints it blue (entity), not purple.
        role = 'entity';
      } else if (prevName === 'class') {
        // The class being defined: Shiki tints it purple.
        role = 'class';
      } else if (KEYWORDS.has(name)) {
        role = 'keyword';
      } else if (SELF_NAMES.has(name) || BUILTINS.has(name)) {
        role = 'entity';
      } else {
        // Call heuristic: a name immediately followed by "(" is a call (purple).
        const after = source.slice(re.lastIndex);
        if (/^\s*\(/.test(after)) role = 'class';
      }
      prevName = name;
      out += span(name, role);
      last = re.lastIndex;
      continue;
    } else if (m[6] !== undefined) {
      // Operator run (= + - * / % etc.): Shiki tints these the keyword red.
      out += span(m[6], 'keyword');
      prevName = '';
    }
    last = re.lastIndex;
  }
  if (last < source.length) out += span(source.slice(last), 'plain');
  return out;
}
