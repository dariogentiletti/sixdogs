#!/usr/bin/env bash
# One-time SIXDOGS install on a fresh Ubuntu 24.04 server. Run it as root.
# Safe to run again later: it skips whatever is already done.
#
#   curl -fsSL https://raw.githubusercontent.com/dariogentiletti/sixdogs/main/deploy/setup.sh | bash

set -euo pipefail

REPO_URL=https://github.com/dariogentiletti/sixdogs.git
REPO_DIR=/opt/sixdogs
BRANCH=main
RUN_AS=sixdogs

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root:  sudo bash setup.sh" >&2
  exit 1
fi

echo "==> Installing git and curl"
apt-get update -qq
apt-get install -y -qq git curl ca-certificates

if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]; then
  echo "==> Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
echo "    node $(node -v)"

if ! id "$RUN_AS" >/dev/null 2>&1; then
  echo "==> Creating the $RUN_AS user"
  useradd --system --create-home --shell /usr/sbin/nologin "$RUN_AS"
fi

if [ -d "$REPO_DIR/.git" ]; then
  echo "==> Updating the existing copy in $REPO_DIR"
  git -C "$REPO_DIR" fetch --quiet origin "$BRANCH"
  git -C "$REPO_DIR" reset --hard --quiet "origin/$BRANCH"
else
  echo "==> Downloading SIXDOGS into $REPO_DIR"
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$REPO_DIR"
fi

# git runs as root here while the files belong to $RUN_AS.
git config --global --add safe.directory "$REPO_DIR"

echo "==> Installing dependencies"
for dir in core bot; do
  ( cd "$REPO_DIR/$dir" && npm install --omit=dev --no-audit --no-fund --silent )
done

if [ ! -f "$REPO_DIR/.env" ]; then
  echo "==> Creating .env from the example"
  cp "$REPO_DIR/.env.example" "$REPO_DIR/.env"
fi
chmod 600 "$REPO_DIR/.env"
chown -R "$RUN_AS:$RUN_AS" "$REPO_DIR"

echo "==> Installing the services"
install -m 644 "$REPO_DIR/deploy/sixdogs.service"        /etc/systemd/system/
install -m 644 "$REPO_DIR/deploy/sixdogs-update.service" /etc/systemd/system/
install -m 644 "$REPO_DIR/deploy/sixdogs-update.timer"   /etc/systemd/system/
systemctl daemon-reload
systemctl enable --quiet --now sixdogs-update.timer

# Remember what is installed, so the updater does not redo this same commit.
git -C "$REPO_DIR" rev-parse HEAD > "$REPO_DIR/.deployed"
chown "$RUN_AS:$RUN_AS" "$REPO_DIR/.deployed"

cat <<DONE

  Done. SIXDOGS is installed but not started yet, because it still needs
  your Discord token.

  1. Put your token and server ID in the settings file:

       nano /opt/sixdogs/.env

     Fill in DISCORD_TOKEN and DISCORD_GUILD_ID. Leave the rest alone for now.
     Save with Ctrl+O, Enter, then Ctrl+X.

  2. Start it:

       systemctl enable --now sixdogs

  3. Watch it come up:

       journalctl -u sixdogs -f

     You want "registered 13 slash commands". Press Ctrl+C to stop watching
     (that does not stop the bot).

  From now on it starts by itself on boot, restarts if it crashes, and picks
  up new versions from GitHub within about 2 minutes.

DONE
