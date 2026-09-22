// The first-launch provisioning contract.
//
// Two properties matter more than the happy path, and each has its own test
// block below:
//
//   one-shot   provisioning must happen AT MOST ONCE per installation, or the
//              "remove the key in Settings" promise is a lie that gets undone
//              on the very next launch.
//   no loss    a failure to decrypt, or a config.json we cannot read, must not
//              touch the user's existing state, and must not write the marker
//              so a later launch can retry.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MARKER_FILE, STATUS, provisionDeepSeekKey } from "./deepseek-provision.mjs";
import { encryptSecret, keyFingerprint } from "./provision-crypto.mjs";
import { migrateWorkspaceCredentials } from "./workspace-credentials.mjs";

const KEY = "sk-deepseek-test-000000000000000000000000";
const PASSPHRASE = "correct horse battery staple";

const dirs = [];
function scratch() {
  const root = mkdtempSync(join(tmpdir(), "omb-deepseek-"));
  dirs.push(root);
  return root;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

/** A packaged-app layout: resources/provision/* plus a data dir. */
function layout({ withShipped = true, passphrase = PASSPHRASE, secret = KEY } = {}) {
  const root = scratch();
  const resourcesPath = join(root, "resources");
  const dataDir = join(root, "data");
  const userData = join(root, "userData");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(userData, { recursive: true });
  if (withShipped) {
    mkdirSync(join(resourcesPath, "provision"), { recursive: true });
    writeFileSync(
      join(resourcesPath, "provision", "deepseek.enc.json"),
      JSON.stringify(encryptSecret({ secret, passphrase }), null, 2),
    );
    writeFileSync(join(resourcesPath, "provision", "provision.key"), `${passphrase}\n`, { mode: 0o600 });
  }
  return {
    resourcesPath,
    configPath: join(dataDir, "config.json"),
    markerPath: join(userData, MARKER_FILE),
    readConfig: () => JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")),
    writeConfig: (value) => writeFileSync(join(dataDir, "config.json"), JSON.stringify(value)),
  };
}

const run = (env, overrides = {}) =>
  provisionDeepSeekKey({
    resourcesPath: env.resourcesPath,
    configPath: env.configPath,
    markerPath: env.markerPath,
    storedCredentials: {},
    config: existsSync(env.configPath) ? env.readConfig() : {},
    readFileSync,
    writeFileSync,
    existsSync,
    mkdirSync,
    renameSync: (from, to) => writeFileSync(to, readFileSync(from)),
    log: () => {},
    ...overrides,
  });

describe("provisionDeepSeekKey", () => {
  it("is a no-op when no provision files were shipped", () => {
    // A dev launch, or a build that skipped the provisioning step. Not an
    // error, and crucially it does not create config.json out of nothing.
    const env = layout({ withShipped: false });
    expect(run(env).status).toBe(STATUS.ABSENT);
    expect(existsSync(env.configPath)).toBe(false);
    expect(existsSync(env.markerPath)).toBe(false);
  });

  it("injects the shipped key and leaves everything else in config.json alone", () => {
    const env = layout();
    env.writeConfig({ offline: { enabled: true }, xai: { url: "https://api.x.ai/v1" } });

    const result = run(env);

    expect(result.status).toBe(STATUS.APPLIED);
    expect(result.fingerprint).toBe(keyFingerprint(KEY));
    const config = env.readConfig();
    expect(config.deepseek.key).toBe(KEY);
    // The user's other settings survive the merge.
    expect(config.offline).toEqual({ enabled: true });
    expect(config.xai).toEqual({ url: "https://api.x.ai/v1" });
  });

  it("creates config.json when the install has none yet", () => {
    const env = layout();
    expect(run(env).status).toBe(STATUS.APPLIED);
    expect(env.readConfig().deepseek.key).toBe(KEY);
  });

  it("is one-shot: a second call never reads the shipped files again", () => {
    // The load-bearing test for "remove it in Settings". After the first
    // launch — and after the user clears the key — provisioning must stay
    // silent forever.
    const env = layout();
    expect(run(env).status).toBe(STATUS.APPLIED);

    // Simulate the user removing the key, and the shipped blob changing.
    env.writeConfig({ deepseek: {} });
    writeFileSync(env.configPath, JSON.stringify({ deepseek: {} }));
    const second = run(env);
    expect(second.status).toBe(STATUS.ALREADY);
    expect(env.readConfig()).toEqual({ deepseek: {} });
  });

  it("never overwrites a key the user already has", () => {
    const env = layout();
    env.writeConfig({});
    const result = run(env, { storedCredentials: { deepseekApiKey: "sk-user-typed" } });
    expect(result.status).toBe(STATUS.KEPT);
    // Their key is untouched, and the marker stops the shipped one forever.
    expect(env.readConfig()).toEqual({});
    expect(existsSync(env.markerPath)).toBe(true);
    expect(run(env).status).toBe(STATUS.ALREADY);
  });

  it("retries after a bad passphrase instead of latching a failure", () => {
    const env = layout();
    // Encrypt with the real passphrase, then ship the wrong one — an artifact
    // built from a stale secret.
    writeFileSync(join(env.resourcesPath, "provision", "provision.key"), "a-different-passphrase\n");
    expect(run(env).status).toBe(STATUS.FAILED);
    // No marker: the next launch tries again with the corrected artifact.
    expect(existsSync(env.markerPath)).toBe(false);
    expect(existsSync(env.configPath)).toBe(false);
  });

  it("refuses to replace a config.json it cannot parse", () => {
    const env = layout();
    env.writeConfig({});
    const result = run(env, { config: null });
    expect(result.status).toBe(STATUS.FAILED);
    expect(existsSync(env.markerPath)).toBe(false);
    expect(env.readConfig()).toEqual({});
  });

  it("rejects a tampered blob rather than injecting junk", () => {
    const env = layout();
    const blobPath = join(env.resourcesPath, "provision", "deepseek.enc.json");
    const blob = JSON.parse(readFileSync(blobPath, "utf8"));
    blob.ct = Buffer.from("something else entirely").toString("base64");
    writeFileSync(blobPath, JSON.stringify(blob));

    expect(run(env).status).toBe(STATUS.FAILED);
    expect(existsSync(env.markerPath)).toBe(false);
  });

  it("writes no plaintext key into the marker", () => {
    const env = layout();
    run(env);
    const marker = readFileSync(env.markerPath, "utf8");
    expect(marker).not.toContain(KEY);
    expect(marker).not.toContain("sk-");
    expect(JSON.parse(marker).fingerprint).toBe(keyFingerprint(KEY));
  });

  it("hands the key to the existing boot sweep, which encrypts it and clears the plaintext", () => {
    // The handoff between the two modules is the part no unit test covers:
    // provisioning only stages plaintext, and secureWorkspaceConfig() is what
    // actually moves it into credentials.bin. If the field name or section
    // drifted, the key would sit in config.json forever.
    const env = layout();
    expect(run(env).status).toBe(STATUS.APPLIED);

    const migrated = migrateWorkspaceCredentials(env.readConfig(), {});
    expect(migrated.credentialsChanged).toBe(true);
    expect(migrated.credentials.deepseekApiKey).toBe(KEY);
    // ...and the plaintext is DELETED, not blanked, so the store stays
    // authoritative on the next boot.
    expect(migrated.configChanged).toBe(true);
    expect(migrated.config.deepseek ?? {}).not.toHaveProperty("key");
    expect(JSON.stringify(migrated.config)).not.toContain(KEY);
    // Running the sweep again is a no-op.
    const again = migrateWorkspaceCredentials(migrated.config, migrated.credentials);
    expect(again.configChanged).toBe(false);
    expect(again.credentialsChanged).toBe(false);
  });
});
