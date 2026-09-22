# Baked-in DeepSeek key (personal builds)

The default OpenMausBot build ships DeepSeek as a *selectable engine* but with no
credential. A personal build can go further and have the key already filled in,
so a fresh install is working before anyone opens Settings.

> **You do not have to do this.** The easiest setup needs no build-time secret at
> all: build the installer, open **Settings → API keys → DeepSeek**, and paste the
> key. It goes straight into the OS credential store (DPAPI / Keychain) and is
> removable there — exactly the same at-rest protection as the baked-in path.
> Everything below is only for pre-filling it so a fresh install works before you
> open Settings.

This document describes that path honestly, including what it does **not**
protect against.

## What ships

Two files go into the installer as `extraResources`, landing beside the app at:

| Platform | Path |
| --- | --- |
| macOS | `OpenMausBot.app/Contents/Resources/provision/` |
| Windows | `resources\provision\` |

- `deepseek.enc.json` — the key, AES-256-GCM encrypted
- `provision.key` — the passphrase that decrypts it

Both are produced at build time and **never committed**. `dist-native/` is
git-ignored. See `.github/workflows/personal-build.yml`.

## What actually happens on first launch

1. `electron/deepseek-provision.mjs` reads the blob, derives a key with scrypt,
   decrypts, and writes the plaintext into `config.json` as
   `{ "deepseek": { "key": "…" } }`.
2. It writes a marker next to `credentials.bin`
   (`deepseek-provision.json`).
3. The existing boot sweep — `secureWorkspaceConfig()` calling
   `migrateWorkspaceCredentials()` in `electron/workspace-credentials.mjs` —
   moves the key into the OS-encrypted `credentials.bin` (DPAPI on Windows,
   Keychain on macOS, libsecret on Linux) and **deletes the plaintext field**.
4. From then on the shell hands the key to the server as `DEEPSEEK_API_KEY` at
   spawn, the same way every other workspace credential travels.

There is deliberately no second credential path: the provisioning step only
stages plaintext for the one migration that already exists and is already
tested.

## Removing the key

Settings → API keys → DeepSeek, clear the field. That goes through the ordinary
`credential:set` path, which removes the entry from the encrypted store.

**The marker is what makes removal stick.** Provisioning runs *at most once per
installation*: the moment the marker exists, the shipped blob is never read
again. Without that marker the next launch would silently re-inject the key and
"remove it" would be a lie.

To make a build that re-provisions, delete the marker and reinstall.

## What this protects against — and what it does not

**Does:** `strings` on the installer, an unpacked ASAR, a zip you hand to
someone, and a CI log (the build prints only a SHA-256 fingerprint).

**Does not:** a person holding the installer. The app has to decrypt the key
unattended on first launch, so the passphrase necessarily travels in the same
artifact. Anyone with the installer can recover the key with a few lines of
Node. This is obfuscation with real cryptographic hygiene, not secrecy against a
determined holder.

The protection that *is* real is the one after: once first launch completes, the
key is in the OS credential store and out of the shipped blob's reach. The
artifact is only as good as where you keep it, so keep personal installers to
yourself — which is also what the licence expects.

## Building one

**First choice: build with no secrets and paste the key in Settings.** Run
**Actions → Personal build → Run workflow**; with `OMB_DEEPSEEK_KEY` unset the
build simply skips the baking step and still produces a working installer. Then
paste the key into Settings on each machine.

**If you would rather pre-fill it**, add one secret to your own fork or private
copy of the repo:

| Secret | Value |
| --- | --- |
| `OMB_DEEPSEEK_KEY` | `sk-…` from <https://platform.deepseek.com/api_keys> |

That is the only one. `OMB_PROVISION_PASSPHRASE` is **optional**: leave it unset
and the build uses `DEFAULT_PASSPHRASE` from `scripts/provision-deepseek.mjs`.
Since the passphrase ships beside the ciphertext either way, requiring a second
secret would only add a way to lose access to your own key.

Pick the macOS architecture (`arm64` for an M-series Mac) and download the
artifacts when the run finishes. Nothing is published to a release feed.

For a local build instead:

```sh
export OMB_DEEPSEEK_KEY=sk-…
node scripts/provision-deepseek.mjs encrypt
pnpm package:win     # or: pnpm package:mac
node scripts/provision-deepseek.mjs clean
```

Set `OMB_PROVISION_PASSPHRASE` first if you want your own passphrase rather than
the default.

`clean` is not optional on a shared machine: it deletes `dist-native/provision/`
so no key material is left behind. The CI workflow runs it with `if: always()`.

### CLI reference

```sh
node scripts/provision-deepseek.mjs keygen    # generate a passphrase
node scripts/provision-deepseek.mjs encrypt   # needs OMB_DEEPSEEK_KEY
node scripts/provision-deepseek.mjs verify    # decrypt and print a fingerprint only
node scripts/provision-deepseek.mjs decrypt   # recovery: prints the actual key
node scripts/provision-deepseek.mjs clean     # remove dist-native/provision/
```

Every command except `decrypt` prints only a fingerprint, so its output is safe
to paste into an issue. `decrypt` exists so the baked-in key can never become
unrecoverable — use it only on a machine you trust.

### Recovering the key

Nothing in this design is one-way:

- the passphrase defaults to a constant that lives in `scripts/provision-deepseek.mjs`,
  so it is never lost;
- `decrypt` prints the key back out of the blob on your own machine;
- after first launch the key is readable and removable in **Settings → API keys → DeepSeek**.

Removing the key is not the same as destroying it — you can always paste it back
in, or re-run the build.

## Failure behaviour

Provisioning never stops the app from starting, and it is deliberately loud in
`server.log` rather than silent:

| Situation | Result |
| --- | --- |
| No `provision/` files (dev build, public build) | `absent`, no-op |
| Passphrase or blob wrong | `failed`, **no marker**, retries next launch |
| `config.json` exists but is unparseable | `failed`, refuses to overwrite it |
| A DeepSeek key is already stored | `kept`, records the marker, key untouched |
| Marker already present | `already`, never touches the blob again |

## Defaults the shipped engine uses

From `server/config.ts`:

- driver `openai-compat` (DeepSeek speaks the OpenAI chat-completions contract)
- endpoint `https://api.deepseek.com/v1`
- key env `DEEPSEEK_API_KEY`, its own config section — it can never inherit the
  workspace `openaiCompat` URL or the OpenRouter key
- models `deepseek-reasoner` (default) and `deepseek-chat`, listed as
  `managedModels` so the driver does not call `GET /models` at all

A key set in Settings overrides the baked-in one, and `DEEPSEEK_API_KEY` /
`DEEPSEEK_URL` / `DEEPSEEK_MODEL` in the environment override both.
