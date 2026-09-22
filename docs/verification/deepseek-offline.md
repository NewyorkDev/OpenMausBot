# DeepSeek engine and offline mode

Covers the two personal-build changes that have a server surface: the shipped
DeepSeek engine, and the offline-by-default gate.

## Sub-features

- DeepSeek is present as a selectable engine in the default fleet.
- It reports `unavailable` with no key and `available` once one is stored.
- A new bot starts on DeepSeek once it is available, and falls back to the
  previous Claude preference while it is not; either bot's model is switchable.
- Its credential never reaches another engine, and no other engine's credential
  reaches it.
- `offline.enabled` is true on a fresh install.
- Storing the key and then rewriting the whole fleet does not strip DeepSeek's
  pinned endpoint, model list or key env.

## Driving it

Launch the fixture and read its URL:

```sh
node --experimental-strip-types scripts/control-omb.ts launch
```

Then, with `URL=http://127.0.0.1:PORT`:

```sh
# 1. Fresh install: no key, and offline.
curl -s "$URL/api/config" | grep -o '"deepseek":{[^}]*}\|"offline":{[^}]*}'
#   {"deepseek":{"configured":false}}
#   {"offline":{"enabled":true}}

# 2. The engine is in the fleet, with both models and the right default.
node --experimental-strip-types scripts/control-omb.ts doctor --url "$URL"
#   doctor.ok true; instances[] contains
#     instanceId "deepseek", driverKind "openai-compat", displayName "DeepSeek",
#     models.default "deepseek-reasoner",
#     models.options ["deepseek-reasoner", "deepseek-chat"]

# 3. Store a key. Use a synthetic value; this fixture never calls DeepSeek.
curl -s -X PUT "$URL/api/config" -H 'content-type: application/json' \
  -d '{"deepseek":{"key":"sk-verification-fixture-not-a-real-key"}}' -o /dev/null -w '%{http_code}\n'
#   200

# 4. The key stays in its own section; openaiCompat is untouched.
curl -s "$URL/api/config" | grep -o '"deepseek":{[^}]*}\|"openaiCompat":{[^}]*}'
#   {"deepseek":{"configured":true}}
#   {"openaiCompat":{"configured":false,"url":""}}

# 5. The load-bearing step: editing ANY provider setting rewrites the whole
#    materialized fleet (index.ts persistProviderInstance). DeepSeek must keep
#    its code-owned config across it.
curl -s -X PATCH "$URL/api/instances/claude" -H 'content-type: application/json' \
  -d '{"displayName":"Verification fixture"}' -o /dev/null -w '%{http_code}\n'
node -e 'const c=require(process.env.OMB_DATA_DIR+"/config.json");
  console.log(JSON.stringify(c.instances.deepseek,null,1))'
#   { "driver": "openai-compat", "displayName": "DeepSeek",
#     "icon": { "kind": "preset", "preset": "deepseek" },
#     "config": { "url": "https://api.deepseek.com/v1",
#                 "apiKeyEnv": "DEEPSEEK_API_KEY",
#                 "model": "deepseek-reasoner",
#                 "managedModels": ["deepseek-reasoner","deepseek-chat"] } }

# 6. And the engine now reports available.
node --experimental-strip-types scripts/control-omb.ts doctor --url "$URL"
#   availableEngines ["deepseek", "claude"]
```

Step 5 is the one worth keeping in the record. `persistableInstanceConfigs()`
drops an instance's `config` when `config.json` never had one, so that an
injected workspace default cannot freeze into the saved file. DeepSeek is the
first default-fleet engine whose behaviour depends on its own code-owned config,
so without the `CODE_DEFAULT_INSTANCE_CONFIG` fallback a single unrelated save
would rename it into a generic openai-compat instance on the next boot —
inheriting the workspace OpenRouter key. `server/config.test.ts` pins it under
"survives the save/reload round trip that materializes the fleet".

## Which engine a new bot starts on

`selectDefaultModelSelection` (`server/default-model-selection.ts`) is what a bot
created without an explicit model gets, so it is the fresh-install path. It used
to prefer `claudeAgent` unconditionally, which meant a workspace whose only
configured key was DeepSeek still started every new bot on whatever Claude CLI
happened to be installed. DeepSeek now comes first, with that Claude preference
kept as the fallback so an unavailable DeepSeek degrades to the old behaviour
rather than to no engine at all.

```sh
URL=http://127.0.0.1:PORT

# 1. Before a key: DeepSeek cannot answer, so the old rule still decides.
curl -s -X POST "$URL/api/bots" -H 'content-type: application/json' \
  -d '{"name":"FallbackProbe"}' | grep -o '"modelSelection":{[^}]*}'
#   {"instanceId":"claude","model":"claude-sonnet-5"}

# 2. Store a synthetic key (step 3 above), and DeepSeek reports available:
#    {"state":"available","authenticated":true,"billing":"metered"}

# 3. Now the same fresh-install path lands on DeepSeek, even though Claude is
#    also available.
curl -s -X POST "$URL/api/bots" -H 'content-type: application/json' \
  -d '{"name":"DeepSeekDefaultProbe"}' | grep -o '"modelSelection":{[^}]*}'
#   {"instanceId":"deepseek","model":"deepseek-reasoner"}
```

A bot's engine and model are also switchable per bot, which is the other half of
"it defaults to Sonnet for everything":

```sh
curl -s -X PATCH "$URL/api/bots/<id>/model" -H 'content-type: application/json' \
  -d '{"instanceId":"deepseek","model":"deepseek-chat"}' | grep -o '"modelSelection":{[^}]*}'
#   {"instanceId":"deepseek","model":"deepseek-chat"}   -- and it persists to bots.json
```

Regression: `pnpm vitest run server/default-model-selection.test.ts`.

## The two paths the Settings rows write

Both rows are Electron UI and remain outside this map, but the requests they make
are provable, and they are the difference between "the row renders" and "the row
does something":

```sh
# The Stay offline switch -> PATCH /api/config
curl -s -X PATCH "$URL/api/config" -H 'content-type: application/json' \
  -d '{"offline":{"enabled":false}}' -o /dev/null -w '%{http_code}\n'   # 200
node -e 'console.log(require(process.env.OMB_DATA_DIR+"/config.json").offline)'
#   { enabled: false }   -- and true again after patching it back

# A junk value is refused rather than coerced.
curl -s -X PATCH "$URL/api/config" -H 'content-type: application/json' \
  -d '{"offline":{"enabled":"nope"}}' -o /dev/null -w '%{http_code}\n'  # 400

# The DeepSeek "Test key" button -> the provider resolves to the real endpoint.
curl -s -X POST "$URL/api/keys/test" -H 'content-type: application/json' \
  -d '{"provider":"deepseek","key":"sk-synthetic-not-real"}'
#   {"ok":false,"reason":"rejected","status":401}
```

The 401 is the useful part: DeepSeek itself answered, so the section is wired to
`https://api.deepseek.com/v1` and not to a workspace OpenAI-compatible URL. This
is the only step that leaves the machine, and it carries a throwaway key.

## Reproduce without a server

```sh
pnpm vitest run server/config.test.ts \
  electron/deepseek-provision.test.mjs \
  electron/offline-mode.test.mjs \
  src/lib/analytics.test.ts
```

## Gotchas

- The fixture's own fleet has no DeepSeek key, so `unavailable` in step 2 is the
  expected state, not a failure.
- `doctor.ok` is true only when at least one engine is available. On a WSL
  working tree with CRLF line endings the fixture's fake CLI has a
  `#!/usr/bin/env node\r` shebang and nothing is available; normalize it before
  drawing conclusions from `ok`.
- PostHog opt-in is renderer-only and is not provable here.
- Settings → API keys, the Offline mode row, and the model picker are Electron
  UI. They remain outside this map: the API above proves what the UI writes, not
  that the row renders.

## Personal 0.1.87 selector regression (September 22, 2026)

Ready API instances must remain in Settings → Engines. A managed model catalog
on an `access: custom` driver belongs on the Cloud rail, and opening the picker
before instances finish loading must recover to that catalog. The rail now
shows provider names. Model changes initially apply to the thread and bot;
the user can still choose only the current thread.

The shared API engine controls write the existing PATCH `/api/instances/ID`
`tools` flag (explicitly engine-wide), and PATCH `/api/config`
`defaultModelSelection` (new bots only). No parallel provider or credential
path was introduced.

Verified against an isolated `launchVerificationServer` and the real
`threads-preview.tsx` renderer using headless Playwright:

- Synthetic DeepSeek key produces a ready engine and Reasoner/Chat options.
- A Claude bot can switch to DeepSeek Reasoner; Chat selection persists to
  the active thread and bot profile.
- Tool toggle persists, and the new-bot default saves to DeepSeek Chat.
- DeepSeek remains visible in Settings; desktop and 390px picker views render
  without horizontal overflow.
- `server/openai-tools.e2e.test.ts` separately proves synthetic provider replies,
  tool approval/execution, denial, interruption and tools-off conversations.

Live DeepSeek requests are deliberately not sent from these fixtures.
The Windows CUA smoke timed out under standalone Node 22 with both binaries.
Running the same smoke through packaged Electron with ELECTRON_RUN_AS_NODE=1
successfully started and stopped the owned GUI-subsystem daemon (0.28.2,
contract 0.8.0). This proves the packaged host lifecycle, not desktop actions.

## Personal 0.1.88: greetings must not require a computer

The prior Auto path wrote its mounted computer to `task.surface` before the
model answered. This turned incidental tool availability—even for "hi"—into
a permanent destination requirement. It then blocked chat-only API engines
after a model switch. Auto no longer writes a destination pin. User-selected
thread destinations still use the existing explicit `surface` setting.
The two affected personal threads were confirmed by their owner to have no
manual computer selection; their legacy pins are cleared during this upgrade.

The current DeepSeek catalog is `deepseek-flash` (V4.1 Flash) and
`deepseek-v4-pro`, per https://api-docs.deepseek.com/updates/ (September 10).
The shared OpenAI-compatible runtime now forwards the existing effort selection:
None sends `thinking.type=disabled`; Low/High/Max enable thinking and set
`reasoning_effort`. The driver recognizes the retired personal-build model
catalog and maps legacy aliases without sending discontinued model IDs.

Validation: 203 config/driver/tool/isolated harness tests passed. The real
renderer selected V4 Pro with None, read back the same bot/thread selection,
and remained on Auto. The packaged-server smoke passed. A separate disposable
Electron profile used the existing encrypted credential only in memory:
GET /models returned both current IDs; a tool-free Flash request containing
only "hi" returned HTTP 200 and a greeting. No user conversation was sent.

### Personal 0.1.89 follow-up (September 22, 2026)

The previous successful greeting and subsequent failed greeting were traced in
read-only event records. The failure occurred during MCP setup at eight seconds,
before any tool call or model response. Setup now has a 30-second budget and names
the integration on failure; only dispatched tool calls report uncertain execution.
An isolated nine-second startup regression completes a greeting without effects.

The picker shows both DeepSeek models directly, labels thinking separately, and
keeps engine-wide settings in Settings. A real renderer fixture selected Pro/None
and checked persistence, row visibility, and the absence of a computer pin.
Evidence: `.omb-scratch/evidence-0.1.89/v4-picker.png` and `ui-check.py`.

Flash can mount the existing gated local computer MCP descriptor only when the
person chooses the computer. Pro cannot mount it. The shared model capability
policy feeds server dispatch, registry metadata and the UI. Auto mounting is
explicitly disabled for this API engine. The existing per-call approval broker
is retained, including the person's explicit Full access grant. Computer image
results are bounded and sent as user image inputs after all tool results; their
base64 data is absent from tool previews and this driver's native log.

Verification: isolated HTTP/stdin tool tests cover approved screenshot transport,
denied desktop actions, Pro rejection, existing interruption behavior, and slow
startup; the isolated harness conversation recipe and local computer gate test
passed. Three Windows Electron helper startups advertised 28 tools in 70–74 ms.
Typechecks and the production bundles passed, as did the packaged server smoke.
These checks use synthetic tools/screenshots, not the user's actual desktop.
Source remains the canonical checkout on `personal/deepseek-engine-offline`,
base `66da7a52`; no commit or push was made.
