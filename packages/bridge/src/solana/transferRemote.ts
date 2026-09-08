import { hexToBytes } from 'viem'
import { BridgeError } from '../errors/bridgeErrors.js'
import type { SolanaHyperlaneRouteMetadata } from '../types/solana.js'
import { aleoAddressToBytes32 } from '../utils/xreserve.js'
import { loadKit } from './kit.js'

// SEALEVEL_NOTES.md §1: every Sealevel Hyperlane program instruction is
// prefixed with this fixed 8-byte discriminator, hardcoded rather than
// derived (mirrors the TS SDK's `Buffer.from([1, 1, 1, 1, 1, 1, 1, 1])`).
const PROGRAM_INSTRUCTION_DISCRIMINATOR = Uint8Array.of(1, 1, 1, 1, 1, 1, 1, 1)

// SEALEVEL_NOTES.md §1: Borsh enum variant tag for `Instruction::TransferRemote`
// (declaration order 1, 0-based: `Init=0`, `TransferRemote=1`, …).
const TRANSFER_REMOTE_VARIANT_TAG = 1

// SEALEVEL_NOTES.md §2, rows 0 and 14: the native System program id appears
// twice in the account list — once for the Mailbox's rent/lamport transfer,
// once again for the native-collateral plugin's `transfer_in` CPI.
const SYSTEM_PROGRAM_ADDRESS = '11111111111111111111111111111111'

// SEALEVEL_NOTES.md §3: PDA seeds are UTF-8 string segments (auto-encoded by
// `@solana/kit`'s `getProgramDerivedAddress`) interleaved with the raw
// 32-byte unique-message pubkey.
const DISPATCHED_MESSAGE_PDA_SEED_PREFIX = ['hyperlane', '-', 'dispatched_message', '-'] as const
const GAS_PAYMENT_PDA_SEED_PREFIX = ['hyperlane_igp', '-', 'gas_payment', '-'] as const

const INSTRUCTION_DATA_BYTES = 77 // SEALEVEL_NOTES.md §1: 8 + 1 + 4 + 32 + 32
const U256_BYTES = 32

/**
 * Identifies one Solana account entry in a compiled instruction's account list.
 *
 * @property address Base58-encoded Solana account address.
 * @property signer Whether the transaction must carry this account's signature.
 * @property writable Whether the runtime may write to this account during the instruction.
 */
export type SolanaAccountMeta = {
  address: string
  signer: boolean
  writable: boolean
}

/**
 * Selects the route, parties, and amount for one Sealevel `TransferRemote` instruction.
 *
 * @property metadata Reviewed static accounts and domain for the Solana Hyperlane Warp Route.
 * @property senderAddress Base58 address of the wallet funding the transfer; signs and pays rent.
 * @property uniqueMessageAddress Base58 address of a fresh, caller-supplied signer that seeds the
 * dispatched-message and gas-payment program-derived addresses and proves transaction uniqueness.
 * @property recipientAleoAddress Aleo `aleo1…` address receiving the transfer on the destination chain.
 * @property amountLamports Amount to transfer, in lamports.
 */
export type BuildTransferRemoteParameters = {
  metadata: SolanaHyperlaneRouteMetadata
  senderAddress: string
  uniqueMessageAddress: string
  recipientAleoAddress: string
  amountLamports: bigint
}

function writeU32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
  bytes[offset + 3] = (value >>> 24) & 0xff
}

function writeU256LE(bytes: Uint8Array, offset: number, value: bigint): void {
  if (value < 0n || value >= 1n << BigInt(U256_BYTES * 8)) {
    throw new BridgeError(`amountLamports does not fit in a ${U256_BYTES}-byte unsigned integer`)
  }
  let remaining = value
  for (let index = 0; index < U256_BYTES; index++) {
    bytes[offset + index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
}

/**
 * Builds the Sealevel `TransferRemote` instruction that deposits native SOL into a Hyperlane Warp
 * Route bound for Aleo.
 *
 * Reads no network state itself: every account beyond the two per-transfer signers is either a
 * reviewed static address from `metadata` or a program-derived address computed locally via
 * `@solana/kit`. Verified byte-for-byte against a real mainnet deposit
 * (`test/fixtures/sealevel-transfer-remote.json`); every constant and account slot below cites the
 * `SEALEVEL_NOTES.md` section it was pinned from.
 *
 * @param params Route metadata, transfer parties, and the lamport amount to move.
 * @returns The warp program address, its ordered account list with signer/writable flags, and the
 * raw 77-byte instruction data.
 * @throws BridgeError When `amountLamports` does not fit the instruction's 32-byte unsigned width,
 * or when `recipientAleoAddress` is not a valid Aleo address.
 *
 * @example
 * const instruction = await buildTransferRemoteInstruction({
 *   metadata: route.solana,
 *   senderAddress: await executor.getAddress(),
 *   uniqueMessageAddress: uniqueSigner.address,
 *   recipientAleoAddress: 'aleo1…',
 *   amountLamports: 1_000_000_000n,
 * })
 */
export async function buildTransferRemoteInstruction(
  params: BuildTransferRemoteParameters,
): Promise<{ programAddress: string; accounts: SolanaAccountMeta[]; data: Uint8Array }> {
  const { metadata } = params
  const kit = await loadKit()
  const addressEncoder = kit.getAddressEncoder()
  const uniqueMessageBytes = addressEncoder.encode(kit.address(params.uniqueMessageAddress))

  // SEALEVEL_NOTES.md §2 row 8, §3: dispatched-message PDA lives on the
  // Mailbox program, seeded by the unique-message pubkey.
  const [dispatchedMessagePda] = await kit.getProgramDerivedAddress({
    programAddress: kit.address(metadata.mailboxProgramAddress),
    seeds: [...DISPATCHED_MESSAGE_PDA_SEED_PREFIX, uniqueMessageBytes],
  })

  // SEALEVEL_NOTES.md §2 row 11, §3: gas-payment PDA lives on the IGP
  // program, seeded by the same unique-message pubkey (reused as the
  // "unique gas payment" key).
  const [gasPaymentPda] = await kit.getProgramDerivedAddress({
    programAddress: kit.address(metadata.igpProgramAddress),
    seeds: [...GAS_PAYMENT_PDA_SEED_PREFIX, uniqueMessageBytes],
  })

  // SEALEVEL_NOTES.md §1: [8B discriminator][1B enum tag][4B LE domain][32B recipient][32B LE amount].
  const data = new Uint8Array(INSTRUCTION_DATA_BYTES)
  data.set(PROGRAM_INSTRUCTION_DISCRIMINATOR, 0)
  data[8] = TRANSFER_REMOTE_VARIANT_TAG
  writeU32LE(data, 9, metadata.destinationDomain)
  data.set(hexToBytes(aleoAddressToBytes32(params.recipientAleoAddress)), 13)
  writeU256LE(data, 45, params.amountLamports)

  // SEALEVEL_NOTES.md §2: the ordered account table, interleaving
  // route-static metadata (read from the token's own on-chain
  // configuration in a live system) with the two per-transfer signers and
  // the two PDAs derived above. The sender compiles writable despite not
  // being a writable-flagged account elsewhere — Solana's compiler unions
  // writability across every instruction referencing an account, and the
  // native-collateral transfer CPI needs it writable (§2, closing note).
  const accounts: SolanaAccountMeta[] = [
    { address: SYSTEM_PROGRAM_ADDRESS, signer: false, writable: false }, // row 0
    { address: metadata.splNoopProgramAddress, signer: false, writable: false }, // row 1
    { address: metadata.tokenPda, signer: false, writable: false }, // row 2
    { address: metadata.mailboxProgramAddress, signer: false, writable: false }, // row 3
    { address: metadata.mailboxOutboxPda, signer: false, writable: true }, // row 4
    { address: metadata.dispatchAuthorityPda, signer: false, writable: false }, // row 5
    { address: params.senderAddress, signer: true, writable: true }, // row 6
    { address: params.uniqueMessageAddress, signer: true, writable: false }, // row 7
    { address: dispatchedMessagePda, signer: false, writable: true }, // row 8
    { address: metadata.igpProgramAddress, signer: false, writable: false }, // row 9
    { address: metadata.igpProgramDataPda, signer: false, writable: true }, // row 10
    { address: gasPaymentPda, signer: false, writable: true }, // row 11
    // row 12 (optional): only present when the route wraps its IGP in an
    // `OverheadIgp` — omitted entirely otherwise (SEALEVEL_NOTES.md §2 row
    // 12, "optional slot").
    ...(metadata.igpOverheadAccount
      ? [{ address: metadata.igpOverheadAccount, signer: false, writable: false }]
      : []),
    { address: metadata.igpAccount, signer: false, writable: true }, // row 13
    { address: SYSTEM_PROGRAM_ADDRESS, signer: false, writable: false }, // row 14
    { address: metadata.nativeCollateralPda, signer: false, writable: true }, // row 15
  ]

  return { programAddress: metadata.warpProgramAddress, accounts, data }
}
