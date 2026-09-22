// The provisioning CLI's "one secret" contract.
//
// A personal build needs exactly one Actions secret — the DeepSeek key. The
// passphrase that encrypts it is optional and defaults to a constant in the
// script itself, so a forgotten passphrase can never make the baked-in key
// unrecoverable. These tests are what keeps that promise honest: if the default
// is ever changed, or the round trip stops working, the build's `encrypt` and
// the app's first-launch `decrypt` would silently disagree.
import { describe, expect, it } from "vitest";

import { encryptSecret, decryptSecret } from "../electron/provision-crypto.mjs";
import { DEFAULT_PASSPHRASE, readPassphrase } from "./provision-deepseek.mjs";

const KEY = "sk-synthetic-not-a-real-deepseek-key";

describe("the provisioning passphrase", () => {
  it("needs no second secret: an unset env falls back to the documented default", () => {
    expect(readPassphrase({})).toBe(DEFAULT_PASSPHRASE);
    expect(readPassphrase({ OMB_PROVISION_PASSPHRASE: "" })).toBe(DEFAULT_PASSPHRASE);
    expect(readPassphrase({ OMB_PROVISION_PASSPHRASE: "   " })).toBe(DEFAULT_PASSPHRASE);
  });

  it("still honours an explicit passphrase when one is set", () => {
    expect(readPassphrase({ OMB_PROVISION_PASSPHRASE: "my-own-passphrase-here" })).toBe(
      "my-own-passphrase-here",
    );
  });

  it("satisfies the encrypt() length guard, so a default build cannot fail on it", () => {
    // encryptSecret throws below 16 characters; the default must clear that bar
    // or every build without the optional secret would die at the provisioning
    // step.
    expect(DEFAULT_PASSPHRASE.length).toBeGreaterThanOrEqual(16);
    expect(() => encryptSecret({ secret: KEY, passphrase: DEFAULT_PASSPHRASE })).not.toThrow();
  });
});

describe("a build with no passphrase secret", () => {
  it("round-trips the key, so first launch can always decrypt what the build wrote", () => {
    const blob = encryptSecret({ secret: KEY, passphrase: DEFAULT_PASSPHRASE });
    expect(decryptSecret({ blob, passphrase: DEFAULT_PASSPHRASE })).toBe(KEY);
  });

  it("never carries the key in cleartext, even though the passphrase is public", () => {
    const blob = encryptSecret({ secret: KEY, passphrase: DEFAULT_PASSPHRASE });
    const serialized = JSON.stringify(blob);
    expect(serialized).not.toContain(KEY);
    expect(serialized).not.toContain("sk-");
  });

  it("is still actually encrypted: a different passphrase does not open it", () => {
    const blob = encryptSecret({ secret: KEY, passphrase: DEFAULT_PASSPHRASE });
    expect(() => decryptSecret({ blob, passphrase: "some-other-passphrase" })).toThrow();
  });
});
