// The bot's name and profile picture, applied on start.
//
//   BOT_NAME (default SIXDOGS)   -> the bot's username, and any server nickname is cleared
//   bot/assets/avatar.png        -> the profile picture
//
// Discord limits username changes to about 2 per hour, so the name is only
// changed when it differs, and the picture only when the file changed (a
// fingerprint of the last uploaded file is kept in bot/assets/.avatar-applied).

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const AVATAR = fileURLToPath(new URL('../assets/avatar.png', import.meta.url));
const APPLIED = fileURLToPath(new URL('../assets/.avatar-applied', import.meta.url));

export async function applyIdentity(client, guild, { name = 'SIXDOGS' } = {}) {
  const report = [];

  if (client.user.username !== name) {
    try {
      await client.user.setUsername(name);
      report.push(`name changed to ${name}`);
    } catch (err) {
      report.push(`! couldn't change the name yet (${err.message}). Discord allows about 2 name changes per hour; it'll try again next start.`);
    }
  }

  // A server nickname would hide the username in this server, so clear it.
  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (me?.nickname && me.nickname !== name) {
    await me.setNickname(null, 'SIXDOGS: use the bot name').then(
      () => report.push('server nickname cleared'),
      (err) => report.push(`! couldn't clear the server nickname (${err.message})`),
    );
  }

  let image = null;
  try { image = await readFile(AVATAR); } catch { /* no avatar file: leave it */ }
  if (image) {
    const hash = createHash('sha256').update(image).digest('hex');
    const last = await readFile(APPLIED, 'utf8').catch(() => '');
    if (last.trim() !== hash) {
      try {
        await client.user.setAvatar(image);
        await writeFile(APPLIED, hash).catch(() => {});
        report.push('profile picture updated');
      } catch (err) {
        report.push(`! couldn't update the profile picture (${err.message}); it'll try again next start.`);
      }
    }
  }
  return report;
}
