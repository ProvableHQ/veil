# Sealevel `TransferRemote` reference facts

Pinned facts about Hyperlane's Sealevel (Solana) warp-route program that the
Solana→Aleo SOL Hyperlane deposit implementation (Tasks 4, 5, 7) builds on.
Every fact below carries a primary source: a GitHub permalink pinned to a
commit hash, or a mainnet RPC call whose response is reproducible.

Two source pools are used throughout:

- **hyperlane-monorepo** at commit
  [`45c0988962fd0c931fc18221bd21c60f458dd732`](https://github.com/hyperlane-xyz/hyperlane-monorepo/tree/45c0988962fd0c931fc18221bd21c60f458dd732)
  (fetched 2026-08-28; `main` HEAD at fetch time).
- **A real mainnet deposit** on the deployed SOL warp route program
  `8YGT2pZwyZe94qBpGzWfY2TMEVcwaQ1bXAE7YAgpUaM7` (address already cited in
  `packages/bridge/src/registry/default.ts:278`, `ALEO_SOL_REMOTE_ROUTER_SOURCE`
  at line 62): transaction
  [`cWFKiumuvVuvrxM8xtunZxNM4FNUppSdyNm7HEqKjV3ZmENebD4DAf44kbyvq9fKJ61VzNrH3tYpLJgUrY8MEGW`](https://explorer.solana.com/tx/cWFKiumuvVuvrxM8xtunZxNM4FNUppSdyNm7HEqKjV3ZmENebD4DAf44kbyvq9fKJ61VzNrH3tYpLJgUrY8MEGW),
  slot 442407364, fetched via `getTransaction` on `https://api.mainnet-beta.solana.com`
  with `{"encoding":"json","maxSupportedTransactionVersion":0}`. Captured
  verbatim in `packages/bridge/test/fixtures/sealevel-transfer-remote.json`.

This route's registry config is the same file already cited in
`packages/bridge/src/registry/default.ts:63` —
[`hyperlane-registry` commit `418056e2`, `deployments/warp_routes/SOL/aleo-config.yaml`](https://github.com/hyperlane-xyz/hyperlane-registry/blob/418056e21734d26a7d14692e0ec5e902cc9e86bf/deployments/warp_routes/SOL/aleo-config.yaml).
It confirms: warp program `8YGT2pZwyZe94qBpGzWfY2TMEVcwaQ1bXAE7YAgpUaM7` on
`chainName: solanamainnet`, `standard: SealevelHypNative`, `tokenType: native`,
`decimals: 9` — i.e. this is the **native-collateral** (`SealevelHypNativeAdapter`)
program family, not an SPL-collateral or synthetic one. All facts below are
for that family.

The primary sources used are the current locations of the files the task
brief named (paths moved since the brief was written; noted per section):

- `typescript/sdk/src/token/adapters/SealevelTokenAdapter.ts` — same path as
  the brief; contains `SealevelHypNativeAdapter` and
  `getTransferInstructionKeyList` / `getTransferRemoteIxBundle` (the code the
  brief calls `populateTransferRemoteTx`, which now wraps these two).
- Rust instruction/processor logic for the shared token library moved out of
  `rust/sealevel/programs/hyperlane-sealevel-token/` (which now holds only the
  synthetic-token program binary + its `plugin.rs`) into
  `rust/sealevel/libraries/hyperlane-sealevel-token/src/{instruction.rs,processor.rs,accounts.rs}`.
  The native-collateral plugin lives in
  `rust/sealevel/programs/hyperlane-sealevel-token-native/src/plugin.rs`.
- `typescript/sdk/src/gas/adapters/SealevelIgpAdapter.ts` — same path as the
  brief; PDA derivation only (the actual quote formula is server-side, in
  `rust/sealevel/programs/hyperlane-sealevel-igp/src/accounts.rs`).

---

## 1. `TransferRemote` instruction data — byte layout

**Discriminator + Borsh enum.** The instruction wire format is:

```
[8 bytes: 0x01 x8]  [1 byte: 0x01]  [4 bytes LE: destination_domain]  [32 bytes: recipient]  [32 bytes LE: amount_or_id]
```

Total: 77 bytes. All fields little-endian; no padding.

- Bytes `[0..8]` — `PROGRAM_INSTRUCTION_DISCRIMINATOR = [1,1,1,1,1,1,1,1]`, defined in
  [`rust/sealevel/libraries/account-utils/src/discriminator.rs:8`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/rust/sealevel/libraries/account-utils/src/discriminator.rs#L8).
  It prefixes **every** instruction for **every** Sealevel Hyperlane program
  (not TransferRemote-specific) — `DiscriminatorEncode::encode()` at
  [`discriminator.rs:196-207`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/rust/sealevel/libraries/account-utils/src/discriminator.rs#L196-L207)
  writes `Self::DISCRIMINATOR_SLICE` then `borsh::to_vec(&self)`. On the TS
  side this is hardcoded (not derived) as
  `Buffer.from([1, 1, 1, 1, 1, 1, 1, 1])` at
  [`SealevelTokenAdapter.ts:1097-1100`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/typescript/sdk/src/token/adapters/SealevelTokenAdapter.ts#L1097-L1100),
  with a comment linking the historical rationale
  (`hyperlane-xyz/issues#462`, comment 1587859359).
- Byte `[8]` — `0x01`, the Borsh enum variant tag for `Instruction::TransferRemote`.
  Borsh encodes a fieldless-payload enum tag as a single `u8` equal to the
  variant's declaration order (0-based). The `Instruction` enum is defined at
  [`rust/sealevel/libraries/hyperlane-sealevel-token/src/instruction.rs:24-46`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/rust/sealevel/libraries/hyperlane-sealevel-token/src/instruction.rs#L24-L46):
  `Init=0`, `TransferRemote=1`, `EnrollRemoteRouter=2`, …, `TransferRemoteWithMemo=8`,
  `SetFeeConfig=9`. The TS mirror
  (`SealevelHypTokenInstruction.TransferRemote = 1`) is at
  [`typescript/sdk/src/token/adapters/serialization.ts:209-218`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/typescript/sdk/src/token/adapters/serialization.ts#L209-L218).
- Bytes `[9..13]` — `destination_domain: u32`, little-endian. Field defined on
  `struct TransferRemote` at
  [`instruction.rs:67-76`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/rust/sealevel/libraries/hyperlane-sealevel-token/src/instruction.rs#L67-L76).
  For this route, `1634493807` (Aleo mainnet's Hyperlane domain, already in
  `registry/default.ts:14`).
- Bytes `[13..45]` — `recipient: H256`, 32 raw bytes, no byte-reversal. `H256`
  is `fixed_hash`'s `[u8; 32]` newtype; its `#[derive(BorshSerialize)]` writes
  the array in stored order (see `hyperlane-core`'s
  [`primitive_types.rs`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/rust/main/hyperlane-core/src/types/primitive_types.rs)
  derives). On the TS side this is `padBytesToLength(addressToBytes(recipient), 32)`
  at [`SealevelTokenAdapter.ts:1088`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/typescript/sdk/src/token/adapters/SealevelTokenAdapter.ts#L1088).
  **Confirmed against Aleo's bech32m decoding** — see §6 below.
- Bytes `[45..77]` — `amount_or_id: U256`, little-endian, 32 bytes.
  `hyperlane_core::U256` is `uint::construct_uint!` with
  `#[derive(BorshSerialize, BorshDeserialize)]` at
  [`primitive_types.rs:34-37`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/rust/main/hyperlane-core/src/types/primitive_types.rs#L34-L37):
  a `[u64; 4]` little-endian limb array (limb 0 = least-significant), and
  Borsh's derive serializes the tuple field verbatim — i.e. the full 32-byte
  value is little-endian. Matches the TS schema's `'u256'` field at
  [`serialization.ts:269`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/typescript/sdk/src/token/adapters/serialization.ts#L263-L272).

**Empirical confirmation.** The real deposit's instruction data (base64 in
the fixture, `instructionDataBase64`) decodes to exactly this layout:

```
0101010101010101 | 01 | 6f656c61 | 1c3496991e7c611ced5ee5cd0cdee969c53efc8a5497ae050819b1ef00ed2912 | 002aa9709d000000000000000000000000000000000000000000000000000000
└── discriminator ┘   │   └domain──┘ └───────────────────── recipient (32 bytes) ─────────────────────┘ └──────────────────── amount_or_id (32 bytes, LE) ────────────────────┘
     (8 bytes)         └tag=1        u32 LE = 0x616c656f = 1,634,493,807                                  = 676,200,000,000
                        (TransferRemote)
```

Byte offsets: discriminator `[0..8)`, tag `[8..9)`, domain `[9..13)`,
recipient `[13..45)`, amount `[45..77)` — 77 bytes total, no trailing bytes.
The decoded `remote_amount` matches the transaction log line
`"Warp route transfer completed to destination: 1634493807, recipient:
0x1c34…2912, remote_amount: 676200000000"` verbatim (truncated recipient
form — see §5 for why the log abbreviates it).

---

## 2. Ordered account list — native-collateral `TransferRemote`

Confirmed against **both** the shared account-consumption order documented at
[`processor.rs:293-320`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/rust/sealevel/libraries/hyperlane-sealevel-token/src/processor.rs#L293-L320)
(`transfer_remote_to`, called by `transfer_remote_with_memo`, which the
plain `TransferRemote` variant we decoded also dispatches to — the native
program's top-level dispatcher wraps it as
`TransferRemoteWithMemo { xfer, memo: vec![] }` before calling the same
handler, at
[`hyperlane-sealevel-token-native/src/processor.rs:75-82`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/rust/sealevel/programs/hyperlane-sealevel-token-native/src/processor.rs#L75-L82))
plus the native-plugin accounts appended in
[`hyperlane-sealevel-token-native/src/plugin.rs:115-158`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/rust/sealevel/programs/hyperlane-sealevel-token-native/src/plugin.rs#L115-L158)
(`transfer_in`), the TS builder
[`SealevelTokenAdapter.ts:1180-1281`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/typescript/sdk/src/token/adapters/SealevelTokenAdapter.ts#L1180-L1281)
(base list) + `SealevelHypNativeAdapter.getTransferInstructionKeyList` at
[`SealevelTokenAdapter.ts:1470-1484`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/typescript/sdk/src/token/adapters/SealevelTokenAdapter.ts#L1470-L1484)
(native override), and **the real transaction's account list** (fixture
`accounts[]`, order preserved). This deposit's token has no `fee_config` (no
fee section spliced in — token.fee_config is None for this route) and its
configured IGP is an `OverheadIgp` in Legacy (non-quoted) mode, so the IGP
section has both the optional overhead slot and the terminal inner-IGP slot.

| # | Role | Real address (this tx) | Signer | Writable | Static/per-transfer |
|---|------|------------------------|--------|----------|----------------------|
| 0 | System program | `11111111111111111111111111111111` | no | no | **Universal constant** |
| 1 | SPL Noop program | `noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV` | no | no | **Universal constant** (`SEALEVEL_SPL_NOOP_ADDRESS`) |
| 2 | Token PDA | `JDkpV5CsSbhyGhHhirC5DjGPTcuKWUVHtBZ5MFsgu3ZW` | no | no | **Derived** from warp program id, seeds `["hyperlane_message_recipient","-","handle","-","account_metas"]` |
| 3 | Mailbox program | `E588QtVUvresuXq2KoNEwAmoifCzYGpRBdHByN9KQMbi` | no | no | **Read from token account** (`HyperlaneToken.mailbox`) — not derivable from the warp program id alone |
| 4 | Mailbox outbox account | `BvZpTuYLAR77mPhH4GtvwEWUTs53GQqkgBNuXpCePVNk` | no | **yes** | **Derived** from mailbox program id, seeds `["hyperlane","-","outbox"]` |
| 5 | Message dispatch authority | `ATDttjggAZKyS19kcV6Rn56oMi49gDprZGckRou9vkkY` | no | no | **Derived** from warp program id, seeds `["hyperlane_dispatcher","-","dispatch_authority"]` |
| 6 | Sender / mailbox payer | `4LZtvKvBAM8Hcf5tuL5R7xYj9JC12v6ho8igDnwzo6WC` | **yes** | **yes** | **Per-transfer** (caller wallet) |
| 7 | Unique message account | `7H2KAwXsrVWoAhY9ff1nNanYbp4amnF2mZdwzJDi9AhF` | **yes** | no | **Per-transfer** — fresh ephemeral `Keypair`, exists only to seed PDAs below and prove tx uniqueness |
| 8 | Message storage PDA (dispatched message) | `GttQDgYR9gVLvjMofpVBiU6BgrJp5V7DFWfap6oLV6WY` | no | **yes** | **Per-transfer** — derived from mailbox program id + unique message pubkey, seeds `["hyperlane","-","dispatched_message","-",uniqueMessagePubkey]` |
| 9 | IGP program | `BhNcatUDC2D5JTyeaqrdSukiVFsEHK7e3hVmKMztwefv` | no | no | **Read from token account** (`interchain_gas_paymaster.program_id`) |
| 10 | IGP program-data PDA | `8Cv4PHJ6Cf3xY7dse7wYeZKtuQv9SAN6ujt5w22a2uho` | no | **yes** | **Derived** from IGP program id, seeds `["hyperlane_igp","-","program_data"]` |
| 11 | Gas payment PDA | `3hWynyfaw9gZxa7ik2vWfYGLp94Vcge3jb7Xa5qZ84k1` | no | **yes** | **Per-transfer** — derived from IGP program id + unique message pubkey (reused as the "unique gas payment" key), seeds `["hyperlane_igp","-","gas_payment","-",uniqueMessagePubkey]` |
| 12 | Configured IGP account (OverheadIgp, optional slot) | `AkeHBbE5JkwVppujCQQ6WuxsVsJtruBAjUo6fDCFp6fF` | no | no | **Read from token account** (`interchain_gas_paymaster.igp_account`) — opaque address, not derivable from the warp program id (its own PDA salt is unknown to the warp route) |
| 13 | Inner/gas-oracle IGP account | `JAvHW21tYXE9dtdG83DReqU2b4LUexFuCbtJT5tF8X6M` | no | **yes** | **Read from the OverheadIgp account's own `inner` field** (on-chain, one extra RPC) — this is the account §4's quote formula reads |
| 14 | System program (native-plugin transfer_in) | `11111111111111111111111111111111` | no | no | **Universal constant** (repeated) |
| 15 | Native token collateral PDA | `8HY3hxmnrWwqEmcdwkSnfN9wEQFUkyiwZvU1vMbnXgbC` | no | **yes** | **Derived** from warp program id, seeds `["hyperlane_token","-","native_collateral"]` |

**Route-static summary (Task 8 / registry metadata):** in practice almost
nothing about this account list needs hardcoding beyond the warp program id
(already in the registry) — slots 2, 4, 5, 8\*, 11\*, 15 are pure PDAs
computable from a program id already known, and slots 3, 9, 12, 13 are read
directly off the warp token's own on-chain account (one `getAccountInfo` on
the token PDA yields mailbox, IGP program, and IGP/OverheadIgp account; one
further read of the OverheadIgp account yields the inner IGP account). Slots
marked `*` (8, 11) are per-transfer PDAs but derived from a **route-static**
seed prefix. **Per-transfer inputs actually supplied by the caller are just
three:** the sender wallet (6), a freshly generated unique-message `Keypair`
(7, whose pubkey then seeds 8 and 11), and the instruction data
(destination domain / recipient / amount, §1).

**Signer/writable flags verified two ways:** against the Rust `AccountMeta`
constructors at each `next_account_info` call in `processor.rs`/`plugin.rs`,
and independently by decoding the real transaction's compiled `header`
(`numRequiredSignatures=2`, `numReadonlySignedAccounts=1`,
`numReadonlyUnsignedAccounts=9` over 17 total keys) — both agree exactly, and
match the fixture's `accounts[].{signer,writable}`. Note the sender (slot 6)
compiles as **writable** even though the TS meta constant says
`isWritable: false` — Solana's transaction compiler unions writability
across every instruction referencing an account, and the sender is written
elsewhere (the native-collateral lamport transfer CPI requires it writable).

**All seven PDA derivations above were independently recomputed** (Python,
`solders.pubkey.Pubkey.find_program_address`) from the known program ids and
seed byte strings and matched the real transaction's account keys exactly
(bump seeds: token PDA 255, dispatch authority 254, native collateral 255,
mailbox outbox 255, IGP program-data 254, gas payment PDA 255, dispatched
message PDA 253).

---

## 3. PDA seed byte strings

All seed macros below are exact quotes (byte string literals, `b"..."`,
each segment a separate seed — Solana PDA seeds are `&[&[u8]]`, not one
concatenated buffer, but the two are equivalent for `find_program_address`
since it hashes them in sequence).

**Dispatched-message PDA** (mailbox program), from
[`rust/sealevel/programs/mailbox/src/pda_seeds.rs:30-40`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/rust/sealevel/programs/mailbox/src/pda_seeds.rs#L30-L40):

```
["hyperlane", "-", "dispatched_message", "-", <unique_message_pubkey (32 bytes)>]
```

Program: the **mailbox** program id (read off the token account, slot 3
above), not the warp program id.

**IGP gas-payment PDA**, from
[`rust/sealevel/programs/hyperlane-sealevel-igp/src/pda_seeds.rs:152-173`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/rust/sealevel/programs/hyperlane-sealevel-igp/src/pda_seeds.rs#L152-L173):

```
["hyperlane_igp", "-", "gas_payment", "-", <unique_gas_payment_pubkey (32 bytes)>]
```

Program: the **IGP** program id (read off the token account, slot 9 above).
`unique_gas_payment_pubkey` is the **same** unique-message `Keypair` pubkey
used for the dispatched-message PDA — TS derives the message-storage PDA
from `randomWallet` at
[`SealevelTokenAdapter.ts:1219-1223`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/typescript/sdk/src/token/adapters/SealevelTokenAdapter.ts#L1219-L1223)
and reuses the identical `randomWallet` to derive the gas-payment PDA at
[`SealevelTokenAdapter.ts:1244-1248`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/typescript/sdk/src/token/adapters/SealevelTokenAdapter.ts#L1244-L1248).

Related seeds pinned for completeness (all under
[`igp/src/pda_seeds.rs`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/rust/sealevel/programs/hyperlane-sealevel-igp/src/pda_seeds.rs)):
IGP program-data `["hyperlane_igp","-","program_data"]` (L4-13); token PDA
(mailbox library, not IGP)
`["hyperlane_message_recipient","-","handle","-","account_metas"]`; dispatch
authority `["hyperlane_dispatcher","-","dispatch_authority"]`; native
collateral `["hyperlane_token","-","native_collateral"]` (native
plugin,
[`hyperlane-sealevel-token-native/src/plugin.rs:24-38`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/rust/sealevel/programs/hyperlane-sealevel-token-native/src/plugin.rs#L24-L38));
mailbox outbox `["hyperlane","-","outbox"]`
([`mailbox/src/pda_seeds.rs:17-25`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/rust/sealevel/programs/mailbox/src/pda_seeds.rs#L17-L25)).

---

## 4. IGP gas-oracle account data layout and quote formula

**Account on-disk layout** (`AccountData<DiscriminatorPrefixed<Igp>>`):

```
[1 byte:  initialized bool]                         account_utils AccountData wrapper, lib.rs:112-122
[8 bytes: "IGP_____" discriminator]                 Igp::DISCRIMINATOR, accounts.rs:170-172
[1 byte:  bump_seed]
[32 bytes: salt (H256)]
[1 byte:  owner Option tag] [+32 bytes if Some]      Borsh Option<Pubkey>
[32 bytes: beneficiary (Pubkey)]
[4 bytes: gas_oracles.len() (u32 LE)]
  repeated per entry:
  [4 bytes: destination domain (u32 LE)]
  [1 byte: GasOracle variant tag — 0 = RemoteGasData, the only variant]
  [16 bytes: token_exchange_rate (u128 LE)]
  [16 bytes: gas_price (u128 LE)]
  [1 byte: token_decimals]
[0 or 8+N bytes: optional trailing fee_config — OptionalDiscriminatedData<IgpFeeConfig>]
```

Struct: `Igp` at
[`accounts.rs:174-190`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/rust/sealevel/programs/hyperlane-sealevel-igp/src/accounts.rs#L174-L190);
`RemoteGasData` at
[`accounts.rs:313-328`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/rust/sealevel/programs/hyperlane-sealevel-igp/src/accounts.rs#L313-L328);
entry size constant `GAS_ORACLE_ENTRY_SIZE = 4+1+16+16+1 = 38` at
[`accounts.rs:57-63`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/rust/sealevel/programs/hyperlane-sealevel-igp/src/accounts.rs#L57-L63).
TS mirror schema at
[`gas/adapters/serialization.ts:240-260`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/typescript/sdk/src/gas/adapters/serialization.ts#L240-L260).

**Quote formula**, `compute_gas_fee` at
[`accounts.rs:618-634`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/rust/sealevel/programs/hyperlane-sealevel-igp/src/accounts.rs#L618-L634)
(+ `convert_decimals` at
[`accounts.rs:636-654`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/rust/sealevel/programs/hyperlane-sealevel-igp/src/accounts.rs#L636-L654)):

```
dest_cost   = gas_amount * gas_price                          (U256, no overflow check needed at these magnitudes)
origin_cost = floor(dest_cost * token_exchange_rate / TOKEN_EXCHANGE_RATE_SCALE)
lamports    = origin_cost * 10^(SOL_DECIMALS - token_decimals)     [SOL_DECIMALS=9 > token_decimals: multiply]
            = floor(origin_cost / 10^(token_decimals - SOL_DECIMALS)) [token_decimals > SOL_DECIMALS: divide]
```

Constants:
`TOKEN_EXCHANGE_RATE_SCALE = 10^19` at
[`accounts.rs:22`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/rust/sealevel/programs/hyperlane-sealevel-igp/src/accounts.rs#L22)
(exchange rate of `1.0` ⇒ stored as `10^19`); `SOL_DECIMALS = 9` at
[`accounts.rs:24`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/rust/sealevel/programs/hyperlane-sealevel-igp/src/accounts.rs#L24).
`gas_amount` is **not** derived from the message; it is the warp token's own
`destination_gas(destination_domain)` map value, read at
[`processor.rs:721-723`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/rust/sealevel/libraries/hyperlane-sealevel-token/src/processor.rs#L721-L723)
and passed to `PayForGas` verbatim — set on the token via
`SetDestinationGasConfigs`, unrelated to the `OverheadIgp.gas_overheads` map
(that map is bypassed entirely in this call path: the warp route CPIs
`PayForGas` straight on the resolved inner `Igp` account with its own
`gas_amount`).

**Verified against the real deposit.** The token PDA's `destination_gas` for
domain `1634493807` is `464000` (log line `"Paid IGP … for 464000 gas …"`).
Fetching the inner IGP account
(`JAvHW21tYXE9dtdG83DReqU2b4LUexFuCbtJT5tF8X6M`, captured in
`packages/bridge/test/fixtures/sealevel-igp-account.json` at slot
442410490, via `getAccountInfo` with `{"encoding":"base64"}`) and decoding it
per the layout above gives, for domain `1634493807`:

```
token_exchange_rate = 751705303136
gas_price            = 83169
token_decimals       = 6      (matches registry ALEO decimals, registry/default.ts:24)
```

Plugging into the formula:

```
dest_cost   = 464000 * 83169                  = 38,590,416,000
origin_cost = floor(38590416000 * 751705303136 / 10^19) = 2,900
lamports    = 2900 * 10^(9-6)                 = 2,900,000
```

This **exactly matches** the observed lamport delta on the inner IGP account
in the transaction (`1432395649 - 1429495649 = 2,900,000`, fixture
`logMessages` / balances) — a byte-for-byte, formula-level verification of
both the account layout and the quote math, not just a documentation read.

---

## 5. Mailbox dispatch log line format (message id)

Two distinct log lines carry the message id, with **different formatting**:

1. **Mailbox dispatch** — full, untruncated hex. Format string at
   [`mailbox/src/processor.rs:747-751`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/rust/sealevel/programs/mailbox/src/processor.rs#L747-L751):
   ```rust
   msg!("Dispatched message to {}, ID {:?}", dispatch.destination_domain, id);
   ```
   Real example (this tx):
   `"Dispatched message to 1634493807, ID 0xffe0409d00c184769b4dfa2a1eaac5a0a79bfe52458a38e1d9a71a9e5c677805"`
   — `{:?}` (`Debug`) on `H256` prints the full `0x`-prefixed 64-hex-char id.
2. **IGP payment** — abbreviated (`Display`, not `Debug`). Format string at
   [`hyperlane-sealevel-igp/src/processor.rs:579-585`](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/45c0988962fd0c931fc18221bd21c60f458dd732/rust/sealevel/programs/hyperlane-sealevel-igp/src/processor.rs#L579-L585):
   ```rust
   msg!("Paid IGP {} for {} gas for message {} to {}", igp_key, gas_amount, payment.message_id, payment.destination_domain);
   ```
   Real example: `"Paid IGP JAvHW21tYXE9dtdG83DReqU2b4LUexFuCbtJT5tF8X6M for 464000 gas for message 0xffe0…7805 to 1634493807"`
   — the message id is `H256`'s `Display` impl, which truncates to
   `0x<first 4 bytes>…<last 2 bytes>`.

The warp-route completion log also truncates the recipient the same way:
`"Warp route transfer completed to destination: 1634493807, recipient:
0x1c34…2912, remote_amount: 676200000000"` — confirming the truncated
`Display` style is used generically for `H256` values in these `msg!` calls,
not specific to message ids. **A parser reading these logs for the message
id must use the mailbox's `"Dispatched message to …, ID {:?}"` line (full
hex), never the IGP or warp-completion lines (truncated, lossy).**

---

## 6. Recipient bytes vs. bech32m-decoded Aleo address

The instruction data's raw recipient bytes
(`1c3496991e7c611ced5ee5cd0cdee969c53efc8a5497ae050819b1ef00ed2912`, 32
bytes, no byte-reversal) were round-tripped against the actual
`aleoAddressToBytes32` in
`packages/bridge/src/utils/xreserve.ts:68` (project source, not upstream):
encoding those 32 bytes as a bech32m `aleo1…` address (inverse of the
decode algorithm at `xreserve.ts:31-54`) yields
`aleo1rs6fdxg703s3em27uhxsehhfd8znaly22jt6upggrxc77q8d9yfq33pk28`, and
running that address through the real, unmodified `aleoAddressToBytes32()`
(via `tsx`, no reimplementation) returns the identical 32 bytes. Bech32m's
checksum is a deterministic linear function of the payload (not searched),
so this is the **unique** canonical encoding of that payload under the
`aleo` prefix — i.e. the instruction's recipient field is confirmed to be a
direct, unreversed 32-byte Aleo address payload, matching how
`padBytesToLength(addressToBytes(recipient), 32)` is used on the TS side
(§1). Note this derived address is **not** claimed to be the depositor's
actual typed input — only that it is *a* valid preimage proving the encoding
scheme, since the real transaction carries only the already-encoded 32
bytes.

Script used (kept out of the repo; scratch verification only): encode via
the same `bech32Polymod` + alphabet used in `xreserve.ts`, decode via the
real exported `aleoAddressToBytes32`, compare byte-for-byte. Result: match.

---

## Observed total lamport overhead (this deposit)

From the fixture's account balances (`preBalances`/`postBalances` in the raw
`getTransaction` response; not itself part of the fixture schema, but
reproducible from `signature` + `slot`):

| Component | Lamports |
|---|---|
| Solana tx fee | 10,000 |
| IGP gas payment (§4) | 2,900,000 |
| Rent, gas-payment PDA (new account) | 1,872,240 |
| Rent, dispatched-message storage PDA (new account) | 2,241,120 |
| **Total overhead** | **7,023,360** |

This equals `lamportDelta` in the fixture exactly: sender preBalance
(676,220,394,100) − postBalance (13,370,740) − `amountLamports`
(676,200,000,000) = 7,023,360. The Mailbox's protocol fee for this
transaction was 0 (log: `"Protocol fee of 0 paid from … to …"`) — Aleo's
mailbox is currently configured with a zero protocol fee, so it contributes
nothing to the overhead here but is a distinct, separately configurable
component a future non-zero-fee route would need to add.

---

## Fixtures produced by this task

- `packages/bridge/test/fixtures/sealevel-transfer-remote.json` — the real
  deposit transaction above: signature, slot, base64 instruction data, the
  16-account ordered list with resolved signer/writable flags, full log
  messages, `amountLamports` (676,200,000,000), the derived
  `recipientAleoAddress` (§6), `senderAddress`, `uniqueMessageAddress`, and
  `lamportDelta` (7,023,360).
- `packages/bridge/test/fixtures/sealevel-igp-account.json` — the inner IGP
  gas-oracle account (`JAvHW21tYXE9dtdG83DReqU2b4LUexFuCbtJT5tF8X6M`) raw
  account data (base64) at the slot it was captured (442410490), used by
  Task 5's quote test to reproduce the §4 calculation.
