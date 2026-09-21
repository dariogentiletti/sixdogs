// Channel posts from the content/ folder: content/rules.md -> #rules, and so on.
// On start the bot posts each one, or edits its existing post if the file changed.
// Edits don't notify anyone, so tweaking wording is safe.

import { readdir, readFile, stat } from 'node:fs/promises';
import { loadFacts, render } from '../../tools/facts.mjs';
import { fileURLToPath } from 'node:url';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } from 'discord.js';

export const DEFAULT_CONTENT_DIR = fileURLToPath(new URL('../../content', import.meta.url));

/** Turn {#channel-name} into a clickable channel link; unknown names stay as plain #name. */
export function linkChannels(text, channelIdByName) {
  return text.replace(/\{#([a-z0-9_-]+)\}/gi, (_, name) => {
    const id = channelIdByName(name.toLowerCase());
    return id ? `<#${id}>` : `#${name}`;
  });
}

const COLORS = { gold: 0xc9a227, red: 0xd13b3b, green: 0x3aa655, blue: 0x3a7bd5, dark: 0x2b2d31 };

/**
 * A content file becomes a message of cards (Discord embeds):
 *
 *   # Card title          starts a card
 *   color: red            optional: gold, red, green, blue, dark or #hex
 *   text...               the card's main text
 *   ## Section            a section with a bold heading, full width
 *   ### Box               a small box; boxes in a row sit side by side (IP, port...)
 *   footer: small text    optional, at the bottom of the card
 *   image: guide.png      optional: a picture from the content folder, shown in the card
 *   button: Label | https://...   a link button under the message (up to 5)
 *   panel: guide-1.jpg    a picture posted as its own message, full size (one line per
 *                         picture, in order). Above the first card = posted before the cards.
 *   // anything          a note for yourself: the line is ignored
 *   ---                   next card
 *
 * {#channel} works everywhere except the footer (Discord doesn't link there).
 */
export function renderPost(text, channelIdByName) {
  // panel: lines above the first card are posted before it, the rest after it.
  const panels = [];
  let panelsBefore = 0;
  let seenCard = false;
  const src = text.replace(/\r\n/g, '\n').split('\n').filter((line) => {
    if (line.trim().startsWith('//')) return false; // a note, not part of the post
    const m = /^panel:\s*([\w.-]+\.(?:png|jpe?g|gif|webp))\s*$/i.exec(line.trim());
    if (m) { panels.push(m[1]); if (!seenCard) panelsBefore++; return false; }
    if (line.trim()) seenCard = true;
    return true;
  }).join('\n').trim();
  const cards = src.split(/\n-{3,}\s*\n/);
  const embeds = [];
  const files = [];
  const buttons = [];
  for (const raw of cards) {
    const card = { description: [], fields: [] };
    let field = null;
    for (const line of raw.split('\n')) {
      let m;
      if ((m = /^#\s+(.+)$/.exec(line)) && !card.title) { card.title = m[1].trim(); continue; }
      if ((m = /^color:\s*(\S+)\s*$/i.exec(line)) && !field && !card.description.length) {
        const c = m[1].toLowerCase();
        card.color = COLORS[c] ?? (/^#?[0-9a-f]{6}$/.test(c) ? parseInt(c.replace('#', ''), 16) : undefined);
        continue;
      }
      if ((m = /^footer:\s*(.+)$/i.exec(line))) { card.footer = m[1].trim(); continue; }
      if ((m = /^image:\s*([\w.-]+\.(?:png|jpe?g|gif|webp))\s*$/i.exec(line))) { card.image = m[1]; continue; }
      if ((m = /^button:\s*(.+?)\s*\|\s*(https?:\/\/\S+)\s*$/i.exec(line))) { buttons.push({ label: m[1], url: m[2] }); continue; }
      if ((m = /^(##|###)\s+(.+)$/.exec(line))) {
        field = { name: m[2].trim(), value: [], inline: m[1] === '###' };
        card.fields.push(field);
        continue;
      }
      (field ? field.value : card.description).push(line);
    }
    const tidy = (lines) => linkChannels(lines.join('\n').trim(), channelIdByName);
    const embed = { color: card.color ?? COLORS.dark };
    if (card.title) embed.title = card.title;
    const description = tidy(card.description);
    if (description) embed.description = description;
    const fields = card.fields.map((f) => ({ name: f.name, value: tidy(f.value) || '\u200b', inline: f.inline }));
    if (fields.length) embed.fields = fields;
    if (card.footer) embed.footer = { text: card.footer };
    if (card.image) {
      embed.image = { url: `attachment://${card.image}` };
      if (!files.includes(card.image)) files.push(card.image);
    }
    if (embed.title || embed.description || embed.fields || embed.image) embeds.push(embed);
  }
  const components = buttons.length
    ? [new ActionRowBuilder().addComponents(buttons.slice(0, 5).map((b) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(b.label.slice(0, 80)).setURL(b.url)))]
    : [];
  return { content: '', embeds, components, images: files, panels, panelsBefore, allowedMentions: { parse: [] } };
}

const baseName = (url) => (url ? String(url).split('?')[0].split('/').pop() : null);

/** What Discord gives back, reduced to what we compare (so unchanged posts aren't re-edited). */
export function signature(embeds, components = [], images = {}) {
  return JSON.stringify({
    embeds: (embeds ?? []).map((e) => {
      const d = typeof e.toJSON === 'function' ? e.toJSON() : e;
      return {
        title: d.title ?? null, description: d.description ?? null, color: d.color ?? null,
        footer: d.footer?.text ?? null,
        fields: (d.fields ?? []).map((f) => [f.name, f.value, !!f.inline]),
        image: baseName(d.image?.url),
      };
    }),
    buttons: (components ?? []).flatMap((row) => {
      const r = typeof row.toJSON === 'function' ? row.toJSON() : row;
      return (r.components ?? []).map((c) => [c.label, c.url]);
    }),
    images,   // name -> size in bytes, so a re-exported picture gets re-uploaded
  });
}

/** Discord's limits, checked before sending so a too-long file gives a clear message. */
export function checkLimits(payload) {
  const problems = [];
  if (payload.embeds.length > 10) problems.push('more than 10 cards');
  let total = 0;
  payload.embeds.forEach((e, i) => {
    const n = `card ${i + 1}`;
    if ((e.title ?? '').length > 256) problems.push(`${n}: title over 256 characters`);
    if ((e.description ?? '').length > 4096) problems.push(`${n}: text over 4096 characters`);
    if ((e.fields ?? []).length > 25) problems.push(`${n}: more than 25 sections`);
    for (const f of e.fields ?? []) {
      if (f.name.length > 256) problems.push(`${n}: section title "${f.name.slice(0, 20)}..." too long`);
      if (f.value.length > 1024) problems.push(`${n}: section "${f.name}" over 1024 characters`);
    }
    total += (e.title ?? '').length + (e.description ?? '').length + (e.footer?.text ?? '').length
      + (e.fields ?? []).reduce((s, f) => s + f.name.length + f.value.length, 0);
  });
  if (total > 6000) problems.push(`all cards together are ${total} characters; Discord allows 6000`);
  return problems;
}

/**
 * Every content/*.md, with {{...}} filled from community.json (tools/facts.mjs).
 * A post whose template breaks (typo in a key) is left out and logged, so the old
 * message stays up instead of a half-filled one.
 */
export async function loadPosts(dir = DEFAULT_CONTENT_DIR, facts = undefined) {
  if (facts === undefined) {
    try { facts = loadFacts(); } catch (err) { console.warn(`[posts] couldn't read community.json: ${err.message}`); facts = null; }
  }
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const posts = [];
  for (const file of names.filter((n) => n.endsWith('.md')).sort()) {
    let text = await readFile(`${dir}/${file}`, 'utf8');
    if (text.includes('{{')) {
      try {
        if (!facts) throw new Error('community.json is missing');
        text = render(text, facts);
      } catch (err) {
        console.warn(`[posts] skipped ${file}: ${err.message}`);
        continue;
      }
    }
    posts.push({ channel: file.slice(0, -3).toLowerCase(), text });
  }
  return posts;
}

/**
 * The bot's post in a channel = all its messages there except the #roles menu, oldest first.
 * A post can be several messages: the cards, then one message per panel picture.
 */
async function findPosts(channel, botUserId, isMenu) {
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  return [...(recent?.values() ?? [])]
    .filter((m) => m.author.id === botUserId && !isMenu(m))
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

const attachmentSizes = (m) => Object.fromEntries([...(m.attachments?.values() ?? [])].map((a) => [a.name, a.size]));

export async function syncPosts(guild, { dir = DEFAULT_CONTENT_DIR, isMenu = () => false, skip = [] } = {}) {
  const report = [];
  const idByName = (name) => guild.channels.cache
    .find((c) => c.type === ChannelType.GuildText && c.name === name)?.id ?? null;
  for (const post of await loadPosts(dir)) {
    if (skip.includes(post.channel)) {
      report.push(`= #${post.channel} is a live board the bot keeps itself; content/${post.channel}.md isn't used`);
      continue;
    }
    const channel = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === post.channel);
    if (!channel) {
      report.push(`! content/${post.channel}.md: there's no #${post.channel} channel`);
      continue;
    }
    const payload = renderPost(post.text, idByName);
    if (!payload.embeds.length && !payload.panels.length) continue;
    const problems = checkLimits(payload);
    if (problems.length) {
      report.push(`! content/${post.channel}.md: ${problems.join('; ')}`);
      continue;
    }
    // Pictures come from the content folder.
    const { images, panels, panelsBefore, ...message } = payload;
    const sizes = {};
    const file = async (name) => {
      const path = `${dir}/${name}`;
      const st = await stat(path).catch(() => null);
      if (!st) return null;
      sizes[name] = st.size;
      return { attachment: path, name };
    };
    const files = [];
    const missing = [];
    for (const name of images) { const f = await file(name); if (f) files.push(f); else missing.push(name); }
    const panelFiles = [];
    for (const name of panels) { const f = await file(name); if (f) panelFiles.push(f); else missing.push(name); }
    if (missing.length) {
      report.push(`! content/${post.channel}.md: picture ${missing.map((n) => `content/${n}`).join(', ')} not found`);
      continue;
    }

    // The messages this post should be, in order.
    const panelMsgs = panelFiles.map((f) => ({
      payload: { content: '', embeds: [], components: [], files: [f], allowedMentions: { parse: [] } },
      sig: signature([], [], { [f.name]: sizes[f.name] }),
    }));
    const wanted = panelMsgs.slice(0, panelsBefore);
    if (message.embeds.length) {
      wanted.push({
        payload: { ...message, files },
        sig: signature(message.embeds, message.components, Object.fromEntries(images.map((n) => [n, sizes[n]]))),
      });
    }
    wanted.push(...panelMsgs.slice(panelsBefore));

    let existing = await findPosts(channel, guild.client.user.id, isMenu);
    // Fewer messages than before (e.g. a card was removed): drop the extras at the end, edit the rest.
    let trimmed = 0;
    if (existing.length > wanted.length) {
      for (const m of existing.slice(wanted.length)) { await m.delete().catch(() => {}); trimmed++; }
      existing = existing.slice(0, wanted.length);
    }
    if (existing.length === wanted.length) {
      let changed = 0;
      for (let i = 0; i < wanted.length; i++) {
        const m = existing[i];
        const theirs = signature(m.embeds, m.components, attachmentSizes(m));
        if (m.content || theirs !== wanted[i].sig) {
          await m.edit({ ...wanted[i].payload, attachments: [] });
          changed++;
        }
      }
      report.push(changed || trimmed ? `~ #${post.channel} post updated` : `= #${post.channel} post up to date`);
    } else {
      // Different number of messages: pictures can't be inserted in the middle, so post it again.
      for (const m of existing) await m.delete().catch(() => {});
      for (const w of wanted) await channel.send(w.payload);
      report.push(existing.length
        ? `~ #${post.channel} posted again (${wanted.length} message${wanted.length === 1 ? '' : 's'})`
        : `+ posted in #${post.channel}`);
    }
  }
  return report;
}
