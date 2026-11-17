---
"@provablehq/veil-aleo-sdk": minor
---

Add an account keystore to the `@provablehq/veil-aleo-sdk/node` entry.
`saveAccount` stores an Aleo account at `~/.aleo/accounts/<name>.json` (or in
the directory named by the `dir` option or `ALEO_ACCOUNTS_DIR`) with one of four
storage types: `plaintext` (the default, an owner-only file), `encrypted` (a
password stretched with scrypt), `keychain` (the macOS login keychain) or `none`
(the address only). `loadAccount` resolves the signing account in a fixed
order: the `privateKey` option, `ALEO_PRIVATE_KEY`, `ALEO_PRIVATE_KEY_FILE`
(with `SHIELD_SWAP_PRIVATE_KEY` and `SHIELD_SWAP_PRIVATE_KEY_FILE` as aliases),
the account file, then a caller-supplied `legacyKey`. `accountInfo` describes an
account file without reading its key, `protectAccount` changes the storage or
the password, `exportAccount` returns the stored key and `migrateAccount` copies
a key out of a legacy JSON state file. Failures are a `KeystoreError` with a
stable `code`.

The password of an encrypted account comes from the `password` option,
`ALEO_ACCOUNT_PASSWORD`, a password saved in the macOS Keychain with
`savePassword`, or a hidden terminal prompt. A key supplied through the
environment is never written to disk, and nothing in the keystore generates a
key.

`privateKeyToAccount` is now a top-level export of `@provablehq/veil-aleo-sdk`,
so deriving an account from a key no longer needs `loadNetwork()`. The method on
the `loadNetwork()` handle is unchanged.

All additions are new exports; existing behaviour is unchanged. The keystore is
Node-only and is not reachable from the package root that browsers load.
