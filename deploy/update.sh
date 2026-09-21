#!/usr/bin/env bash
# Pulls the latest SIXDOGS from GitHub and restarts the bot if anything changed.
# Run every 2 minutes by sixdogs-update.timer. You should never need to run this
# by hand, but it is safe to: it does nothing when there is nothing new.
#
# It only records success at the very end, so if the network drops or an install
# fails, nothing is marked as done and the next run tries the whole thing again.
#
# Everything lives inside main() on purpose. An update can change this very file
# while it is running, and bash reads a script as it goes. Wrapping the body in a
# function makes bash parse all of it up front, so a half-old, half-new script
# can never run.

set -euo pipefail

main() {
  local repo_dir=/opt/sixdogs
  local branch=main
  local run_as=sixdogs
  local marker current target

  marker="$repo_dir/.deployed"
  cd "$repo_dir"

  git fetch --quiet origin "$branch"
  target=$(git rev-parse "origin/$branch")
  current=$(cat "$marker" 2>/dev/null || echo none)

  if [ "$current" = "$target" ]; then
    return 0
  fi

  echo "updating to ${target:0:8} (from ${current:0:8})"

  # Match GitHub exactly. This throws away edits made on the server on purpose:
  # GitHub is the source of truth. Your .env, data/ and node_modules are
  # untracked, so they are left alone.
  git reset --hard --quiet "origin/$branch"

  local dir
  for dir in core bot; do
    ( cd "$dir" && npm install --omit=dev --no-audit --no-fund --silent )
  done

  # npm and git ran as root, so hand the files back to the bot's own user.
  chown -R "$run_as:$run_as" "$repo_dir"

  systemctl restart sixdogs

  echo "$target" > "$marker"
  chown "$run_as:$run_as" "$marker"
  echo "restarted on ${target:0:8}"
}

main "$@"
