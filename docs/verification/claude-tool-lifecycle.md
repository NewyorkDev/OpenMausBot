# Claude coordination and turn-scoped tools

“OpenMausBot: the turn ended” is an approval-broker denial, not evidence of
an internet outage. Browser capabilities also expire when their owning turn
ends; “unauthorized” after that boundary must not be repaired by giving a
worker permanent browser credentials.

The Claude driver keeps native background tasks disabled. Native subagents
can still work within the active turn; asynchronous work across bots uses
OpenMausBot's `delegate_bot` path, which owns each recipient's turn, approvals,
and completion receipt. Long-running native Bash commands can no longer
auto-background past the owning turn. This does not change approval modes or
disable sandbox protections.

Claude can emit a synthetic result with `origin.kind = "task-notification"`.
That result must not settle a submitted user turn or consume its permissions.
The regression fixture emits this result, then asks for WebFetch permission,
and only finishes the parent after the test releases a file gate.

The small `agents` and `ogb` MCP servers use `alwaysLoad: true` so the first
prompt includes coordination and approval tools. Other MCP servers retain
normal deferred loading. This prevents the deferred-lookup dependency; it
does not magically reconnect a crashed server or override a user's denied
tool policy.

Sources:

- [Claude MCP server loading](https://code.claude.com/docs/en/mcp#exempt-a-server-from-deferral)
- [Claude background-task setting](https://code.claude.com/docs/en/env-vars)
- [SDK result and background-task messages](https://code.claude.com/docs/en/agent-sdk/typescript)

Regression checks:

```sh
pnpm exec vitest run server/drivers/claude.test.ts server/drivers/agents-proxy.test.ts server/browser-proxy.test.ts
```

The turn boundary itself — a capability whose owning turn has been replaced
is refused with 401 even when its request body arrives late — is covered by
`server/index.test.ts` ("binds profile proposals to the capability's bot and
thread and rechecks late bodies"); every internal capability, the browser's
included, passes through that same gate.

For end-to-end verification, launch the isolated fixture described in
[README.md](README.md), then follow [Chat turns](chat-turns.md). Never use the
customer's running app to create test bots, approve requests, or rotate tools.
These fixture checks do not prove that a customer's real provider account or
network is healthy. Ask for their app version, Claude CLI version, and a
redacted diagnostic export if failures remain; do not request credentials.

## Rebuilt conversations

Editing a message or rebuilding context must start a new Claude session,
even when its old process is still idle. Ordinary follow-ups keep reusing or
resuming the current session. A transient retry after a reset resumes the
replacement session, not the abandoned one.

```sh
pnpm exec vitest run server/drivers/claude.test.ts server/turn-context.test.ts server/resume-recovery.test.ts
pnpm exec vitest run server/delta-context.e2e.test.ts -t "resets Claude's native context"
```

The second command launches a disposable server and fake CLI through the
shared verification launcher. It creates a conversation, edits the last user
message with `control-omb edit`, and checks the native launch, reset log,
active-branch replay and subsequent resume. Abandoned request/reply markers
must not reach the replacement prompt. It does not exercise a live Claude
account or claim automatic context compaction is implemented.

## Older Claude CLI versions

Every optional flag the driver passes has to be one the installed CLI accepts: an
unknown flag is a hard argument error, so a flag the CLI predates fails *every*
turn with `error: unknown option '<flag>'` rather than degrading. The reported
case was a 1.0.51 install (the npm `@anthropic-ai/claude-code` on the Windows
side of a WSL machine) failing with
`claude exited 1: error: unknown option '--include-partial-messages'`.

Streaming was the *first* of **nine** flags that install was being sent
unconditionally, not the only one. 1.0.51 also rejects `--tools`, `--settings`,
`--session-id`, `--effort`, `--append-system-prompt-file`, `--setting-sources`,
`--autocompact` and `--system-prompt-snapshot`, so gating streaming alone moves
the same failure one flag further along. It *does* accept `--permission-mode`,
`--disallowedTools`, `--strict-mcp-config`, `--mcp-config`, `--allowedTools`,
`--permission-prompt-tool`, `--model`, `--append-system-prompt` and `--resume`.

### The verified floor table

`CLAUDE_FLAG_FLOORS` (`server/drivers/claude.ts`) maps each optional flag to the
first CLI version known to accept it. Every row was pinned against real published
binaries — by running the flag past the CLI's own argument parser, or by grepping
it out of the bundled `cli.js` for versions that still shipped one:

| flag | first accepted | how it was pinned |
| --- | --- | --- |
| `--strict-mcp-config` | 1.0.60 | earlier check; 1.0.51 also accepts it, so the floor is conservative |
| `--session-id` | 1.0.55 | present in 1.0.55, absent in 1.0.52 |
| `--settings` | 1.0.61 | changelog "Settings: Added `--settings` flag", matching the 1.0.60/1.0.61 boundary |
| `--include-partial-messages` | 1.0.109 | changelog; absent in 1.0.100 |
| `--setting-sources` | 1.0.122 | absent in 1.0.109 |
| `--tools` | 2.0.32 | absent in 2.0.30 |
| `--append-system-prompt-file` | 2.0.34 | absent in 2.0.32 |
| `--effort` | 2.1.40 | absent in 2.1.30 |
| `--autocompact` | 2.1.231 | 2.1.177 rejects it in every spelling and never documents it |
| `--system-prompt-snapshot` | 2.1.267 | changelog; 2.1.231 still rejects it |

The parser probe costs nothing: the CLI rejects an unknown option before it looks
the session up, so no API call is made.

```sh
claude -p --output-format stream-json --input-format stream-json --verbose \
  --autocompact 120000 --resume 00000000-0000-0000-0000-000000000000
# an older CLI:  error: unknown option '--autocompact'
# a newer CLI:   No conversation found with session ID: 00000000-...
```

Run a control with the same probe — a deliberately bogus flag has to produce
`error: unknown option '<bogus>'`. Without it a silently failing invocation looks
exactly like a supported flag, which is how `--autocompact` acquired a floor of
2.1.122 that every 2.1.122-to-2.1.176 install would have died on.

### Fail-open and fail-closed

The driver probes `claude --version` *before* it assembles the arguments — once
per process — so a turn that arrives before any snapshot is still gated. When the
version cannot be read at all (a wrapper that prints its own banner, a probe that
failed or timed out), `CLAUDE_WITHHOLD_WHEN_UNKNOWN` decides per flag:

- `--strict-mcp-config`, `--setting-sources`, `--autocompact` and
  `--system-prompt-snapshot` are still sent. Withholding `--strict-mcp-config`
  would silently re-open the context leak the driver exists to close.
- `--include-partial-messages`, `--session-id`, `--settings`, `--tools`,
  `--append-system-prompt-file` and `--effort` are withheld. Each one only
  degrades when left out — streaming arrives whole, the CLI mints the session id
  the stream then reports, the harness hooks do not load, the bot runs on
  Claude's own built-in tool set, the brief arrives inline instead, and the turn
  runs at the default effort.

The two mistakes are not equally bad, so a flag that can only ever degrade must
never be the one that kills the turn.

### What proves it

```sh
pnpm exec vitest run server/drivers/claude.test.ts -t "1.0.51"
pnpm exec vitest run server/drivers/claude.test.ts -t "has them all"
```

The first drives a whole turn through a fake CLI reporting `1.0.51` and asserts
from the argv the driver actually spawned that none of the nine flags are
present, that the brief still arrives as inline `--append-system-prompt`, and
that the flags that CLI does have are still sent. The second runs the same turn
against a `2.1.280` CLI and asserts every flag is present, so the gating cannot
quietly cost a modern CLI anything.

That test is a real guard, not a green tick: removing one gate
(`config.tools !== undefined && claudeCliSupports(cliVersion, "--tools")` back to
`config.tools !== undefined`) makes it fail with
`AssertionError: expected [ '-p', '--output-format', …(18) ] to not include '--tools'`.

End to end, a disposable server whose fake CLI stands in for an older one
(`FAKE_CLAUDE_VERSION` crosses from the launcher's environment) reaches the CLI
and simply loses the gated flags:

```sh
# launch with FAKE_CLAUDE_VERSION=1.0.100, send a turn, then read the argv the
# driver actually spawned from the fixture's fake-claude-dump.json:
#   turn reached the CLI: true
#   sends --include-partial-messages: false
```

The Engines page reports the same finding as an update notice ("replies arrive
all at once instead of streaming in", "bots run with Claude's own built-in tool
set instead of the one their owner picked", "the harness hooks do not load")
rather than a silent downgrade; that row is renderer UI and is not proven here.

