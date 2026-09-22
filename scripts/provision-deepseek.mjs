#!/usr/bin/env node
// Bake the DeepSeek key into a personal build without ever putting it in the
// repository or in cleartext inside the installer.
//
// Two files, both written under dist-native/provision/ (git-ignored) and both
// shipped as extraResources beside the app:
//
//   deepseek.enc.json  AES-256-GCM ciphertext of the key
//   provision.key      the passphrase that decrypts it
//
// Honest about what this is: the app must decrypt the key unattended on first
// launch, so both halves necessarily travel in the artifact. It stops casual
// exposure — `strings`, an unpacked ASAR, a shared zip — not a determined
// person holding the installer. The real at-rest protection is the step after:
// the first launch moves the key into the OS credential store and clears the
// plaintext, and Settings can remove it for good. See
// electron/deepseek-provision.mjs and docs/deepseek-provisioning.md.
//
// The passphrase is OPTIONAL on purpose. A personal build needs one secret, not
// two: with OMB_PROVISION_PASSPHRASE unset we use DEFAULT_PASSPHRASE below.
// That is not weaker in any way that matters — the passphrase ships beside the
// ciphertext either way — and it means a lost or forgotten passphrase can never
// make the baked-in key unrecoverable. Nothing here is a one-way door: the key
// always ends up visible and removable in Settings, and `decrypt` prints it back
// on your own machine.
//
// Usage:
//   node scripts/provision-deepseek.mjs keygen
//   OMB_DEEPSEEK_KEY=sk-… node scripts/provision-deepseek.mjs encrypt
//   node scripts/provision-deepseek.mjs verify
//   node scripts/provision-deepseek.mjs decrypt   # recovery: prints the key
//   node scripts/provision-deepseek.mjs clean
//
// No command except `decrypt` ever prints the key; only a fingerprint, so a CI
// log is safe.
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { decryptSecret, encryptSecret, keyFingerprint } from "../electron/provision-crypto.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PROVISION_DIR = join(ROOT, "dist-native", "provision");
export const BLOB_FILE = join(PROVISION_DIR, "deepseek.enc.json");
export const PASSPHRASE_FILE = join(PROVISION_DIR, "provision.key");

/**
 * Used when OMB_PROVISION_PASSPHRASE is not set, so a personal build needs only
 * ONE Actions secret (the key itself). It is not a secret in any real sense —
 * it ships next to the ciphertext — and it is deliberately kept here in plain
 * sight so the baked-in key is always recoverable with this file alone.
 * Set OMB_PROVISION_PASSPHRASE to override it.
 */
export const DEFAULT_PASSPHRASE = "openmausbot-personal-deepseek-default";

function writeFilePrivate(path, contents) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, contents, { mode: 0o600 });
}

/** OMB_PROVISION_PASSPHRASE, or DEFAULT_PASSPHRASE when unset/blank. */
export function readPassphrase(env = process.env) {
  return (env.OMB_PROVISION_PASSPHRASE ?? "").trim() || DEFAULT_PASSPHRASE;
}

export function main(argv, env = process.env) {
  const command = argv[0] ?? "";
  if (command === "keygen") {
    // base64url of 32 bytes: no shell quoting problems and no ambiguity.
    process.stdout.write(`${randomBytesBase64url()}\n`);
    return 0;
  }
  if (command === "clean") {
    // Never leave key material on a shared or ephemeral build host.
    rmSync(PROVISION_DIR, { recursive: true, force: true });
    process.stdout.write(`removed ${PROVISION_DIR}\n`);
    return 0;
  }
  if (command === "encrypt") {
    const passphrase = readPassphrase(env);
    const blob = encryptSecret({ secret: env.OMB_DEEPSEEK_KEY ?? "", passphrase });
    writeFilePrivate(BLOB_FILE, `${JSON.stringify(blob, null, 2)}\n`);
    writeFilePrivate(PASSPHRASE_FILE, `${passphrase}\n`);
    process.stdout.write(
      `wrote ${BLOB_FILE}\nwrote ${PASSPHRASE_FILE}\nkey fingerprint ${keyFingerprint(env.OMB_DEEPSEEK_KEY)}\n`,
    );
    return 0;
  }
  if (command === "verify" || command === "decrypt") {
    const recovered = decryptSecret({ blob: JSON.parse(readFileSync(BLOB_FILE, "utf8")), passphrase: readPassphrase(env) });
    if (command === "decrypt") process.stdout.write(`${recovered}\n`);
    else process.stdout.write(`ok: blob decrypts; key fingerprint ${keyFingerprint(recovered)}\n`);
    return 0;
  }
  throw new Error("Expected one of: keygen, encrypt, verify, decrypt, clean");
}

function randomBytesBase64url() {
  // base64url of 32 bytes: 256 bits, no shell quoting problems.
  return randomBytes(32).toString("base64url");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
