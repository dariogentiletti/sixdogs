// The "Verified" role: held by exactly the members who have linked their Steam
// account (/confirm, or an admin's /link). The link itself lives in core's
// database; this keeps the Discord role in step with it.

import { VERIFIED_COLOR } from './setup.js';

/** Who should gain / lose the role, given current holders and linked IDs. Pure. */
export function planVerified({ holders, linked, members }) {
  const add = [...linked].filter((id) => members.has(id) && !holders.has(id));
  const remove = [...holders].filter((id) => !linked.has(id));
  return { add, remove };
}

export class VerifiedRole {
  constructor({ roleName, onError = null }) {
    this.roleName = roleName;
    this.guild = null;
    // async (text) => void, so a failure reaches #admin-log instead of a log file.
    this.onError = onError;
  }

  attach(guild) { this.guild = guild; }

  role() {
    return this.guild?.roles.cache.find((r) => r.name === this.roleName) ?? null;
  }

  /** Create the role if the server doesn't have it yet (no need to re-run /setup-server). */
  async ensure() {
    if (this.role()) return null;
    await this.guild.roles.create({ name: this.roleName, colors: { primaryColor: VERIFIED_COLOR }, permissions: [], reason: 'SIXDOGS: Verified role' });
    return `+ role ${this.roleName}`;
  }

  /** Give or take the role from one member. Never throws; a missing member is fine. */
  async set(discordId, on) {
    const role = this.role();
    if (!role || !this.guild) return false;
    const member = this.guild.members.cache.get(discordId) ?? await this.guild.members.fetch(discordId).catch(() => null);
    if (!member || member.roles.cache.has(role.id) === on) return false;
    try {
      if (on) await member.roles.add(role, 'SIXDOGS: linked Steam account');
      else await member.roles.remove(role, 'SIXDOGS: unlinked');
      return true;
    } catch (err) {
      const why = `couldn't ${on ? 'give' : 'remove'} ${this.roleName} for ${member.user.tag}: ${err.message}`;
      console.warn(`[verified] ${why} (is my role above it?)`);
      // Someone who just verified and got no role is the most visible failure
      // there is, so it goes where an admin will see it rather than the console.
      await this.onError?.(`❌ ${why}\nMost likely my own role sits below **${this.roleName}**. `
        + 'Server Settings -> Roles, drag mine above it, then run `/healthcheck`.');
      return false;
    }
  }

  /** Match the role to the list of linked members. Returns [added, removed]. */
  async reconcile(linkedIds) {
    const role = this.role();
    if (!role) return [0, 0];
    const { add, remove } = planVerified({
      holders: new Set(role.members.keys()),
      linked: new Set(linkedIds),
      members: new Set(this.guild.members.cache.keys()),
    });
    let a = 0, r = 0;
    for (const id of add) if (await this.set(id, true)) a++;
    for (const id of remove) if (await this.set(id, false)) r++;
    return [a, r];
  }
}
