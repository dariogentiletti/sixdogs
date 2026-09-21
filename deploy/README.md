# Putting SIXDOGS on a server (so it runs 24/7)

This folder makes the bot run on a rented Linux server instead of your PC. Once it's
done, the bot starts by itself when the server boots, restarts itself if it crashes,
and picks up changes from GitHub on its own within about 2 minutes.

You do the steps below **once**. After that you don't touch the server again: you tell
Claude what to change, Claude pushes it to GitHub, and the server takes it from there.

---

## 1. Rent the server

Any provider works. Ask for **Ubuntu 24.04 LTS** and at least **2 GB of memory**
(SIXDOGS uses about 800 MB, and 1 GB machines run out and get killed).

Suggested: Vultr, Chicago or Dallas, the 2 GB plan. That's the same part of the US as
the WARDOGS server.

You'll get an IP address, a username (usually `root`) and a password or SSH key.

## 2. Connect to it

On Windows, open PowerShell and type this, using your own IP address:

```
ssh root@YOUR.SERVER.IP
```

Say `yes` when it asks about the fingerprint, then enter your password.

## 3. Run the installer

Paste this one line and press Enter:

```
curl -fsSL https://raw.githubusercontent.com/dariogentiletti/sixdogs/main/deploy/setup.sh | bash
```

It installs Node.js, downloads SIXDOGS, and sets up the two background services.
Takes a couple of minutes. It's safe to run again later if anything goes wrong.

## 4. Add your Discord token

```
nano /opt/sixdogs/.env
```

Fill in `DISCORD_TOKEN` and `DISCORD_GUILD_ID`. Leave everything else as it is.
Save with **Ctrl+O**, **Enter**, then **Ctrl+X**.

## 5. Start it

```
systemctl enable --now sixdogs
```

Then watch it start up:

```
journalctl -u sixdogs -f
```

You want to see `registered 13 slash commands`. Press **Ctrl+C** to stop watching.
That stops the watching, not the bot.

You can close PowerShell now. The bot keeps running.

---

## Adding the game server later

When xREALM gives you the RCON address and password:

```
nano /opt/sixdogs/.env
```

Replace the `RCON_URL` and `RCON_PASSWORD` lines with the real ones, save, then:

```
systemctl restart sixdogs
journalctl -u sixdogs -f
```

You want `connected to WARDOGS RCON`. That switches on `/verify`, faction roles,
commander picks and the live board.

`.env` is the one file that only exists on the server. It holds your passwords, so it
is deliberately kept out of GitHub. It's also the one thing Claude can't change for
you, because Claude can't reach this machine.

---

## How updates work now

You ask Claude for a change. Claude pushes it to GitHub's `main` branch. Within about
2 minutes the server notices, downloads it, and restarts the bot.

Nothing for you to do. If you want to see it happen:

```
journalctl -u sixdogs-update -f
```

If an update fails halfway (network drops, a bad download), nothing is marked as done
and it simply tries again 2 minutes later. The bot keeps running the old version in
the meantime.

## Commands worth knowing

| What you want | Type this |
|---|---|
| Is it running? | `systemctl status sixdogs` |
| Watch what it's doing | `journalctl -u sixdogs -f` |
| Last 100 lines | `journalctl -u sixdogs -n 100` |
| Restart it | `systemctl restart sixdogs` |
| Stop it | `systemctl stop sixdogs` |
| Start it again | `systemctl start sixdogs` |
| Force an update now | `systemctl start sixdogs-update` |
| Did updates run? | `systemctl list-timers sixdogs-update` |

## If something looks wrong

`journalctl -u sixdogs -n 100` shows what the bot said. Copy that to Claude and
describe what you expected. That output is almost always enough to find the problem.

## What's installed where

| | |
|---|---|
| The code | `/opt/sixdogs` (a checkout of GitHub `main`) |
| Your settings | `/opt/sixdogs/.env` (never in GitHub) |
| The database | `/opt/sixdogs/data` |
| Runs as | the `sixdogs` user, which cannot log in |
| Services | `sixdogs` (the bot), `sixdogs-update` (the updater, every 2 min) |
