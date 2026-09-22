# Resume OpenMausBot 0.1.90 — September 22, 2026

## What the owner wants

Keep the Windows workspace, bots, conversations and DeepSeek key on Windows.
Select the physical Mac by name as a bot's computer destination from Windows.
Use a private connection without Cloudflare. Both desktop apps need 0.1.90.

The owner requested no additional testing and then gave a two-minute shutdown
warning. They explicitly requested this handoff to finish later. Resume from
here; do not restart the investigation or run additional tests without a new
request. Do not claim the installed Mac workflow is verified.

## Saved work

Repository: `C:\Devx\Trea\OpenMausBot` (WSL `/mnt/c/Devx/Trea/OpenMausBot`).
Branch: `personal/deepseek-engine-offline`.
Origin: `https://github.com/NewyorkDev/OpenMausBot.git` (public).

- `2c3798c4`: previous DeepSeek engine/model picker/desktop fixes and Graphify graph.
- `182c459f`: paired-Mac destination, UI, scoped MCP proxy, documentation, version 0.1.90.
- Both commits are local, not pushed at this handoff.
- Preserve the unrelated `electron/vendor/electron-updater.cjs` line-ending change.
- Existing installed Windows app remains 0.1.89. No 0.1.90 installation was started.

Implementation extends the existing Electron computer-sharing connector, native
permission dialog, workspace pairing, and shared-computer job/lease machinery.
The bot stores `sharedComputerId` and `sharedComputerName`; a selected Mac never
falls back to the Windows desktop when offline. The model's selected computer
MCP proxy is bound to that destination and the active turn. Settings exposes
paired-computer enablement and creation of a one-use Mac pairing code.

Key files: `server/shared-computer-proxy.ts`, `server/index.ts`,
`src/components/PairedComputerSettings.tsx`, `src/components/ComputerPanel.tsx`,
`src/components/PlaceChip.tsx`, `src/components/ConnectedWorkspacesSettings.tsx`.
Graphify's tracked graph received incremental exact-symbol coverage.

## Build status at shutdown handoff

`pnpm build` and `pnpm build:server` finished successfully for 0.1.90.
Log: `.omb-scratch/evidence-0.1.90/build.log`.
Fresh compiled outputs: `dist` and `dist-server`.

Windows packaging was started immediately before shutdown warning:
- Staging project: `C:\Temp\OpenMausBot-personal-0.1.90-build`.
- All native resources and fresh renderer/server bundles are already staged.
- Output: `release/personal-0.1.90`.
- Expected installer: `OpenMausBot-0.1.90-setup.exe`.
- Packaging log: `.omb-scratch/evidence-0.1.90/package.log`.
- Tool session ID was 30983; do not assume it survived shutdown.
- UPDATE before shutdown: Windows packaging finished with exit code 0.
  `release/personal-0.1.90/OpenMausBot-0.1.90-setup.exe` is ready to install.
  It has not been installed or tested; existing 0.1.89 remains running.

If packaging was interrupted, rerun from the staging directory in WSL:

```sh
cd /mnt/c/Temp/OpenMausBot-personal-0.1.90-build
/mnt/c/nvm4w/nodejs/node.exe --experimental-strip-types \
  'C:\Devx\Trea\OpenMausBot\.omb-scratch\windows-packager\node_modules\electron-builder\cli.js' \
  --win nsis --x64 --publish never \
  '--config.directories.output=C:\Devx\Trea\OpenMausBot\release\personal-0.1.90' \
  --config.npmRebuild=false --config.electronVersion=43.4.0 --config.compression=normal
```

After it completes, install and launch only when the owner is ready to resume.
Prepared PowerShell scripts: `.omb-scratch/close-for-0.1.90.ps1` checks that no
chat is busy and closes the existing app cleanly; `.omb-scratch/install-0.1.90.ps1`
installs silently and launches via Explorer. Do not restart during shutdown.

## Mac build: next step and outstanding decision

No 0.1.90 Mac build has been started. Existing 0.1.86 Mac installers are in
`release/personal-0.1.86-mac`; they do not contain this new destination feature.

The source repository is PUBLIC. The owner originally said to push the project,
but after their privacy request the assistant promised to hold publication and
asked whether public source publication was acceptable. The latest explicit
question is still unanswered: may we push updated source and start the remote
Windows/Mac builds? Do not treat shutdown instructions as that answer. No API
keys, credentials, conversations, or app data belong in the push.

Once that outstanding publication decision is resolved in favor of pushing:

```sh
cd /mnt/c/Devx/Trea/OpenMausBot
git push origin personal/deepseek-engine-offline
gh workflow run personal-build.yml --ref personal/deepseek-engine-offline -f mac_arch=arm64
gh run list --workflow personal-build.yml --limit 3
```

The workflow builds Windows and Mac remotely, so it can continue with this PC off.
It does not publish a release. Download completed Mac artifacts into
`release/personal-0.1.90-mac`. The previous `openmausbot-macos-arm64` artifact
contained both Apple silicon and Intel DMG/ZIP outputs due builder configuration;
check actual filenames rather than assume. Previous successful run: 35769247425.
No GitHub key secrets were configured when checked; do not add a provider key.
Mac builds are unsigned/ad-hoc, not notarized. Physical Mac testing is outstanding.

## Installation and private pairing

Full instructions: [docs/private-mac-computer.md](docs/private-mac-computer.md).

1. Install 0.1.90 on Windows and the matching Apple silicon/Intel Mac build.
2. Install Tailscale on both and join the same private tailnet.
3. On Windows: `tailscale serve --bg --https=8443 http://127.0.0.1:8799`.
4. Enable paired computers in each app's local workspace and restart each app.
5. Create a Mac pairing code on Windows.
6. On Mac, use **Connected workspaces** to connect to the Windows HTTPS
   `.ts.net:8443` address. Use the pairing code to sign in.
7. On Mac, open Computer access for that saved workspace and explicitly grant
   Computer control through the native confirmation. Grant macOS Accessibility
   and Screen Recording permissions when requested. No terminal/folder grant is
   needed for basic desktop actions.
8. In Windows, select the named Mac in the bot's Computer panel. Keep both apps
   open and the Mac awake. DeepSeek Flash supports the configured computer tools;
   thinking is a separate option.

Do not use Desktop companion mode for this arrangement: it stops the local
control daemon. Mac does not need a second DeepSeek key. Windows owns the
workspace. Tailscale protects the device connection, but prompts/screenshots
used by a cloud model still go to that model provider.

## Verification already completed before owner stopped testing

- Existing sharing/proxy tests: 18 tests in 4 files passed.
- Paired Mac end-to-end, bot patch queue, and PlaceChip: 14 tests in 3 files passed.
- New isolated end-to-end fixture proved approval before a screenshot, image
  delivery to a loopback fake provider, denial without execution, and disconnect
  without a Windows fallback.
- Logs: `.omb-scratch/paired-tests.log`, `.omb-scratch/paired-final-tests.log`.
- Fixture recipe: `docs/verification/paired-mac.md`.
- Rendered selector, physical Mac permissions/control and installed 0.1.90 apps
  have NOT been tested. Further testing was explicitly skipped by request.
- An isolated preview was stopped; no live user workspace was used for tests.

For any future verification follow AGENTS.md and docs/verification/README.md:
use isolated fixtures, never mutate live user conversations as tests.

## Resume order

1. Windows installer is built. Offer installation after the owner returns.
2. Resolve the pending public-source push decision, then start remote Mac build.
3. Retrieve installer artifacts and provide concrete install links.
4. Finish Windows installation/launch when the owner is back and ready.
5. Help pair the actual Mac using the guide. Do not claim it is already paired.
