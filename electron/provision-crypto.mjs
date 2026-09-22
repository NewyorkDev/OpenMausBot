// Provisioning crypto, shared by the build-time CLI (scripts/provision-deepseek.mjs)
// and the first-launch installer (electron/deepseek-provision.mjs).
//
// It lives here, not in scripts/, because scripts/ is not part of the packaged
// app: the installer has to run inside the installed artifact, and two copies
// of a decrypt routine is exactly how they drift apart.
//
// Honest about what this is: the app decrypts the key unattended on first
// launch, so the ciphertext and the passphrase necessarily travel together in
// the installer. This stops casual exposure, not a determined attacker. What
// actually protects the key at rest is the step after — the first launch moves
// it into the OS credential store and the plaintext clears. See
// docs/deepseek-provisioning.md.
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";

/** scrypt cost parameters, stored IN the blob so an artifact built with these
 * values stays readable if the defaults ever move. */
export const KDF = { name: "scrypt", N: 1 << 15, r: 8, p: 1, keylen: 32 };
export const ALG = "aes-256-gcm";
export const FORMAT_VERSION = 1;

export function deriveKey(passphrase, salt, kdf = KDF) {
  // maxmem must cover 128*N*r; Node's default cap sits just under 2^15*8*128.
  return scryptSync(passphrase, salt, kdf.keylen, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: 256 * kdf.N * kdf.r,
  });
}

export function encryptSecret({ secret, passphrase, randomBytesImpl = randomBytes }) {
  const trimmed = typeof secret === "string" ? secret.trim() : "";
  if (!trimmed) throw new Error("No DeepSeek key supplied.");
  if (typeof passphrase !== "string" || passphrase.length < 16) {
    throw new Error("The provisioning passphrase must be at least 16 characters.");
  }
  const salt = randomBytesImpl(16);
  const iv = randomBytesImpl(12);
  const cipher = createCipheriv(ALG, deriveKey(passphrase, salt), iv);
  const ct = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
  return {
    v: FORMAT_VERSION,
    alg: ALG,
    kdf: { ...KDF, salt: salt.toString("base64") },
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ct: ct.toString("base64"),
  };
}

/** Throws on a wrong passphrase or a tampered blob — GCM authenticates. */
export function decryptSecret({ blob, passphrase }) {
  if (!blob || blob.v !== FORMAT_VERSION) throw new Error("Unsupported provisioning blob version.");
  if (blob.alg !== ALG) throw new Error("Unsupported provisioning algorithm.");
  const kdf = blob.kdf ?? {};
  const salt = Buffer.from(String(kdf.salt ?? ""), "base64");
  const iv = Buffer.from(String(blob.iv ?? ""), "base64");
  const tag = Buffer.from(String(blob.tag ?? ""), "base64");
  const ct = Buffer.from(String(blob.ct ?? ""), "base64");
  if (!salt.length || !iv.length || !tag.length || !ct.length) throw new Error("Malformed provisioning blob.");
  const params = { N: KDF.N, r: KDF.r, p: KDF.p, keylen: KDF.keylen, ...kdf };
  const decipher = createDecipheriv(ALG, deriveKey(passphrase, salt, params), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** A stable, non-reversible id, so a build log can prove WHICH key landed
 * without ever containing it. */
export function keyFingerprint(secret) {
  return createHash("sha256").update(String(secret).trim()).digest("hex").slice(0, 12);
}
