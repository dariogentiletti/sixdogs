// #announcements is APPEND ONLY (see APPEND_CHANNELS in bot/src/posts.js).
//
// Change anything below and the bot posts it as a NEW message on the next
// restart, leaving every earlier announcement in place as history. It never
// edits one, because an edit notifies nobody and would slide the news in above
// messages people have already read.
//
// So: this file holds the LATEST announcement only. Replace it wholesale when
// there is something new, and PUT THE DATE IN THE TITLE. Write the real date by
// hand rather than generating it: a date that changes by itself would make the
// bot post again every time it restarts.
//
// The facts in {{ }} come from community.json.

# What's new: 21 September 2026
color: gold
A few things changed this week.

## Nobody has to sit in an empty server
{#start-a-match} has an **I want to play** button on it. Click it and your name goes on the list. It stays there whether you go and warm up in the server or go and do something else.

At 10 people the list gets a shout so others can join in. At 45, which is three teams of 15, everyone gets called in and we play.

Want those pings? Take **Match Alerts** with 📣 in {#roles}. It goes to nobody else.

## Matches now start at 45 players
The server used to open a match at 20, which on a map built for a hundred is a long walk and not much else. Forty five is three full teams with a commander each.

## Verification is quicker
The code you get in game is now three digits instead of six. Same steps, less typing. If you've already linked your account you don't need to do anything.

## The server tells everyone who's commanding
When a commander is picked, the whole server sees it in game, and again every time it changes. No more guessing who to listen to.

## Supporters get their reserved slot
Chip in $10 or more and an admin can give you a reserved slot on the game server, so a full server never keeps you out. There are six. Everyone who donates gets the **★ Supporter** role.

## Where the money goes
{#support-the-community} lists every cost, not just the game server. Bot hosting, the domain and the website are all in there, with the monthly total.

## The website
**{{domain}}** shows what's happening on the server right now: score, both commanders, the top players this match and how to join. It updates by itself while a match is running.

footer: Questions? Ask an admin.
