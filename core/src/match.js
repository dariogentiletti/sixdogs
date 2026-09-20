// Pure logic: decide whether two consecutive /v1/status answers belong to
// different matches. The API never tells us "a match started", so we infer it.
//
// Signals, in order of confidence:
//   1. The map changed.
//   2. rotation.nowIndex changed.
//   3. The match clock (matchSeconds) reset.
//   4. Faction scores dropped back to zero.
//
// NOTE: the public schema doesn't document whether matchSeconds counts up
// (elapsed) or down (remaining), nor the name of the score field inside
// factionScores[]. We learn the clock direction from the data, and look for a
// numeric score under a few plausible names. Check a real /v1/status once
// your server is up and tighten this if needed (see docs/wardogs-rcon.md).

const RESET_SLACK_SEC = 30;

export function factionScoreTotal(status) {
  const rows = Array.isArray(status?.factionScores) ? status.factionScores : [];
  let total = 0;
  let found = false;
  for (const row of rows) {
    for (const key of ['score', 'points', 'value', 'tickets']) {
      if (typeof row?.[key] === 'number') {
        total += row[key];
        found = true;
        break;
      }
    }
  }
  return found ? total : null;
}

/**
 * Tracks the clock direction across polls.
 * direction: 'up' | 'down' | null (unknown yet)
 */
export function inferClockDirection(prevSec, currSec, elapsedSec, current = null) {
  if (typeof prevSec !== 'number' || typeof currSec !== 'number' || elapsedSec <= 0) return current;
  const delta = currSec - prevSec;
  if (delta === 0) return current; // paused / pre-match
  const tol = Math.max(2, elapsedSec * 0.5);
  if (Math.abs(delta - elapsedSec) <= tol) return 'up';
  if (Math.abs(delta + elapsedSec) <= tol) return 'down';
  return current;
}

/**
 * @returns {string|null} reason a new match started, or null if same match.
 */
export function detectNewMatch(prev, curr, { clockDirection = null } = {}) {
  if (!prev) return 'first-sample';
  if (!curr) return null;

  if (prev.map && curr.map && prev.map !== curr.map) return `map changed ${prev.map} -> ${curr.map}`;

  const pi = prev.rotation?.nowIndex;
  const ci = curr.rotation?.nowIndex;
  if (typeof pi === 'number' && typeof ci === 'number' && pi !== ci) return `rotation index ${pi} -> ${ci}`;

  const ps = prev.matchSeconds;
  const cs = curr.matchSeconds;
  if (typeof ps === 'number' && typeof cs === 'number') {
    if (clockDirection === 'down') {
      if (cs > ps + RESET_SLACK_SEC) return `clock reset ${ps}s -> ${cs}s`;
    } else if (cs < ps - Math.min(RESET_SLACK_SEC, Math.max(5, ps / 2))) {
      return `clock reset ${ps}s -> ${cs}s`;
    }
  }

  const pScore = factionScoreTotal(prev);
  const cScore = factionScoreTotal(curr);
  if (pScore !== null && cScore !== null && pScore > 0 && cScore === 0) return 'faction scores reset to zero';

  return null;
}
