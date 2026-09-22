// First-launch provisioning of the baked-in DeepSeek key.
//
// A personal build ships two extraResources beside the app:
//
//   provision/deepseek.enc.json   AES-256-GCM ciphertext of the key
//   provision/provision.key       the passphrase that decrypts it
//
// (produced by scripts/provision-deepseek.mjs; see docs/deepseek-provisioning.md)
//
// On the first packaged launch this module decrypts the key, hands it to
// config.json as { deepseek: { key } }, and records a marker. The EXISTING
// boot sweep then does the rest — secureWorkspaceConfig() →
// migrateWorkspaceCredentials() moves it into the OS-encrypted credentials.bin
// and deletes the plaintext, exactly like a key the user typed by hand. There
// is deliberately no second credential path here: one migration, already
// tested, owns the at-rest story.
//
// The marker is the whole reason "remove it in Settings" actually works.
// Provisioning happens AT MOST ONCE per installation. Once the marker exists
// this module never looks at the shipped files again, so clearing the key is a
// durable decision instead of something the next launch quietly undoes.
//
// Honest about what this buys: the passphrase travels in the same artifact as
// the ciphertext, so this defeats `strings`, an unpacked ASAR and a shared
// zip — not a person holding the installer with a hex editor. The protection
// that is real is the step after: the key ends up in DPAPI/Keychain/libsecret
// and the plaintext is gone. Never claim more than that.
import path from "node:path";

import { decryptSecret, keyFingerprint } from "./provision-crypto.mjs";

/** Matches electron-builder.yml `extraResources` `to:` for the provision files. */
export const PROVISION_DIR = "provision";
export const BLOB_FILE = "deepseek.enc.json";
export const PASSPHRASE_FILE = "provision.key";
/** Written next to credentials.bin. Presence means "do not provision again". */
export const MARKER_FILE = "deepseek-provision.json";

export const STATUS = {
  /** Marker present: already provisioned, or the user removed the key. Both
   * mean "never touch this again". */
  ALREADY: "already",
  /** A key is already stored — the user typed one, or this is an upgrade over
   * an existing profile. Record the marker and leave their key alone. */
  KEPT: "kept",
  /** The shipped files are absent. Expected in dev builds and in any build
   * that did not run the provisioning step. Not an error. */
  ABSENT: "absent",
  /** Key handed to config.json; the boot sweep will encrypt it. */
  APPLIED: "applied",
  /** Decrypt or write failed. Deliberately does NOT write the marker, so a
   * later launch retries. */
  FAILED: "failed",
};

const message = (error) => (error instanceof Error ? error.message : String(error));

function defaultLog() {}

/** Read the key out of the shipped blob. Throws on a wrong passphrase or a
 * tampered blob — GCM authenticates, so this is a real check, not a formality.
 * A missing file also throws; the caller checks first and reports ABSENT. */
export function readShippedKey({ resourcesPath, readFileSync }) {
  const dir = path.join(resourcesPath, PROVISION_DIR);
  const blob = JSON.parse(readFileSync(path.join(dir, BLOB_FILE), "utf8"));
  const passphrase = readFileSync(path.join(dir, PASSPHRASE_FILE), "utf8").trim();
  if (!passphrase) throw new Error("the shipped provisioning passphrase is empty");
  return decryptSecret({ blob, passphrase });
}

/** Atomic marker write. `status` is recorded for a human reading the file
 * later; only its EXISTENCE changes behaviour. */
function writeMarker({ markerPath, status, mkdirSync, writeFileSync, renameSync, fingerprint }) {
  mkdirSync(path.dirname(markerPath), { recursive: true });
  const body = { v: 1, status, at: new Date().toISOString() };
  if (fingerprint) body.fingerprint = fingerprint;
  const temporary = `${markerPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, markerPath);
}

/**
 * Run the one-shot provisioning. Never throws: a provisioning failure must not
 * keep the app from starting, so the caller logs the returned status.
 *
 * @param resourcesPath       Electron's process.resourcesPath
 * @param configPath          the workspace config.json the boot sweep will read
 * @param markerPath          where the one-shot marker lives (beside credentials.bin)
 * @param storedCredentials   the already-loaded encrypted store, used only to
 *                            decide whether the user ALREADY has a DeepSeek key
 * @param config              the current config.json contents, or {}
 */
export function provisionDeepSeekKey({
  resourcesPath,
  configPath,
  markerPath,
  storedCredentials = {},
  config = {},
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  decrypt = readShippedKey,
  log = defaultLog,
}) {
  const fs = { mkdirSync, writeFileSync, renameSync };

  if (existsSync(markerPath)) return { status: STATUS.ALREADY };

  const dir = path.join(resourcesPath, PROVISION_DIR);
  if (!existsSync(path.join(dir, BLOB_FILE)) || !existsSync(path.join(dir, PASSPHRASE_FILE))) {
    return { status: STATUS.ABSENT };
  }

  // The caller passes null when config.json exists but could not be understood.
  // Overwriting a config we cannot read is exactly the data loss the credential
  // sweep is careful to avoid, so stop instead of guessing.
  if (config === null) {
    log("deepseek provisioning skipped: config.json exists but is not readable");
    return { status: STATUS.FAILED, error: "config.json is not readable" };
  }

  // Someone already has a key: theirs wins, and we mark it done so the shipped
  // key can never overwrite it on a later launch.
  const existing = storedCredentials?.deepseekApiKey;
  if (typeof existing === "string" && existing.trim()) {
    writeMarker({ markerPath, status: STATUS.KEPT, ...fs });
    return { status: STATUS.KEPT };
  }

  let secret;
  try {
    secret = decrypt({ resourcesPath, readFileSync });
  } catch (error) {
    // No marker: retry next launch. A wrong passphrase fails every time, but
    // it will say so in server.log rather than failing silently.
    log(`deepseek provisioning could not decrypt the shipped key: ${message(error)}`);
    return { status: STATUS.FAILED, error: message(error) };
  }
  if (typeof secret !== "string" || !secret.trim()) {
    log("deepseek provisioning produced an empty key");
    return { status: STATUS.FAILED, error: "empty key" };
  }

  // Marker LAST: if the config write fails there is nothing to undo, and a
  // later launch simply retries the whole thing.
  // config.json holds the plaintext for exactly as long as it takes the boot
  // sweep to encrypt it; provisioning runs strictly before that sweep.
  try {
    const next = structuredClone(config ?? {});
    next.deepseek = { ...next.deepseek, key: secret.trim() };
    mkdirSync(path.dirname(configPath), { recursive: true });
    const temporary = `${configPath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, configPath);
  } catch (error) {
    log(`deepseek provisioning could not write config.json: ${message(error)}`);
    return { status: STATUS.FAILED, error: message(error) };
  }

  const fingerprint = keyFingerprint(secret);
  try {
    writeMarker({ markerPath, status: STATUS.APPLIED, fingerprint, ...fs });
  } catch (error) {
    // The key IS in config.json and the sweep will still encrypt it; only the
    // "don't do this again" guard is missing. Say so loudly.
    log(`deepseek provisioning marker could not be written: ${message(error)}`);
  }
  log(`deepseek key provisioned (fingerprint ${fingerprint})`);
  return { status: STATUS.APPLIED, fingerprint };
}
