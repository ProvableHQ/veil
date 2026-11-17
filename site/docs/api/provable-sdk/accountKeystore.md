---
sidebar_position: 15
---

# Account keystore

The `@provablehq/veil-aleo-sdk/node` entry stores an Aleo account in a file and
resolves it again on later runs, so a bot or script does not carry its own
key-handling code. It is Node-only: it reads files and the environment, runs the
macOS `security` tool, and may prompt on the terminal. The package root has none
of it, and a browser application uses the connected wallet instead.

Creating a key and storing it are separate calls. The existing functions create
the key in memory; `saveAccount` stores it and `loadAccount` finds it:

```ts
import { generateAccount, loadNetwork } from '@provablehq/veil-aleo-sdk'
import { loadAccount, saveAccount } from '@provablehq/veil-aleo-sdk/node'

// Once: create a key in memory, then store it.
const stored = await saveAccount(generateAccount())
stored.path // '/home/alice/.aleo/accounts/default.json'

// On every run: resolve the account, then build the client from its key.
const { account, source } = await loadAccount()
const aleo = await loadNetwork('testnet')
const { walletClient } = aleo.createAleoClient({ privateKey: account.privateKey })
```

| Function | Effect |
| --- | --- |
| `saveAccount(account, options?)` | Stores an account. Never replaces an existing account file. |
| `loadAccount(options?)` | Resolves the signing account through the lookup order below. Never generates or stores a key. |
| `accountInfo(options?)` | Returns the name, path, address and storage type of an account file, or `undefined` when none exists. Never reads the key. |
| `protectAccount(options)` | Changes how an existing account file holds its key, or sets a new password. |
| `exportAccount(options?)` | Returns the private key held by the account file. |
| `migrateAccount(options)` | Copies a key out of a legacy JSON state file into an account file. |

Every function takes `name` and `dir` to select the account file, and every
failure the keystore detects is a `KeystoreError` with a stable `code`. A file
system error on the account file or its directory, other than a missing file,
propagates unchanged: permission denied, for example.

## Account file

An account lives at `<dir>/<name>.json`.

- `name` comes from the `name` option, then `ALEO_ACCOUNT`, then `default`. It
  MUST match `^[a-z0-9][a-z0-9_-]{0,63}$`.
- `dir` comes from the `dir` option, then `ALEO_ACCOUNTS_DIR`, then
  `~/.aleo/accounts`. A leading `~` expands to the home directory.

The file is network-neutral: one account serves testnet and mainnet. Named
accounts (`testnet`, `mainnet`) keep keys apart for a caller who wants that.
Nothing is written until `saveAccount`, `protectAccount` or `migrateAccount` is
called. The directory is created with mode 0700 and the file with mode 0600,
written through a temporary file and a rename. A file found with wider access is
tightened to 0600 when it is read. File modes are not enforced on Windows.

The `storage` option selects one of four forms:

| `storage` | Where the key is | Notes |
| --- | --- | --- |
| `'plaintext'` | In the account file. | The default. Protected by file permissions only. |
| `'encrypted'` | In the account file, encrypted under a password. | The password is stretched with scrypt (`N = 131072`, `r = 8`, `p = 1`) before it encrypts the key. Works on every system. |
| `'keychain'` | In the macOS login keychain, as the generic password `aleo-account-key` for the address, labelled `aleo-account-key:<name>` so Keychain Access shows which account it belongs to. | macOS only. Nothing secret is on disk, and no other copy of the key exists. Elsewhere, saving fails before anything is written and loading fails with `KEYCHAIN_UNAVAILABLE`. |
| `'none'` | Nowhere. The file records the address only. | The key comes from the environment on every run, and the file confirms it is the expected account. |

A plaintext file, complete:

```json
{
  "version": 1,
  "address": "aleo1...",
  "key": {
    "type": "plaintext",
    "privateKey": "APrivateKey1..."
  }
}
```

The other forms differ in `key` only: `{ "type": "none" }`,
`{ "type": "keychain", "service": "aleo-account-key", "account": "aleo1..." }`,
and `{ "type": "encrypted", "kdf": "scrypt", "kdfParams": { "N", "r", "p",
"salt" }, "ciphertext": "ciphertext1..." }`. The file is UTF-8 JSON with
two-space indentation and one trailing newline. A reader rejects a file with a
missing or unknown field, an unknown `version` or an unknown `key.type`; it never
falls back to another source.

`saveAccount` on an existing account file returns without rewriting when the
address and storage are the same, and fails with `ACCOUNT_EXISTS` otherwise.
`protectAccount` is the call that changes storage:

```ts
import { protectAccount } from '@provablehq/veil-aleo-sdk/node'

// Encrypt a plaintext account. On macOS, savePassword keeps the password in
// the Keychain so later loads need none.
await protectAccount({ storage: 'encrypted', password, savePassword: true })
```

`protectAccount` writes the new storage, reads it back, and only then removes
the old secret. It does not move an account to `'none'`, which would delete the
only stored copy of the key.

`migrateAccount` serves a tool that used to keep the key in its own JSON state
file, in a top-level `privateKey` or `private_key` field. It stores that key as
`saveAccount` would and leaves the state file untouched, so a plaintext copy
remains there. With `removeLegacyKey: true` it reads the new account back first
and then rewrites the state file without the key field, keeping the other
fields, their order and the indentation, at mode 0600:

```ts
import { migrateAccount } from '@provablehq/veil-aleo-sdk/node'

const { address, legacyKeyRemoved } = await migrateAccount({
  from: './state.json',
  removeLegacyKey: true,
})
```

## Lookup order

`loadAccount` resolves the key from the first source that supplies one and
reports it as `source`:

1. The `privateKey` option (`'argument'`). The variables below are then not read.
2. `ALEO_PRIVATE_KEY`, then its alias `SHIELD_SWAP_PRIVATE_KEY` (`'env'`).
3. The file named by `ALEO_PRIVATE_KEY_FILE`, then its alias
   `SHIELD_SWAP_PRIVATE_KEY_FILE`: a text file holding only the key
   (`'env-file'`).
4. The selected account file (`'account-file'`).
5. The `legacyKey` option, a key the calling tool read from its own earlier
   state, used only when no account file exists (`'legacy'`).

- A variable that is set but empty, or that names an empty or unreadable file,
  fails with `EMPTY_KEY_SOURCE`. Variables that hold different keys fail with
  `KEY_CONFLICT`.
- When the selected account file exists, a key from sources 1, 2, 3 or 5 MUST
  derive the address the file records, or the call fails with
  `ADDRESS_MISMATCH`. `expectedAddress` applies the same check against an
  address the caller already holds.
- A key from the environment is used for the process and is never written to
  disk.
- With no source at all the call fails with `ACCOUNT_NOT_FOUND`. With a
  `'none'` account file and no key from sources 1 to 3 it fails with
  `KEY_NOT_STORED`.

`exportAccount` and `protectAccount` read the account file only and ignore the
key variables.

## Passwords

The password of an encrypted account comes from the first of:

1. The `password` option.
2. `ALEO_ACCOUNT_PASSWORD`.
3. The macOS Keychain (generic password `aleo-account-password` for the
   address), when the password was stored with `savePassword: true`.
4. A hidden prompt on the terminal, when standard input and standard error are
   both terminals and `prompt` is not `false`.

A wrong password from sources 1 to 3 fails with `WRONG_PASSWORD` and does not
fall through to the next source. The prompt allows three attempts. With no
source the call fails with `PASSWORD_REQUIRED`, so an unattended job relies on
the variable or the Keychain; pass `prompt: false` there.

A new password comes from the `password` option, then `ALEO_ACCOUNT_PASSWORD`,
then a prompt that asks twice. Replacing the password of an account that is
already encrypted takes the new one from `newPassword` or the prompt only.
Passwords are normalised to Unicode NFKC, and an empty password is rejected.

## Errors

`KeystoreError` extends `BaseError` from `@provablehq/veil-core`. Branch on
`code`; messages name addresses and paths and never contain a key or a password.

```ts
import { KeystoreError, loadAccount } from '@provablehq/veil-aleo-sdk/node'

try {
  await loadAccount({ prompt: false })
} catch (error) {
  if (error instanceof KeystoreError && error.code === 'ACCOUNT_NOT_FOUND') {
    // No key in the environment and no account file: create or import one.
  } else throw error
}
```

| Code | Cause |
| --- | --- |
| `ACCOUNT_NOT_FOUND` | No source in the lookup order produced a key, or the account file to change or export does not exist. |
| `KEY_NOT_STORED` | The account file records an address only and no key came from the environment. |
| `ACCOUNT_EXISTS` | Saving would replace an existing account file. |
| `ADDRESS_MISMATCH` | A key does not derive the address of the account file, the expected address or the Keychain entry. |
| `KEY_CONFLICT` | Two key variables hold different keys, or a legacy state file holds two different keys. |
| `EMPTY_KEY_SOURCE` | A key variable is set but empty, or its file is empty or unreadable. |
| `INVALID_KEY` | A key string is not an Aleo private key. |
| `INVALID_NAME` | The account name does not match the pattern. |
| `INVALID_ACCOUNT_FILE` | The account file is not valid JSON or breaks the format. |
| `UNSUPPORTED_VERSION` | The account file has an unknown `version`. |
| `UNSUPPORTED_STORAGE` | The account file or the `storage` option names an unknown storage. |
| `KEYCHAIN_UNAVAILABLE` | Keychain storage was requested, or met in an account file, outside macOS. |
| `KEYCHAIN_ITEM_NOT_FOUND` | The account file points at a Keychain entry that no longer exists. |
| `KEYCHAIN_FAILED` | The macOS `security` tool failed for another reason. |
| `PASSWORD_REQUIRED` | An encrypted account and no usable password source, or an empty password. |
| `WRONG_PASSWORD` | The password did not decrypt the key. |
| `LEGACY_KEY_NOT_FOUND` | The file given to `migrateAccount` holds no key. |

`INVALID_MNEMONIC` and `TERMINAL_REQUIRED` are part of the same code set and are
reserved for command-line tools built on these functions; no function in this
package throws them.

## What storage protects

Encryption and the Keychain protect the key at rest: a copied file, a backup, a
synced folder, a file committed by mistake. They do not stop another process
running as the same user, which reads the Keychain entry or the password
variable as this package does. `exportAccount` returns the key itself; print it
only for a person at a terminal.
