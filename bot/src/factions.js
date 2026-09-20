// The three WARDOGS factions, named by colour in Discord:
//   Blue = Lonestar, Red = Valkyra, Green = Manticore.
// Change the Discord names here (or via env) if you want different ones.

const env = (k, d) => process.env[k] || d;

export const FACTIONS = [
  { key: 'blue', label: 'Blue', color: 0x3a7bd5, gameNames: ['lonestar'] },
  { key: 'red', label: 'Red', color: 0xd13b3b, gameNames: ['valkyra'] },
  { key: 'green', label: 'Green', color: 0x3aa655, gameNames: ['manticore'] },
].map((f) => {
  const U = f.key.toUpperCase();
  return {
    ...f,
    roleName: env(`${U}_ROLE_NAME`, f.label),
    commanderRoleName: env(`${U}_COMMANDER_ROLE_NAME`, `${f.label} Commander`),
    voiceChannelName: env(`${U}_VOICE_NAME`, `${f.label} Command (listen)`),
  };
});

export const FACTION_KEYS = FACTIONS.map((f) => f.key);
export const byKey = (key) => FACTIONS.find((f) => f.key === key);

/** Classify a hex colour ("#3a7bd5") as blue / red / green by hue, or null. */
export function colorKeyFromHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 0.15) return null; // grey-ish: no clear colour
  let h;
  if (max === r) h = ((g - b) / (max - min) + 6) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h *= 60;
  if (h < 40 || h >= 320) return 'red';
  if (h >= 75 && h < 165) return 'green';
  if (h >= 180 && h < 260) return 'blue';
  return null;
}

/**
 * Map the server's faction string (player.faction) to blue / red / green, or
 * null for unassigned/spectator/unknown. Tries, in order:
 *   1. FACTION_ALIASES from .env ({"blue":["Team 1"], ...})
 *   2. the colour of the matching row in /v1/status factionScores (colorHex)
 *   3. the in-game faction name (Lonestar / Valkyra / Manticore)
 *   4. a colour word in the string itself ("Blue Team")
 */
export function factionKeyFor(gameFaction, aliases = {}, factionScores = []) {
  if (gameFaction === null || gameFaction === undefined) return null;
  const s = String(gameFaction).trim().toLowerCase();
  if (!s) return null;
  for (const f of FACTIONS) {
    const extra = (aliases[f.key] ?? []).map((a) => String(a).trim().toLowerCase());
    if (extra.includes(s)) return f.key;
  }
  const row = (Array.isArray(factionScores) ? factionScores : [])
    .find((r) => String(r?.name ?? '').trim().toLowerCase() === s);
  const byColor = colorKeyFromHex(row?.colorHex);
  if (byColor) return byColor;
  for (const f of FACTIONS) {
    if (f.gameNames.some((n) => s.includes(n))) return f.key;
  }
  for (const f of FACTIONS) {
    if (s.includes(f.key)) return f.key;
  }
  return null;
}
