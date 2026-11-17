---
"@provablehq/shield-swap-cli": minor
---

Store and find the `shield-swap` account through the account keystore of
`@provablehq/veil-aleo-sdk/node`, instead of keeping the private key in
`state.json`.

Every command that signs now resolves the key in one order: `ALEO_PRIVATE_KEY`,
`ALEO_PRIVATE_KEY_FILE` (with `SHIELD_SWAP_PRIVATE_KEY` and
`SHIELD_SWAP_PRIVATE_KEY_FILE` as aliases), the account file at
`~/.aleo/accounts/<name>.json`, then a key still held by an existing
`state.json`. The resolved key must derive the address recorded in `state.json`.
The account name comes from `--name`, then `ALEO_ACCOUNT`, then the name
recorded in `state.json`, then `default`.

New command `shield-swap account <create|import|show|protect|export|migrate>`
manages the account file: plaintext, encrypted, macOS Keychain or address-only
storage, import from a key file, the key variables, a recovery phrase or a
hidden prompt, and `migrate` to move a key out of an existing `state.json`. It
exits 0 when done, 1 on failure, 2 when a person is needed and 64 on a usage
error, and prints `{"name","address","storage","path"}` or
`{"error":{"code","message"}}` with `--json`.

`setup --new` now stores the generated account in the account file,
`setup --private-key-file` imports into it, and `setup` accepts `--name`.
`loadSession` and `ensureKeyMaterial` from `@provablehq/shield-swap-cli/session`
accept a `name` option, and `ShieldSwapState` gains `account`. `inventory`
still takes its key from the variable named by `privateKeyEnv` when that
variable is set, and otherwise uses the same lookup.

Changed behaviour:

- New `state.json` files hold `address` and `account` and no `privateKey`. An
  existing `state.json` with a `privateKey` keeps working and prints one line
  pointing at `shield-swap account migrate`. An earlier version of the command
  reports no session for a state file written by this one.
- A key supplied through the environment is used for the run and is no longer
  copied to disk. A setup that relied on the copy needs the variable on every
  run, or `shield-swap account import` once.
- The key variable now takes precedence over the key file variable, and a
  variable that is set but empty, or two variables holding different keys, stop
  the command.
- `saveState` creates its temporary file at mode 0600 instead of tightening it
  after the write.
