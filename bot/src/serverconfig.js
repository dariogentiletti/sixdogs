// Reading the WARDOGS server settings document (ServerSettings.ini style) well
// enough to show it in Discord. Display only: nothing here writes.
//
// The format is Unreal's, so a line is not always "key = value":
//   Key=Value        an ordinary setting
//   !Key=ClearArray  a DIRECTIVE that empties an array, not a member of it
//   .Key=Value       appends one member to an array
// The !Key line is easy to mistake for a value. It is counted separately so it
// never shows up as "the value of Key", and so array members keep their order.

const SECTION = /^\s*\[([^\]]+)\]\s*$/;
const ENTRY = /^\s*([!.]?)\s*([^=\s][^=]*?)\s*=\s*(.*?)\s*$/;

const isComment = (line) => /^\s*[;#]/.test(line) || !line.trim();

/**
 * @returns {{name: string, entries: {key: string, value: string, kind: 'set'|'clear'|'append'}[]}[]}
 * Lines before the first [Section] land in a section named ''.
 */
export function parseConfigText(text) {
  const sections = [];
  let current = { name: '', entries: [] };
  sections.push(current);

  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (isComment(line)) continue;
    const sec = SECTION.exec(line);
    if (sec) {
      current = { name: sec[1].trim(), entries: [] };
      sections.push(current);
      continue;
    }
    const m = ENTRY.exec(line);
    if (!m) continue;
    const kind = m[1] === '!' ? 'clear' : m[1] === '.' ? 'append' : 'set';
    current.entries.push({ key: m[2].trim(), value: m[3], kind });
  }
  // Drop the leading unnamed section when nothing came before the first header.
  return sections.filter((s, i) => s.entries.length || (i > 0 && s.name));
}

/**
 * A value that must not be printed into Discord. The settings document can
 * carry the RCON password (the full-access key) and the server's join password;
 * /settings output is a message, and messages get screenshotted.
 */
export const isSecretKey = (key) => /pass(word)?|secret|token|hash/i.test(String(key ?? ''));
export const shown = (e) => (isSecretKey(e.key) && String(e.value ?? '').trim() ? '(hidden)' : e.value);

/** One section by name, case-insensitively. */
export function findSection(sections, name) {
  const low = String(name ?? '').trim().toLowerCase();
  return sections.find((s) => s.name.toLowerCase() === low) ?? null;
}

/** "Section  12 settings, 1 list" — a one-line summary per section. */
export function summarise(section) {
  const set = section.entries.filter((e) => e.kind === 'set').length;
  const lists = new Set(section.entries.filter((e) => e.kind !== 'set').map((e) => e.key)).size;
  const bits = [];
  if (set) bits.push(`${set} setting${set === 1 ? '' : 's'}`);
  if (lists) bits.push(`${lists} list${lists === 1 ? '' : 's'}`);
  return bits.join(', ') || 'empty';
}

/** Render one section's entries for a Discord code block. */
export function renderSection(section, limit = 1500) {
  const lines = [];
  for (const e of section.entries) {
    if (e.kind === 'clear') lines.push(`${e.key} = (list cleared, then built up below)`);
    else if (e.kind === 'append') lines.push(`${e.key} += ${e.value}`);
    else lines.push(`${e.key} = ${shown(e)}`);
  }
  const out = lines.join('\n');
  return out.length > limit ? `${out.slice(0, limit)}\n… (${lines.length} lines total)` : out;
}
