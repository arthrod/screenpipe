# Self-host deployment

Branches:

- `main` mirrors `upstream/main` (mediar-ai/screenpipe) exactly. Never commit to it.
- `deploy` = upstream + our feature work + the self-host patch. Build from here.

## Update

From the `deploy` worktree:

```bash
selfhost/update.sh            # sync main, merge upstream, check patch, build + sign
selfhost/update.sh --install  # same, then copy to ~/Applications and open it
selfhost/update.sh --no-build # sync only
```

The script stops on merge conflicts or a partly missing patch; fix, commit, rerun.

## What the patch does (`self-host.patch`)

- Adds **Continue without subscription** next to every subscription ask: the
  onboarding plan step (which no longer jumps straight to Stripe), the first-run
  trial lock and paywall, and the app's sign-in / subscription screens.
- The choice is stored as `selfHostUnlocked: true` in settings (read by the
  native gates in `src-tauri/src/store.rs` / `recording.rs`) and in localStorage
  (read by the frontend gates). It opens local gates only — recording, full
  history, unlimited pipes. It never claims a paid plan, so Screenpipe Cloud
  features (cloud transcription/AI, sync) stay off.
- `scripts/build_macos_selfhost.sh`: optimized, signed release build through the
  native build queue. No `official-build` feature, so auto-update is off and an
  official release never replaces this build.

## AI: bring your own key

Already supported upstream; no patch needed. Settings → AI → add a preset with
provider OpenAI, Anthropic, Ollama, or Custom (any OpenAI-compatible URL + key).

## Refreshing the patch after editing it on `deploy`

```bash
git worktree add /tmp/selfhost-refresh upstream/main
cd /tmp/selfhost-refresh && git apply --3way <deploy>/selfhost/self-host.patch
# fix, then:
git add -A && git diff --cached upstream/main -- . ':!selfhost/self-host.patch' > <deploy>/selfhost/self-host.patch
```

## License

Screenpipe's license (LICENSE.md §2) allows modifying and running your own
build for personal, non-commercial use. Commercial use needs a paid license
from Screenpipe (§4); this patch does not change that.
