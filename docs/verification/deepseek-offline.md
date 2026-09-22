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
