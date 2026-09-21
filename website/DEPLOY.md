# Putting sixdogs.gg online (Cloudflare Pages + GitHub)

The website lives in this folder. It's plain HTML, hosted free on Cloudflare Pages.

**How updating works now:** you tell Claude what to change. Claude edits the project, pushes it
to GitHub, and Cloudflare notices the push, rebuilds the page and publishes it, usually within a
minute. You don't build or upload anything.

The steps below are the one-time setup. After that, ignore this file.

## 1. Move sixdogs.gg's DNS to Cloudflare
Cloudflare can only serve sixdogs.gg if Cloudflare runs the domain's DNS. The domain stays at
Namecheap; only the nameservers change.

1. Cloudflare dashboard → **Add a domain** → `sixdogs.gg` → **Free** plan.
2. Cloudflare copies your current DNS records. Delete the ones for `sixdogs.gg` and `www` that
   come from Namecheap's parking or redirect (A records like 192.64.119.x, or a CNAME to
   parkingpage.namecheap.com). Pages adds the right ones in step 3.
3. Cloudflare shows two nameservers, like `ada.ns.cloudflare.com` and `bob.ns.cloudflare.com`.
4. Namecheap → Domain List → **Manage** (sixdogs.gg) → **Nameservers** → **Custom DNS**, paste
   the two Cloudflare nameservers, save with the green tick.
5. Wait. Often under an hour, sometimes up to 24. Cloudflare emails you when it says **Active**.

From now on, DNS changes happen in Cloudflare, not Namecheap.

## 2. Connect the GitHub repo to Cloudflare Pages
1. Cloudflare → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
2. Authorise Cloudflare on GitHub and pick the **sixdogs** repository.
3. Settings:
   - Production branch: `main`
   - Framework preset: **None**
   - Build command: `node tools/build.mjs`
   - Build output directory: `website`
4. **Save and Deploy**. The first build takes a minute. It goes live at `sixdogs.pages.dev`.

(If you already made a Pages project by dragging files in, make this new one anyway and move the
custom domain over in step 3. A drag-and-drop project can't be switched to GitHub.)

## 3. Connect sixdogs.gg
In the Pages project → **Custom domains** → **Set up a domain**:
1. `sixdogs.gg` → Continue → Activate domain.
2. Again for `www.sixdogs.gg`.

Cloudflare makes the DNS records and the HTTPS certificate itself.

## 4. Live server status (optional)
The "On the server now" section shows what `#server-info` shows in Discord. Your bot sends a
small public summary to a Cloudflare Worker every 2 minutes, and the website reads it from there.

1. ~~Create the KV namespace.~~ **Already done**: `sixdogs-live`, id
   `6215eeaf827f4ba8be91f231f2b06e00`. Skip to step 2.
2. **Workers & Pages** → **Create application** → **Worker** → name `sixdogs-live` → **Deploy**.
3. **Edit code**, delete what's there, paste all of `cloudflare/live-worker.js`, **Deploy**.
4. Worker → **Settings** → **Bindings** → **Add** → **KV namespace**: variable name `STATUS`,
   namespace `sixdogs-live`.
5. **Settings** → **Variables and Secrets** → **Add** → type **Secret**, name `PUSH_TOKEN`,
   value: a long random password you make up (30+ letters and numbers). Keep a copy.
6. **Settings** → **Domains & Routes** → **Add** → **Custom domain** → `live.sixdogs.gg`.
7. Open https://live.sixdogs.gg/status. You should see `{"v":1,"state":"unknown"}`.
8. Add two variables to the bot on Railway (service → **Variables**):
   ```
   STATUS_PUSH_URL=https://live.sixdogs.gg/status
   STATUS_PUSH_TOKEN=the same password as step 5
   ```
   Railway restarts the bot itself. The section appears on sixdogs.gg within 2 minutes, and
   hides itself again 10 minutes after the bot stops.

## What the site serves
- `sixdogs.gg` → the website
- `sixdogs.gg/discord` and `/join` → your Discord invite
- `sixdogs.gg/donate` → your donation page, once `donate.url` in `community.json` has a link

## If Claude isn't around
`node tools/build.mjs` rebuilds `index.html` and `_redirects` from `community.json`, and
Cloudflare also accepts a manual upload: Pages project → **Create a new deployment** → drag the
`website` folder in. You shouldn't need either.
