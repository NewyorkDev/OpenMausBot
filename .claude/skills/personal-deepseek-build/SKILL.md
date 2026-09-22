---
name: personal-deepseek-build
description: "Build, install and operate the personal OpenMausBot setup: DeepSeek baked in as an engine, offline-by-default, Windows client + Mac M4 host/computer. Use for building personal installers, refreshing the baked-in key, offline/egress questions, or wiring an agent to drive a Mac."
---

# Personal DeepSeek build

A forked, personal configuration of OpenMausBot. Three things differ from upstream:

1. **DeepSeek is a first-class engine** with an encrypted key baked into the installer.
2. **Offline by default** — the app contacts nothing until you turn that off.
3. The intended topology is a **Windows chat client** talking to a **Mac M4 that is
   both the server and the computer agents drive**.

Target topology:

```
Windows PC  ──(LAN / Tailscale)──►  Mac M4
 chat client                        ├─ OpenMausBot desktop app = the server
                                    └─ the same app = the computer that gets driven
iOS (later)  ─────────────────────► same Mac
```

## DeepSeek

Already configured; do not rebuild it. What the code guarantees
(`server/config.ts`, pinned by `server/config.test.ts`):

| Setting | Value |
| --- | --- |
| Instance id | `deepseek` |
| Driver | `openai-compat` (DeepSeek speaks the OpenAI contract) |
| Endpoint | `https://api.deepseek.com/v1` |
| Key env | `DEEPSEEK_API_KEY` |
| Models | `deepseek-reasoner` (default), `deepseek-chat` — a *managed* list, so no `GET /models` call is ever made |
| Own section | `deepseek` in `config.json`; it can **never** inherit the workspace `openaiCompat` URL or the OpenRouter key |

Confirm it on a running instance:

```sh
node --experimental-strip-types scripts/control-omb.ts doctor --url http://127.0.0.1:PORT
```

`deepseek` should appear with `driverKind: "openai-compat"`, `displayName: "DeepSeek"`
and both models. It reads `unavailable` until a key is stored, then `available`.

### Changing or removing the key

Settings → API keys → DeepSeek. That is the only supported path: it writes to the
OS credential store (DPAPI / Keychain / libsecret), not to `config.json`.

The baked-in key arrives on first launch via
`electron/deepseek-provision.mjs` → the ordinary credential migration. It is
**one-shot**: a marker beside `credentials.bin` means the shipped blob is never
read again, so clearing the key in Settings is permanent. To make a build
re-provision, delete `deepseek-provision.json` from the app's user data and
reinstall.

Full detail, including the honest limits of the encryption:
[docs/deepseek-provisioning.md](../../docs/deepseek-provisioning.md).

## Offline mode

Offline is the default. A fresh install, or a `config.json` that never mentions
`offline`, is offline (`server/config.ts` `offlineModeEnabled`).

What the gate actually suppresses:

| Egress | Gated on |
| --- | --- |
| Auto-update check (~15 s after launch, then hourly) | offline |
| Hosted account restore (`accounts.openmausbot.com`) | offline |
| Composio / connected-apps registration | offline |
| PostHog analytics | opt-in separately in the renderer |

What it deliberately does **not** block: engine traffic (that is the point of
DeepSeek), a paired server you set up yourself, and anything you start by hand.
Offline mode is "no incidental egress", not a network cut. In Settings, **Update
now** still works with offline mode on — a manual check is always allowed.

Turn it off in Settings → General → Offline mode, or per launch with
`OMB_OFFLINE=0` (it wins over the config in both directions). See
[docs/offline-mode.md](../../docs/offline-mode.md).

## Building installers

Windows and macOS installers cannot be built on Linux/WSL (NSIS needs Windows or
Wine; the Mac build needs macOS for the Swift speech helper and codesign). Use
the workflow.

**Actions → Personal build → Run workflow**, pick `arm64` for the M4, download the
artifacts. Nothing is published to a release feed. **No secrets are required**:
with `OMB_DEEPSEEK_KEY` unset the build skips baking and still produces a working
installer — then paste the key into Settings on each machine, which puts it in
the OS credential store just the same.

Pre-filling the key is optional. Add one repo secret on your own fork or private
copy:

| Secret | Value |
| --- | --- |
| `OMB_DEEPSEEK_KEY` | `sk-…` from <https://platform.deepseek.com/api_keys> |

That is the only secret. `OMB_PROVISION_PASSPHRASE` is optional — unset, the
build uses a documented default so the baked-in key is always recoverable.

The workflow is `.github/workflows/personal-build.yml`. It deliberately is not
`release.yml`: that one signs, notarizes and publishes to a public feed, none of
which applies here.

Local build of just the staging files, to inspect them:

```sh
export OMB_DEEPSEEK_KEY=sk-…
node scripts/provision-deepseek.mjs encrypt
node scripts/provision-deepseek.mjs verify   # prints a fingerprint, never the key
node scripts/provision-deepseek.mjs decrypt  # recovery: prints the key back out
node scripts/provision-deepseek.mjs clean    # always, on a shared machine
```

macOS builds are **unsigned**. First launch needs right-click → Open, or:

```sh
xattr -dr com.apple.quarantine "/Applications/OpenMausBot.app"
```

## Making the Mac driveable

The Mac must run the **desktop app**, not a headless server: only the app can
expose its own desktop, and only the app spawns the CUA driver with the right
permissions.

On the Mac:

1. Install the app, open it, and sign in to a **CLI/ACP engine** — Claude,
   Cursor, Qwen, Hermes or Pi. See the next section for why DeepSeek will not do.
2. Grant **Accessibility** and **Screen Recording** to OpenMausBot in System
   Settings → Privacy & Security. Restart the app afterwards.
3. Choose the destination in the bot's Computer panel: **This computer**.

### DeepSeek cannot drive the Mac

Verified from a live `doctor` run: the API-key engines (`deepseek`,
`openaiCompat`) report `localComputerMcp: false`; the CLI/ACP engines report
`true`. The gate is `providerSupportsLocal`, and the server refuses with
"this model engine cannot control this computer — choose Claude or an ACP
engine".

The reason is structural, not a bug: driving a desktop needs an engine that can
ask for **approval** before each action, and an API-key chat endpoint has no
approval channel. So:

- **Chat / coding / research on DeepSeek** — fine, this is what it is for.
- **Driving the Mac's screen** — needs a signed-in CLI engine *in addition to*
  DeepSeek. Both can be installed; the bot picks the engine per bot.

### The CUA driver daemon

"CUA" is Computer-Use Agent; the "daemon" is `cua-driver`, a Rust binary from
[trycua/cua](https://github.com/trycua/cua) bundled at build time
(`scripts/prepare-cua.mjs`, `scripts/prepare-cua-win.mjs`). It is what actually
moves the mouse, types, and reads the screen.

**Keep it.** It is the entire mechanism behind "an agent drives the Mac" — remove
it and the Computer panel can only offer cloud boxes.

How it runs (`electron/cua.mjs`):

- Packaged app: **embedded** mode — the app spawns a private daemon so macOS
  attributes the Accessibility/Screen Recording grants to *OpenMausBot*, giving
  one permission prompt with the right name.
- Development: **standalone** mode — attaches to an already-installed
  `CuaDriver.app` daemon.
- Agents never touch the daemon socket directly. They spawn the official stdio
  MCP proxy (`cua-driver mcp --embedded --socket <path>`); the host-owned daemon
  is what executes.

Telemetry is already off (`CUA_DRIVER_RS_TELEMETRY_ENABLED=0`, set in the
environment by `electron/cua.mjs`), so it is consistent with the offline posture.
If the Computer panel says the driver is not ready, it is almost always a
missing Accessibility/Screen Recording grant or a stale app process.

## Operating it

Start an isolated fixture before claiming any server change works — never test
against the live app:

```sh
node --experimental-strip-types scripts/control-omb.ts launch
# then, from a second terminal, with the printed URL:
pnpm control:omb doctor --url http://127.0.0.1:PORT
```

Follow [docs/verification/README.md](../../docs/verification/README.md). Settings,
the updater UI, and the model picker are renderer-only and are **not** provable
by this harness — say so rather than implying otherwise.

For the Mac, follow [docs/mcp-server.md](../../docs/mcp-server.md) for pairing an
external agent and [docs/verification/tailscale.md](../../docs/verification/tailscale.md)
for the tailnet path.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| DeepSeek listed but `unavailable` | No key stored. Settings → API keys → DeepSeek. |
| "this model engine cannot control this computer" | The selected bot uses an API-key engine. Switch that bot to a CLI/ACP engine. |
| Computer panel: driver not ready | Missing Accessibility / Screen Recording grant, or the app needs a restart. |
| Mac app "is damaged and can't be opened" | Unsigned build quarantined. `xattr -dr com.apple.quarantine`. |
| Proxy / tunnel list is empty | You are on a dev build. The pinned-browser proxy is packaged-only. |
| Verification fixture shows every engine unavailable | CRLF working tree on Linux (WSL with a Windows checkout): a `#!/usr/bin/env node` shebang becomes `node\r`. Run `sed -i 's/\r$//' server/testing/fake-*-cli.ts server/testing/fake-codex-app-server.ts` in the working tree, or set `core.autocrlf=false` for the checkout. |
| `electron-builder` fails: missing `dist-native/provision` | Provisioning was skipped. Run `node scripts/provision-deepseek.mjs encrypt` before packaging. |

## Not covered here

- **iOS.** Planned; nothing is built for it yet.
- **Publishing.** This is a personal build. Do not run `release.yml`, and keep
  installers to yourself — the baked-in key ships inside them.
