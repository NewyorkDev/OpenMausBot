# Paired desktop destination

The implementation reuses Electron's existing computer-sharing connector,
workspace pairing, native permission dialog, and host-control lease. The new
MCP proxy binds a turn to one selected shared computer.

Run against an isolated fixture only:

```sh
pnpm exec vitest run server/paired-computer.e2e.test.ts
```

The recipe launches `launchVerificationServer`, uses `runControlOmb` with its
explicit URL, pairs a synthetic Mac through the actual connector, and points
DeepSeek at a loopback fixture provider. No live credentials or real computer
input are used. Evidence is saved beside the fixture's persistent server log
with a `.paired-mac.json` suffix.

The test selects the paired destination, checks that a screenshot waits for
approval, approves it and observes the image in the next provider request,
denies a second request without executing it, then disconnects the Mac and
checks that the next turn fails without a host fallback.

This proves the isolated server/connector workflow, not the installed macOS
app's OS permissions, physical input, Tailscale setup, or the rendered selector.
On September 22, 2026 the focused end-to-end and existing sharing tests passed.
Additional interface and installer testing was skipped at the owner's request
to expedite packaging. Do not describe the installers as physically verified.

Setup instructions: [Paired Mac](../private-mac-computer.md).
