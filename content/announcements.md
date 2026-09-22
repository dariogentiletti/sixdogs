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
Two changes.

## #general is open to everyone now
You don't have to be verified to talk in there. Links, files and screenshots still need the **Verified** role, so `/verify` is worth doing.

## Matches start at 45 players
Three full teams of 15, each with a commander. If the server is quiet, put your name down in {#start-a-match} instead of waiting in an empty match.

footer: Questions? Ask an admin.
