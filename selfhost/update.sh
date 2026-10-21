#!/bin/bash
# screenpipe — AI that knows everything you've seen, said, or heard
# https://screenpipe.com
#
# Update the self-host deployment after upstream moves:
#   1. fast-forward `main` to upstream/main (main stays a pure mirror)
#   2. merge upstream/main into `deploy`
#   3. make sure the self-host patch (selfhost/self-host.patch) is applied
#   4. build and sign the release app (skip with --no-build)
#   5. with --install, copy it to $SCREENPIPE_SELFHOST_INSTALL_DIR
#      (default ~/Applications) and open it
#
# Run from the deploy worktree: selfhost/update.sh [--no-build] [--install]
set -euo pipefail

DEPLOY_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCH="$DEPLOY_ROOT/selfhost/self-host.patch"
UPSTREAM="${SCREENPIPE_UPSTREAM_REMOTE:-upstream}"
DEPLOY_BRANCH="${SCREENPIPE_DEPLOY_BRANCH:-deploy}"
INSTALL_DIR="${SCREENPIPE_SELFHOST_INSTALL_DIR:-$HOME/Applications}"
BUILD=1
INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    --install) INSTALL=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

die() { echo "selfhost/update.sh: $*" >&2; exit 1; }

cd "$DEPLOY_ROOT"
[ "$(git branch --show-current)" = "$DEPLOY_BRANCH" ] ||
  die "run this from the $DEPLOY_BRANCH worktree (current: $(git branch --show-current))"
git diff --quiet && git diff --cached --quiet ||
  die "$DEPLOY_BRANCH has uncommitted changes; commit or stash them first"

echo "==> fetching $UPSTREAM"
git fetch "$UPSTREAM" main

echo "==> main := $UPSTREAM/main"
git merge-base --is-ancestor main "$UPSTREAM/main" ||
  die "main has commits that are not upstream; main must stay a mirror. Move them to a branch first."
MAIN_WORKTREE="$(git worktree list --porcelain |
  awk '/^worktree /{w=substr($0, 10)} /^branch refs\/heads\/main$/{print w}')"
if [ -n "$MAIN_WORKTREE" ]; then
  git -C "$MAIN_WORKTREE" merge --ff-only "$UPSTREAM/main"
else
  git branch -f main "$UPSTREAM/main"
fi

echo "==> merging $UPSTREAM/main into $DEPLOY_BRANCH"
if ! git merge --no-edit "$UPSTREAM/main"; then
  die "merge conflicts: resolve them, commit, then rerun this script"
fi

echo "==> checking the self-host patch"
# Every file the patch touches carries a self-host marker once applied. This
# survives upstream edits near the patched lines, where a reverse-apply check
# would wrongly report the patch as missing.
missing=()
present=0
while IFS= read -r file; do
  if [ -f "$file" ] && grep -qiE 'self.?host' "$file"; then
    present=$((present + 1))
  else
    missing+=("$file")
  fi
done < <(git apply --numstat "$PATCH" | cut -f3)

if [ ${#missing[@]} -eq 0 ]; then
  echo "    already applied"
elif [ "$present" -eq 0 ]; then
  echo "    applying"
  git apply --3way "$PATCH" ||
    die "patch did not apply cleanly; resolve the conflicts, commit, then rerun"
  git add -A
  git commit -m "selfhost: apply continue-without-subscription patch"
else
  die "patch partly missing in: ${missing[*]} (an upstream merge probably dropped it); re-apply those hunks by hand"
fi

[ "$BUILD" -eq 1 ] || { echo "==> done (build skipped)"; exit 0; }

echo "==> building and signing"
(cd "$DEPLOY_ROOT" && bun install)
(cd "$DEPLOY_ROOT/apps/screenpipe-app-tauri" && bun install && bash scripts/build_macos_selfhost.sh)

APP="$DEPLOY_ROOT/apps/screenpipe-app-tauri/src-tauri/target/${SCREENPIPE_SELFHOST_PROFILE:-release-dev}/bundle/macos/screenpipe.app"
[ "$INSTALL" -eq 1 ] || { echo "==> built: $APP"; exit 0; }

echo "==> installing to $INSTALL_DIR"
osascript -e 'quit app "screenpipe"' 2>/dev/null || true
mkdir -p "$INSTALL_DIR"
rm -rf "$INSTALL_DIR/screenpipe.app"
ditto "$APP" "$INSTALL_DIR/screenpipe.app"
open "$INSTALL_DIR/screenpipe.app"
echo "==> installed and opened: $INSTALL_DIR/screenpipe.app"
