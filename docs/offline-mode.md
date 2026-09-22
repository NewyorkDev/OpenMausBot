# Offline mode

OpenMausBot ships **offline by default**: a fresh install contacts nothing on
its own. Nothing here gates the network generally — your engines and any
server you paired with keep working. It gates the traffic *the app generates
about itself*.

## What is gated

| Caller | Where | Default |
| --- | --- | --- |
| Update check on a timer (**GitHub**) | `electron/updater.mjs` | skipped; Settings → Updates still works on demand |
| Usage analytics (**PostHog**) | `src/lib/analytics.ts` | off; opt-in in Settings → General |
| Hosted-account health probe (**accounts.openmausbot.com**) | `electron/main.mjs` | skipped |
| Connected-apps broker registration | `electron/main.mjs` | skipped |

## What is not gated

Everything that is the app doing its job rather than phoning home:

- the engine endpoints you configured — DeepSeek, Anthropic, a local Ollama,
  a CLI agent on a Mac you drive;
- the server you paired with, over LAN, Tailscale, a tunnel or a domain;
- any update you ask for by hand.

## Turning it off

Per install, in `~/.openmausbot/config.json`:

```json
{ "offline": { "enabled": false } }
```

Or for a single launch, without editing a persisted preference:

```sh
OMB_OFFLINE=0 ./OpenMausBot
```

`OMB_OFFLINE` wins over the config file in both directions (`1`/`true`/`yes`/`on`
and `0`/`false`/`no`/`off`). An unrecognized value is ignored rather than
guessed at, so a typo cannot silently turn egress back on.

In the app: **Settings → General → Stay offline**.

## Why the launch update check needs a restart

The desktop shell reads the decision from `config.json` at launch, before a
server exists to ask. Flipping the switch therefore changes the *timer*, not a
check already scheduled in this launch. The manual **Check for updates** button
is available either way, so being offline never means being stuck on an old
build — it means being told only when you ask.

## Where the rule lives

- `electron/offline-mode.mjs` — the desktop shell's copy (no server yet).
- `server/config.ts` → `offlineModeEnabled` — the same rule once a config is
  parsed, plus the Settings status the renderer reads.

Both are pinned to the same answers by `electron/offline-mode.test.mjs`, and
`server/index.ts` reports the **effective** value so the Settings switch shows
the position the app actually behaves in rather than the raw stored one.
