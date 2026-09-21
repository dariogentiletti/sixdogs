import { fileURLToPath } from 'node:url';

// All settings come from environment variables (see ../../.env.example).

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[config] Missing required environment variable ${name}. See .env.example.`);
    process.exit(1);
  }
  return v;
}

const str = (name, fallback) => process.env[name] || fallback;

function num(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    console.error(`[config] ${name} must be a number, got "${v}"`);
    process.exit(1);
  }
  return n;
}

let rconUrl = required('RCON_URL').trim().replace(/\/+$/, '');
// The WARDOGS RCON listener is plain HTTP. An https:// URL will simply fail, so
// refuse it loudly instead of "fixing" it silently.
if (rconUrl.startsWith('https://')) {
  console.error('[config] RCON_URL must start with http:// — the WARDOGS RCON listener does not speak HTTPS.');
  process.exit(1);
}
if (!rconUrl.startsWith('http://')) rconUrl = `http://${rconUrl}`;

export const config = {
  rconUrl,
  rconPassword: required('RCON_PASSWORD'),
  databaseUrl: process.env.DATABASE_URL || null, // unset = built-in database
  dataDir: process.env.DATA_DIR || fileURLToPath(new URL('../../data', import.meta.url)),
  internalToken: required('INTERNAL_TOKEN'),
  port: num('CORE_PORT', 8080),
  pollIntervalMs: Math.max(3000, num('POLL_INTERVAL_MS', 5000)), // never faster than 3s
  slowPollIntervalMs: num('SLOW_POLL_INTERVAL_MS', 10000),
  healthCheckEveryMs: num('HEALTH_CHECK_EVERY_MS', 60000),
  backpressureDepth: num('BACKPRESSURE_QUEUE_DEPTH', 5),
  sampleRetentionDays: num('SAMPLE_RETENTION_DAYS', 14),
  verifyCodeTtlSec: num('VERIFY_CODE_TTL_SEC', 600),
  verifyCodeDigits: num('VERIFY_CODE_DIGITS', 3), // shorter is friendlier to type; see MAX_ATTEMPTS in verify.js
  ratingWindowDays: num('RATING_WINDOW_DAYS', 60),
  // Seeding: pledges in Discord that add up to a "come and play" ping.
  // How many people have to want in before a match can actually start.
  seedTarget: Math.max(2, num('SEED_TARGET', 45)),
  // The list crossing this gets one message to the role, to recruit the rest.
  seedNudgeAt: Math.max(1, num('SEED_NUDGE_AT', 10)),
  // How long a name stays on the list. Long on purpose: collecting 45 clicks
  // takes a while, and a short window means the target is never reached.
  seedPledgeMinutes: Math.max(5, num('SEED_PLEDGE_MINUTES', 180)),
  seedCooldownMinutes: Math.max(3, num('SEED_COOLDOWN_MINUTES', 45)),
  // Where the game server keeps its own match-start threshold. Seeding reads
  // this rather than keeping a second copy, so the two can never disagree.
  // Read off the live server; see docs/wardogs-rcon.md.
  matchStartSection: str('MATCH_START_SECTION', 'MatchState.PreMatch.WaitingForPlayers.PlayerCount'),
  matchStartKey: str('MATCH_START_KEY', 'MinimumRequiredPlayers'),
  // Reserved slots live in the settings document, not behind a writable route.
  // These names were read off the live server (docs/wardogs-rcon.md); they are
  // settings so a different build can be pointed at the right place.
  reservedSection: str('RESERVED_SECTION', '/Script/WDGame.WDGameSession'),
  reservedKey: str('RESERVED_KEY', 'DefaultReservedPlayerIds'),
  reservedCapKey: str('RESERVED_CAP_KEY', 'MaxReservedSlots'),
  ratingVoteMinutes: num('RATING_VOTE_MINUTES', 30),
  requestTimeoutMs: num('RCON_TIMEOUT_MS', 4000),
};
