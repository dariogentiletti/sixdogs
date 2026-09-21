# Putting SIXDOGS on Railway

Railway runs the bot for you. There is no server to log into, no SSH, and no
commands to remember. Your settings are a web form, the logs are a web page, and
every time Claude pushes a change it redeploys by itself.

Do this once. After that you only ever talk to Claude.

---

## 1. Make the account

Go to **railway.com**, sign up with your GitHub account, and take the **Hobby**
plan ($5/month, which includes $5 of usage).

## 2. Create the project

**New Project** → **Deploy from GitHub repo** → pick **sixdogs**.

Railway starts building straight away. **It will fail this first time.** That is
expected: it does not have your Discord token yet. Carry on.

## 3. Add the database

In the same project: **New** (or the **+** button) → **Database** → **Add
PostgreSQL**.

That is the whole database setup. Railway creates it and hands the bot a
`DATABASE_URL` by itself, which is the one setting you do not have to type.

## 4. Add your settings

Click the **sixdogs** service (not the database) → **Variables** tab → **New
Variable**, and add these two:

| Name | Value |
|---|---|
| `DISCORD_TOKEN` | Developer Portal → your app → Bot → Reset Token |
| `DISCORD_GUILD_ID` | right-click your Discord server icon → Copy Server ID |

(For the server ID you need Developer Mode on: Discord Settings → Advanced →
Developer Mode.)

Then link the database. Still on **Variables**, add one more:

| Name | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |

Type that exactly, curly brackets and all. Railway replaces it with the real
address. This keeps the traffic on Railway's private network.

## 5. Let it start

Railway redeploys on its own when you add variables. Open the **Deployments**
tab and watch the log.

You want to see `registered 20 slash commands`.

That is it. The bot is live and stays live.

---

## Adding the game server later

When xREALM gives you the RCON details, go back to **Variables** and add:

| Name | Value |
|---|---|
| `RCON_URL` | `http://their.address:7776` (keep `http://`, not `https://`) |
| `RCON_PASSWORD` | the RCON password they give you |

Railway restarts the bot by itself. In the logs you want
`connected to WARDOGS RCON`.

That switches on `/verify`, faction roles, commander picks and the live board.
Until then the bot runs the Discord side only, which is fine.

## How changes reach it

Claude pushes to GitHub `main`. Railway notices and redeploys, usually inside a
minute. Nothing for you to do.

Restarting mid-match is safe: the running match keeps its identity, everyone
keeps their team role, and the commanders stay in the chair.

## Things worth knowing

**Your variables are not in GitHub.** They live in Railway. The repo is public,
so passwords must never go in it. Claude cannot read or change your Railway
variables, so anything involving a password is something you paste in yourself.

**Watch the bill for the first week.** Railway charges by what you use, unlike a
flat monthly server. This should land around $9-13/month. The **Usage** page
shows the running total. If it climbs past that, tell Claude and something is
wrong.

**Don't enable sleeping.** If you ever see an option to have the service sleep
when idle, leave it off. A Discord bot has to hold its connection open the whole
time.

## When something looks wrong

Open the service → **Deployments** → click the running one → read the log.
Copy what it says to Claude along with what you expected to happen. That output
is almost always enough.

Useful buttons on the service page: **Restart** (re-runs the bot) and
**Redeploy** (rebuilds it from scratch).

