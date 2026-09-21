// Does the core loop actually work? Join -> /verify -> Verified role -> team
// role -> offered command -> commander role.
//
// Every link in that chain already fails safely, which is the problem: a role
// the bot cannot hand out throws, gets caught, and goes to the console where
// nobody is looking. The owner sees a friend join and nothing happen, with no
// way to tell which step gave up. This checks each link and says so in words.
//
// The checks are pure. What they need from Discord is gathered by the caller,
// so the interesting cases (a role above the bot's own, a missing role) can be
// tested without a server.

import { FACTIONS } from './factions.js';
import { CLASS_ROLE_NAMES, SEED_PING_ROLE_NAME } from './rolemenu.js';

/**
 * The roles the BOT ITSELF hands out, and what breaks when it can't.
 * Roles given by hand (Admin, Moderator, ★ Supporter) are not here: the bot
 * never touches them, so its position relative to them does not matter.
 */
export function assignedRoles({ verifiedRoleName = 'Verified', commanderPoolRoleName = 'Commander Pool' } = {}) {
  return [
    { name: verifiedRoleName, breaks: 'nobody who verifies gets in' },
    ...FACTIONS.map((f) => ({ name: f.roleName, breaks: `${f.label} players never get their team role or their listen channel` })),
    ...FACTIONS.map((f) => ({ name: f.commanderRoleName, breaks: `the ${f.label} commander can't talk to their team` })),
    { name: SEED_PING_ROLE_NAME, breaks: 'nobody can opt in to match pings' },
    ...CLASS_ROLE_NAMES.map((name) => ({ name, breaks: `${name} can't be picked in #roles` })),
    // The pool is self-assigned in #roles like a class role.
    { name: commanderPoolRoleName, breaks: "nobody can join the commander pool" },
  ];
}

/**
 * Can the bot actually give each role out?
 *
 * Discord refuses to let anyone, bot included, hand out a role positioned at or
 * above their own highest. It is the commonest reason a bot "does nothing", and
 * it is invisible: the call throws a permission error long after setup looked
 * like it worked. Someone dragging the bot's role down, or dragging a role up,
 * is enough.
 *
 * @param {{name, breaks}[]} required
 * @param {Map<string, {position:number}>} roles  by name
 * @param {number} botTop  position of the bot's highest role
 * @param {boolean} canManageRoles
 */
export function roleHealth({ required, roles, botTop, canManageRoles = true }) {
  return required.map((r) => {
    const role = roles.get(r.name);
    if (!role) return { ...r, ok: false, why: 'missing', fix: 'Run /setup-server to create it.' };
    if (!canManageRoles) {
      return { ...r, ok: false, why: 'no permission', fix: 'Give the bot the Manage Roles permission.' };
    }
    if (role.position >= botTop) {
      return {
        ...r, ok: false, why: 'above the bot',
        fix: `Drag the bot's own role ABOVE "${r.name}" in Server Settings -> Roles.`,
      };
    }
    return { ...r, ok: true };
  });
}

/**
 * What the game server and the links say about the people on it right now.
 * This is the answer to "my friend joined and nothing happened": if they are
 * on the server but not linked, every later step is correctly doing nothing.
 */
export function playerHealth({ players = [], members = new Set() } = {}) {
  return players.map((p) => ({
    name: p.name,
    steamId: String(p.steamId),
    linked: Boolean(p.discordId),
    discordId: p.discordId ?? null,
    // Linked to a Discord account that has since left the server.
    gone: Boolean(p.discordId) && !members.has(p.discordId),
    faction: p.faction ?? null,
  }));
}

const tick = (ok) => (ok ? '✅' : '❌');

/** The whole thing as a Discord message. Pure, so the wording is testable. */
export function healthReport({ core, roles, players, actions, verifiedRoleName = 'Verified' }) {
  const lines = ['**Can a new player actually get set up?**', ''];

  lines.push(`${tick(core.ok)} **Core service** — ${core.ok ? 'reachable' : core.error ?? 'not answering'}`);
  lines.push(`${tick(core.serverOk)} **Game server** — ${core.serverOk
    ? `connected, ${players.length} player${players.length === 1 ? '' : 's'} on`
    : "not answering, so /verify can't see anyone"}`);
  lines.push(`${tick(actions.message)} **Private messages in game** — ${actions.message
    ? 'supported, so verification codes can be sent'
    : 'NOT supported by this server build, so /verify cannot work at all'}`);

  const broken = roles.filter((r) => !r.ok);
  lines.push('', `${tick(!broken.length)} **Roles the bot hands out** — `
    + (broken.length ? `${broken.length} of ${roles.length} are a problem` : `all ${roles.length} fine`));
  for (const r of broken) lines.push(`• **${r.name}**: ${r.why}. ${r.breaks}.\n  ${r.fix}`);

  if (players.length) {
    const unlinked = players.filter((p) => !p.linked);
    lines.push('', `${tick(!unlinked.length)} **People on the server right now**`);
    for (const p of players) {
      lines.push(`• ${p.name} — ${p.linked
        ? (p.gone ? `linked to someone who has left this Discord (${p.discordId})` : `linked to <@${p.discordId}>`)
        : 'NOT linked. They need to run `/verify` in Discord while in game.'}`);
    }
  } else if (core.serverOk) {
    lines.push('', 'ℹ️ Nobody is on the game server, so there is nothing to check against a real player. '
      + 'Ask someone to join and run this again.');
  }

  const bad = !core.ok || !core.serverOk || !actions.message || broken.length;
  lines.push('', bad
    ? '**Fix the ❌ lines above and run this again.**'
    : `**Everything a new player needs is working.** Joining, \`/verify\`, the ${verifiedRoleName} role, team roles and commander offers.`);
  return lines.join('\n');
}
