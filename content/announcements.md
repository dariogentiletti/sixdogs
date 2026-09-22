// #announcements is APPEND ONLY (see APPEND_CHANNELS in bot/src/posts.js).
//
// Change anything below and the bot posts it as a NEW message on the next
// restart, leaving every earlier announcement in place as history. It never
// edits one, because an edit notifies nobody and would slide the news in above
// messages people have already read.
//
// So: this file holds the LATEST announcement only, and it should be SHORT.
// Only what changed since the last one. Anything already announced is already
// in the channel above it, and repeating it makes people stop reading these.
//
// PUT THE DATE IN THE TITLE, written by hand. A date that changes by itself
// would make the bot post again every time it restarts.

# What's new: 22 September 2026
color: gold
## There's a leaderboard now
{#leaderboard} has eight boards for the last 30 days, and they're on the website too.

Kills and K:D are there, but so are the ones you can't farm: how fast your side's score climbed while you were on the field, how much faster it climbed with you on than without you, how long you've stayed alive, and how many matches started because you put your name down in {#start-a-match} when the server was quiet.

Each board says on itself what it measures. Nothing counts against you for playing badly on a night you turned up.

footer: Questions? Ask an admin.
