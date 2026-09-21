// Changing ONE value in the WARDOGS settings document, without disturbing
// anything else in it.
//
// This is the sharp end of the whole project. PUT /v1/config replaces the
// ENTIRE document, so whatever this function returns is what the live server
// becomes. A dropped line is a lost setting, and a stray newline in a value is
// an extra setting nobody asked for.
//
// So the rule here is: edit the text that is already there, byte for byte,
// and refuse anything that isn't an obvious single substitution. Refusing is
// always safe. Guessing is not, and the failures are only visible once a match
// full of people has already gone wrong.
//
// The format is Unreal's (see bot/src/serverconfig.js for the reading side):
//   Key=Value        an ordinary setting, the only kind this will touch
//   !Key=ClearArray  a DIRECTIVE that empties an array
//   .Key=Value       appends one member to an array
// Directives and array members are never edited: "the value of Key" is not a
// thing that exists for those lines.

export class ConfigEditError extends Error {
  constructor(message, code = 'config_edit') {
    super(message);
    this.code = code;
  }
}

const SECTION = /^\s*\[([^\]]+)\]\s*$/;
// indent, prefix (! . or none), key, the '=' with its spacing, value.
// Splitting it this way is what lets the line be rebuilt in its own style
// rather than a normalised one.
const ENTRY = /^(\s*)([!.]?)([^=\s][^=]*?)(\s*=\s*)(.*)$/;
const isComment = (line) => /^\s*[;#]/.test(line) || !line.trim();
const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/**
 * Replace one ordinary `Key=Value` inside one `[Section]`.
 *
 * @returns {{text: string, changed: boolean, from: string, line: number}}
 * @throws {ConfigEditError} when the edit is anything but unambiguous
 */
export function setConfigValue(text, { section, key, value } = {}) {
  if (typeof text !== 'string' || !text) {
    throw new ConfigEditError('There is no settings document to edit.', 'no_document');
  }
  const wanted = String(value ?? '');
  // A newline in a value would not be a value: it would be a new line in the
  // document, which is how you add a setting nobody reviewed.
  if (/[\r\n]/.test(wanted)) {
    throw new ConfigEditError('A setting value cannot contain a line break.', 'bad_value');
  }
  if (!section || !key) {
    throw new ConfigEditError('Both a section and a key are needed.', 'bad_request');
  }

  const lines = text.split('\n');
  let current = '';
  let sectionSeen = false;
  const hits = [];

  lines.forEach((raw, i) => {
    // Written by a Windows game, so most lines end \r. Keep it on the line and
    // put it back untouched; stripping it would rewrite every line ending.
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const cr = raw.endsWith('\r') ? '\r' : '';
    const sec = SECTION.exec(line);
    if (sec) { current = sec[1].trim(); if (same(current, section)) sectionSeen = true; return; }
    if (isComment(line) || !same(current, section)) return;
    const m = ENTRY.exec(line);
    if (!m || m[2] !== '') return; // '!' clears a list and '.' appends to one
    if (same(m[3], key)) hits.push({ i, m, cr });
  });

  if (!sectionSeen) {
    throw new ConfigEditError(`This server's settings have no [${section}] section.`, 'no_section');
  }
  if (!hits.length) {
    throw new ConfigEditError(
      `[${section}] has no ${key} setting, so there is nothing to change. `
      + 'Adding a key this server does not already use is not something to do blind.', 'no_key');
  }
  if (hits.length > 1) {
    throw new ConfigEditError(
      `[${section}] lists ${key} ${hits.length} times, so it is not clear which one counts. `
      + 'Fix that by hand before changing it from here.', 'ambiguous');
  }

  const [{ i, m, cr }] = hits;
  const from = m[5];
  if (from === wanted) return { text, changed: false, from, line: i + 1 };
  lines[i] = `${m[1]}${m[3]}${m[4]}${wanted}${cr}`;
  return { text: lines.join('\n'), changed: true, from, line: i + 1 };
}

/**
 * What changed, as the two lines themselves. Worth showing an admin before a
 * write, and worth putting in the log after one: "PlayerCount 10 -> 45" is the
 * sentence somebody will want six months from now.
 */
export function describeEdit({ section, key, from, to }) {
  return `[${section}] ${key}: ${from === '' ? '(empty)' : from} -> ${to === '' ? '(empty)' : to}`;
}

/**
 * Turn the server's `errors[]` refusal into something an admin can act on.
 *
 * The distinction that matters, and the reason this exists: the server
 * validates the WHOLE document, so a value that was already wrong before today
 * blocks a change that has nothing to do with it. Told plainly, that reads as
 * "my edit was rejected" and the admin goes looking in the wrong place. So the
 * keys at fault are always named, and an error somewhere other than the edit is
 * called out as pre-existing.
 *
 * @param {{section?, key?, code?, message?}[]} errors  as returned by the server
 * @param {{section, key}} edit  what we were trying to change
 */
export function explainConfigErrors(errors, { section, key } = {}) {
  const list = (Array.isArray(errors) ? errors : []).filter(Boolean);
  if (!list.length) return 'The game server refused the settings but did not say why.';

  const where = (e) => `${e.section ? `[${e.section}] ` : ''}${e.key ?? '(no key named)'}`;
  const why = (e) => (e.message ? `: ${e.message}` : e.code ? ` (${e.code})` : '');
  const mine = list.filter((e) => same(e.key, key) && (!e.section || same(e.section, section)));
  const theirs = list.filter((e) => !mine.includes(e));

  const out = [];
  if (mine.length) {
    out.push(`The game server would not accept that value for ${where(mine[0])}${why(mine[0])}`);
  }
  if (theirs.length) {
    const names = theirs.map((e) => `${where(e)}${why(e)}`);
    out.push(
      (mine.length ? 'It also rejects' : 'The change itself is fine, but the game server rejects')
      + ` ${names.length === 1 ? 'a setting' : `${names.length} settings`} that ${names.length === 1 ? 'was' : 'were'} `
      + `already in the document: ${names.join('; ')}. `
      + 'The whole document is checked at once, so that has to be fixed before anything else can be saved.');
  }
  return `${out.join('. ')}.`.replace(/\.\.+$/, '.');
}

/** One ordinary `Key=Value` from one section, or null. */
export function getConfigValue(text, { section, key } = {}) {
  let current = '';
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const sec = SECTION.exec(line);
    if (sec) { current = sec[1].trim(); continue; }
    if (isComment(line) || !same(current, section)) continue;
    const m = ENTRY.exec(line);
    if (m && m[2] === '' && same(m[3], key)) return m[5];
  }
  return null;
}

// ---- lists ----
//
// An Unreal array is not one line, it is a directive followed by members:
//
//   !DefaultReservedPlayerIds=ClearArray      empty it
//   .DefaultReservedPlayerIds=76561198...     one member
//   .DefaultReservedPlayerIds=76561198...     another
//
// So "change the value of the list" is not a thing, which is why
// setConfigValue refuses these lines outright. Adding a member is an INSERT and
// removing one is a DELETE, and both have to leave the rest of the document
// alone just as carefully.

/** Every member of one list, in document order. */
export function listConfigMembers(text, { section, key } = {}) {
  const out = [];
  let current = '';
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const sec = SECTION.exec(line);
    if (sec) { current = sec[1].trim(); continue; }
    if (isComment(line) || !same(current, section)) continue;
    const m = ENTRY.exec(line);
    if (m && m[2] === '.' && same(m[3], key)) out.push(m[5]);
  }
  return out;
}

/**
 * Add or remove one member of a list.
 *
 * @param {'add'|'remove'} action
 * @param {{section, key, value, action, max}} opts  `max` caps how many members
 *   the list may hold (MaxReservedSlots, say). Ignored when removing.
 * @returns {{text, changed: boolean, members: string[]}}
 * @throws {ConfigEditError}
 */
export function setConfigListMember(text, { section, key, value, action = 'add', max = null } = {}) {
  if (typeof text !== 'string' || !text) {
    throw new ConfigEditError('There is no settings document to edit.', 'no_document');
  }
  const wanted = String(value ?? '').trim();
  if (!section || !key) throw new ConfigEditError('Both a section and a key are needed.', 'bad_request');
  if (!wanted) throw new ConfigEditError('There is no value to add or remove.', 'bad_value');
  if (/[\r\n=]/.test(wanted)) {
    throw new ConfigEditError('A list entry cannot contain a line break or an equals sign.', 'bad_value');
  }

  const lines = text.split('\n');
  let current = '';
  let sectionSeen = false;
  let lastMember = -1;   // last `.Key=` line
  let directive = -1;    // the `!Key=ClearArray` line
  const members = [];

  lines.forEach((raw, i) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const sec = SECTION.exec(line);
    if (sec) { current = sec[1].trim(); if (same(current, section)) sectionSeen = true; return; }
    if (isComment(line) || !same(current, section)) return;
    const m = ENTRY.exec(line);
    if (!m || !same(m[3], key)) return;
    if (m[2] === '.') { lastMember = i; members.push({ i, value: m[5], m, cr: raw.endsWith('\r') ? '\r' : '' }); }
    else if (m[2] === '!') directive = i;
    else {
      // A plain Key=Value with this name: it is a setting, not a list, and
      // treating it as one would quietly turn a value into an array.
      throw new ConfigEditError(
        `[${section}] ${key} is an ordinary setting, not a list. Change it with a value instead.`, 'not_a_list');
    }
  });

  if (!sectionSeen) throw new ConfigEditError(`This server's settings have no [${section}] section.`, 'no_section');
  if (directive < 0 && lastMember < 0) {
    throw new ConfigEditError(
      `[${section}] has no ${key} list, so there is nothing to add to. `
      + 'Creating one that this server does not already use is not something to do blind.', 'no_list');
  }

  const values = members.map((x) => x.value);
  if (action === 'remove') {
    const hit = members.filter((x) => same(x.value, wanted));
    if (!hit.length) return { text, changed: false, members: values };
    // Several identical lines would each be a member, so all of them go.
    const drop = new Set(hit.map((x) => x.i));
    return { text: lines.filter((_, i) => !drop.has(i)).join('\n'), changed: true, members: values.filter((v) => !same(v, wanted)) };
  }

  if (values.some((v) => same(v, wanted))) return { text, changed: false, members: values };
  if (typeof max === 'number' && values.length >= max) {
    throw new ConfigEditError(
      `That list is full: ${values.length} of ${max} used. Remove one before adding another.`, 'full');
  }

  // Copy the style of a line that is already there, so the document keeps
  // looking like itself rather than half one thing and half another.
  const model = members[members.length - 1]?.m ?? (directive >= 0 ? ENTRY.exec(lines[directive].replace(/\r$/, '')) : null);
  const indent = model?.[1] ?? '';
  const eq = model?.[4] ?? '=';
  const cr = (members[members.length - 1]?.cr) ?? (lines[directive]?.endsWith('\r') ? '\r' : '');
  const at = lastMember >= 0 ? lastMember : directive;
  const next = [...lines];
  next.splice(at + 1, 0, `${indent}.${key}${eq}${wanted}${cr}`);
  return { text: next.join('\n'), changed: true, members: [...values, wanted] };
}
