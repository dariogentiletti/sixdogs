// Pure logic for faction role sync: given who's on the server right now, which
// faction role should each Discord member hold? Faction roles are owned by the
// bot: anyone holding one gets tracked, linked or not.
//
//  - On the server with a faction      -> that faction (switches happen immediately)
//  - Gone / unassigned for < grace      -> keep their last faction (crash-and-rejoin safe)
//  - Gone / unassigned for >= grace     -> no faction role

export class FactionTracker {
  constructor({ graceMs }) {
    this.graceMs = graceMs;
    this.seen = new Map(); // discordId -> { faction, lastSeenAt }
  }

  /** Remember someone who already holds a role (used at bot startup). */
  seed(discordId, faction, now) {
    if (!this.seen.has(discordId)) this.seen.set(discordId, { faction, lastSeenAt: now });
  }

  /**
   * @param {{discordId: string, factionKey: string|null}[]} online  linked players on the server now
   * @returns {Map<string, string|null>} desired faction per affected discordId
   */
  update(online, now) {
    const desired = new Map();
    const refreshed = new Set();
    for (const p of online) {
      if (!p.discordId || !p.factionKey) continue;
      this.seen.set(p.discordId, { faction: p.factionKey, lastSeenAt: now });
      desired.set(p.discordId, p.factionKey);
      refreshed.add(p.discordId);
    }
    for (const [id, entry] of this.seen) {
      if (refreshed.has(id)) continue;
      if (now - entry.lastSeenAt >= this.graceMs) {
        desired.set(id, null);
        this.seen.delete(id);
      } else {
        desired.set(id, entry.faction);
      }
    }
    return desired;
  }

  /** Is this member being tracked? */
  has(discordId) {
    return this.seen.has(discordId);
  }

  /**
   * A match just ended: anyone who isn't on the server at all loses their
   * faction on the next update, no grace. People still connected keep theirs
   * until the server puts them on a new side.
   */
  dropAbsent(presentIds) {
    for (const [id, entry] of this.seen) {
      if (!presentIds.has(id)) entry.lastSeenAt = -Infinity;
    }
  }

  /** Forget everyone (after roles were cleared in bulk). */
  reset() {
    this.seen.clear();
  }

  factionOf(discordId) {
    return this.seen.get(discordId)?.faction ?? null;
  }
}
