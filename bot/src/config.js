// Settings from environment variables (see ../../.env.example).
// Community facts (web address, donation link, ...) come from ../../community.json.
import { loadFacts } from '../../tools/facts.mjs';

function facts() {
  try { return loadFacts(); } catch (err) {
    console.warn(`[config] couldn't read community.json: ${err.message}`);
    return {};
  }
}

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[config] Missing required environment variable ${name}. See .env.example.`);
    process.exit(1);
  }
  return v;
}
const num = (name, fallback) => {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : Number(v);
};
const str = (name, fallback) => process.env[name] || fallback;

export function loadConfig() {
  const f = facts();
  return {
    discordToken: required('DISCORD_TOKEN'),
    guildId: required('DISCORD_GUILD_ID'),
    coreUrl: str('CORE_URL', 'http://core:8080').replace(/\/+$/, ''),
    // Discord-only mode (no game server configured yet): no core, no game features.
    coreDisabled: process.env.CORE_DISABLED === '1',
    internalToken: process.env.CORE_DISABLED === '1' ? '' : required('INTERNAL_TOKEN'),
    syncIntervalMs: Math.max(3000, num('SYNC_INTERVAL_MS', 5000)),
    leaveGraceSec: num('LEAVE_GRACE_SEC', 60),
    outageClearMin: Math.max(1, num('OUTAGE_CLEAR_MIN', 10)),
    commanderDelaySec: num('COMMANDER_DELAY_SEC', 90),
    commanderAcceptSec: num('COMMANDER_ACCEPT_SEC', 60),
    commanderAwaySec: num('COMMANDER_AWAY_SEC', 300),
    botName: str('BOT_NAME', 'SIXDOGS'),
    logChannelName: str('LOG_CHANNEL_NAME', 'admin-log'),
    commanderPoolRoleName: str('COMMANDER_POOL_ROLE_NAME', 'Commander Pool'),
    verifiedRoleName: str('VERIFIED_ROLE_NAME', 'Verified'),
    rolesChannelName: str('ROLES_CHANNEL_NAME', 'roles'),
    // Post-match commander ratings.
    ratingMinServeMin: num('RATING_MIN_SERVE_MIN', 5),   // commanded at least this long to be rated
    ratingMinPlayMin: num('RATING_MIN_PLAY_MIN', 5),     // played on that faction this long to vote
    ratingVoteMinutes: num('RATING_VOTE_MINUTES', 30),   // must match core (same .env)
    ratingMaxPerFaction: num('RATING_MAX_PER_FACTION', 3), // most commanders rated per faction per match
    ratingWindowDays: num('RATING_WINDOW_DAYS', 60),
    // Scheduled ops (OPERATIONS channels + Operator role). Off while this is a 24/7 server.
    operationsEnabled: process.env.OPERATIONS_ENABLED === 'true',
    // Live board in #server-info.
    liveBoardChannel: 'server-info',
    liveBoardMinutes: Math.max(1, num('LIVE_BOARD_MINUTES', 5)),
    joinUrl: str('JOIN_URL', ''),            // button link; default is the WARDOGS Steam page
    gameServerId: str('GAME_SERVER_ID', ''), // what players type in "Join by ID"; default: RCON /v1/server-id
    // Website live status (optional): the bot sends a public summary to a Cloudflare Worker.
    statusPushUrl: str('STATUS_PUSH_URL', ''),
    statusPushToken: str('STATUS_PUSH_TOKEN', ''),
    statusPushMinutes: Math.max(2, num('STATUS_PUSH_MINUTES', 2)),
    // Optional JSON: {"blue":["Team 1"], ...} — extra in-game faction strings per colour. Rarely needed:
    // factions are recognised by their colour in /v1/status, or by name (Lonestar/Valkyra/Manticore).
    factionAliases: process.env.FACTION_ALIASES ? JSON.parse(process.env.FACTION_ALIASES) : {},
  };
}
