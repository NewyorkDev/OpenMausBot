// The offline gate's contract, and the one place the shell's copy and the
// server's copy (server/config.ts offlineModeEnabled) are held to the same
// answer. Kept exhaustive on purpose: "offline by default" is a privacy
// promise, so the ways it could silently flip to online are the test.
import { describe, expect, it } from "vitest";

import { offlineModeEnabled, offlinePolicy } from "./offline-mode.mjs";

const NO_ENV = {};

describe("offlineModeEnabled", () => {
  it("is offline when the config says nothing at all", () => {
    // The whole point: a fresh install, and any config that never mentions
    // offline, must not contact anything on its own.
    expect(offlineModeEnabled({ config: {}, env: NO_ENV })).toBe(true);
    expect(offlineModeEnabled({ config: { offline: {} }, env: NO_ENV })).toBe(true);
  });

  it("is offline when the config is missing or unusable", () => {
    // An unreadable file is a fresh install, never "no opinion, carry on".
    expect(offlineModeEnabled({ config: undefined, env: NO_ENV })).toBe(true);
    expect(offlineModeEnabled({ config: null, env: NO_ENV })).toBe(true);
    expect(offlineModeEnabled({ config: { offline: null }, env: NO_ENV })).toBe(true);
    expect(offlineModeEnabled({ config: { offline: [] }, env: NO_ENV })).toBe(true);
    expect(offlineModeEnabled({ config: { offline: "no" }, env: NO_ENV })).toBe(true);
  });

  it("goes online only when the config explicitly says so", () => {
    expect(offlineModeEnabled({ config: { offline: { enabled: false } }, env: NO_ENV })).toBe(false);
  });

  it("stays offline when the config explicitly says so", () => {
    expect(offlineModeEnabled({ config: { offline: { enabled: true } }, env: NO_ENV })).toBe(true);
  });

  it("accepts the truthy and falsy env spellings", () => {
    for (const value of ["1", "true", "TRUE", "yes", "on", " on "]) {
      expect(offlineModeEnabled({ config: { offline: { enabled: false } }, env: { OMB_OFFLINE: value } })).toBe(true);
    }
    for (const value of ["0", "false", "FALSE", "no", "off", " off "]) {
      expect(offlineModeEnabled({ config: { offline: { enabled: true } }, env: { OMB_OFFLINE: value } })).toBe(false);
    }
  });

  it("lets the env var override the stored setting in both directions", () => {
    // A one-off run must not have to edit a persisted preference, and the
    // env var is the only thing that can turn egress on for a single launch.
    expect(offlineModeEnabled({ config: { offline: { enabled: true } }, env: { OMB_OFFLINE: "0" } })).toBe(false);
    expect(offlineModeEnabled({ config: { offline: { enabled: false } }, env: { OMB_OFFLINE: "1" } })).toBe(true);
  });

  it("ignores an unrecognized env value instead of guessing", () => {
    // A typo must not silently turn egress back on; the stored setting wins.
    expect(offlineModeEnabled({ config: { offline: { enabled: false } }, env: { OMB_OFFLINE: "maybe" } })).toBe(false);
    expect(offlineModeEnabled({ config: {}, env: { OMB_OFFLINE: "" } })).toBe(true);
    expect(offlineModeEnabled({ config: {}, env: { OMB_OFFLINE: 1 } })).toBe(true);
  });
});

describe("offlinePolicy", () => {
  it("suppresses every gated background caller by default", () => {
    expect(offlinePolicy({ config: {}, env: NO_ENV })).toEqual({
      offline: true,
      updateCheckOnLaunch: false,
      hostedAccountAllowed: false,
      composioBrokerAllowed: false,
    });
  });

  it("re-enables all of them when the person opts in", () => {
    expect(offlinePolicy({ config: { offline: { enabled: false } }, env: NO_ENV })).toEqual({
      offline: false,
      updateCheckOnLaunch: true,
      hostedAccountAllowed: true,
      composioBrokerAllowed: true,
    });
  });

  it("never claims to gate analytics", () => {
    // Analytics is opt-in in the renderer, so a second gate here would only
    // make that switch look broken. Asserting its absence keeps a future
    // caller from trusting a field that does not exist.
    expect(offlinePolicy({ config: {}, env: NO_ENV })).not.toHaveProperty("analyticsAllowed");
  });
});
