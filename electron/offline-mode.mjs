// The desktop shell's half of the static-egress privacy gate.
//
// "Offline" here means the app's own background/incidental traffic — the
// on-launch update check, usage analytics, the hosted-companion health probe
// and the managed connected-apps broker. It does NOT mean the app refuses to
// use the network: the server you paired with, the engine endpoints you
// configured (DeepSeek, Claude, a local Ollama) and anything you click must
// keep working, because those are the app doing its job rather than phoning
// home. Nothing in this module gates a configured connection.
//
// The shell reads ~/.openmausbot/config.json itself, before any server
// exists, so this decision cannot come from the server. server/config.ts
// (offlineModeEnabled) is the same rule for callers that already have a
// parsed config; the two are kept in step by offline-mode.test.mjs.
//
// Absent means OFFLINE: a fresh install contacts nothing until asked.

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off"]);

/** True when the app should keep its background/incidental egress off.
 *
 * `OMB_OFFLINE` wins over the config file so a single run can go online
 * without editing a persisted setting. An unrecognized value is ignored
 * rather than guessed at: a typo must not silently turn egress back on. */
export function offlineModeEnabled({ config, env = process.env } = {}) {
  const override = typeof env?.OMB_OFFLINE === "string" ? env.OMB_OFFLINE.trim().toLowerCase() : "";
  if (TRUTHY.has(override)) return true;
  if (FALSY.has(override)) return false;
  const section = config?.offline;
  if (section && typeof section === "object" && !Array.isArray(section)) {
    if (section.enabled === false) return false;
  }
  return true;
}

/** What the gated callers should do this launch. Kept separate from the
 * boolean so a caller reads as a decision rather than a negation, and so the
 * "why" lands in one place when someone wonders why the app went quiet.
 *
 * Usage analytics is deliberately NOT here: it is opt-in in the renderer
 * (src/lib/analytics.ts), so it is already off unless the person turned it on
 * in Settings — a second gate would only make that switch look broken. */
export function offlinePolicy({ config, env = process.env } = {}) {
  const offline = offlineModeEnabled({ config, env });
  return {
    offline,
    /** Update check on a timer at launch (manual "Check for updates" still works). */
    updateCheckOnLaunch: !offline,
    /** accounts.openmausbot.com health probe + signed-in restore. */
    hostedAccountAllowed: !offline,
    /** The managed connected-apps broker registration. */
    composioBrokerAllowed: !offline,
  };
}
