import { hexToBytes } from 'viem'
import { BridgeError } from '../errors/bridgeErrors.js'
import type { SolanaHyperlaneRouteMetadata, SolanaHyperlaneTransferMetadata } from '../types/solana.js'
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
const ASSOCIATED_TOKEN_PROGRAM_ADDRESS = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'

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
 * @typeParam Metadata Reviewed collateral metadata. Defaults to native SOL metadata; use `SolanaHyperlaneSplRouteMetadata` for SPL collateral or `SolanaHyperlaneTransferMetadata` for either kind.
 * @property metadata Reviewed static accounts and domain for the Solana Hyperlane Warp Route.
 * @property senderAddress Base58 address of the wallet funding the transfer; signs and pays rent.
 * @property uniqueMessageAddress Base58 address of a fresh, caller-supplied signer that seeds the
 * dispatched-message and gas-payment program-derived addresses and proves transaction uniqueness.
 * @property recipientAleoAddress Aleo `aleo1…` address receiving the transfer on the destination chain.
 * @property amountLamports Source amount in atomic units; lamports for native SOL and mint units for SPL collateral.
 * @example
 * function nativeCollateral(params: BuildTransferRemoteParameters): string {
 *   return params.metadata.nativeCollateralPda
 * }
 */
export type BuildTransferRemoteParameters<
  Metadata extends SolanaHyperlaneTransferMetadata = SolanaHyperlaneRouteMetadata,
> = {
  metadata: Metadata
  senderAddress: string
  uniqueMessageAddress: string
  recipientAleoAddress: string
  amountLamports: bigint
}

/**
 * Derives the associated token account for a wallet, mint, and SPL token program.
 *
 * The derivation is local and supports both the classic SPL Token program and
 * Token-2022. It does not contact Solana or create the account.
 *
 * @param ownerAddress Wallet or program address that owns the token account.
 * @param mintAddress Mint held by the associated token account.
 * @param tokenProgramAddress SPL token program that owns the mint.
 * @returns Base58 address of the canonical associated token account.
 * @throws Error When an input is not a valid Solana public key.
 *
 * @example
 * const ata = await deriveAssociatedTokenAddress(owner, mint, tokenProgram)
 */
export async function deriveAssociatedTokenAddress(
  ownerAddress: string,
  mintAddress: string,
  tokenProgramAddress: string,
): Promise<string> {
  const kit = await loadKit()
  const addressEncoder = kit.getAddressEncoder()
  const [address] = await kit.getProgramDerivedAddress({
    programAddress: kit.address(ASSOCIATED_TOKEN_PROGRAM_ADDRESS),
    seeds: [
      addressEncoder.encode(kit.address(ownerAddress)),
      addressEncoder.encode(kit.address(tokenProgramAddress)),
      addressEncoder.encode(kit.address(mintAddress)),
    ],
  })
  return address
}

/**
 * Reads the unsigned 64-bit balance stored in an SPL token account.
 *
 * Classic SPL Token and Token-2022 share the same base account layout, so
 * extensions after the base data do not affect this field. A missing account
 * is treated as a zero balance for delivery tracking.
 *
 * @param data Raw token-account bytes, or `null` when the account does not exist.
 * @param address Address included in malformed-account errors.
 * @returns Token balance in the mint's atomic units.
 * @throws BridgeError When an existing account is shorter than the SPL base layout.
 *
 * @example
 * const amount = decodeSplTokenAccountAmount(await rpc.getAccountData(ata), ata)
 */
export function decodeSplTokenAccountAmount(data: Uint8Array | null, address: string): bigint {
  if (data === null) return 0n
  if (data.length < 72) {
    throw new BridgeError(`Solana SPL token account has invalid data: ${address}`)
  }
  let amount = 0n
  for (let index = 7; index >= 0; index--) {
    amount = (amount << 8n) | BigInt(data[64 + index]!)
  }
  return amount
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
 * Builds the Solana instruction that commits native SOL or SPL collateral to a Hyperlane transfer bound for Aleo.
 *
 * The result is unsigned and cannot move funds until the sender and unique
 * message account sign it and a client broadcasts it. Every program account is
 * supplied by reviewed route metadata or derived from the unique message key;
 * no network or wallet is contacted. The encoding is verified byte-for-byte
 * against `test/fixtures/sealevel-transfer-remote.json`.
 *
 * @param params Route metadata, transfer parties, and the source amount in atomic units.
 * @returns The Warp Route program, ordered accounts, and raw 77-byte instruction data needed to assemble the transaction.
 * @throws BridgeError When `amountLamports` does not fit the instruction's 32-byte unsigned width,
 * or when `recipientAleoAddress` is not a valid Aleo address.
 *
 * @example
 * const instruction = await buildTransferRemoteInstruction({
 *   metadata: route.solana,
 *   senderAddress: await walletClient.getAddress(),
 *   uniqueMessageAddress: uniqueSigner.address,
 *   recipientAleoAddress: 'aleo1…',
 *   amountLamports: 1_000_000_000n,
 * })
 */
export function buildTransferRemoteInstruction(
  params: BuildTransferRemoteParameters<SolanaHyperlaneTransferMetadata>,
): Promise<{ programAddress: string; accounts: SolanaAccountMeta[]; data: Uint8Array }>
/**
 * Builds an unsigned native SOL transfer instruction without network or wallet access.
 *
 * Keeps the native overload last so `Parameters<typeof buildTransferRemoteInstruction>`
 * exposes the existing native parameter contract. SPL callers use the preceding overload.
 *
 * @param params Native collateral accounts, transfer parties, and the amount in lamports.
 * @returns The Warp Route program, ordered accounts, and encoded instruction data.
 * @throws BridgeError When the amount exceeds the unsigned 256-bit range or the recipient is invalid.
 * @example
 * function buildNative(params: BuildTransferRemoteParameters) {
 *   return buildTransferRemoteInstruction(params)
 * }
 */
export function buildTransferRemoteInstruction(
  params: BuildTransferRemoteParameters,
): Promise<{ programAddress: string; accounts: SolanaAccountMeta[]; data: Uint8Array }>
export async function buildTransferRemoteInstruction(
  params: BuildTransferRemoteParameters<SolanaHyperlaneTransferMetadata>,
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
    ...(metadata.routerType === 'spl-collateral'
      ? [
        { address: metadata.splTokenProgramAddress, signer: false, writable: false },
        { address: metadata.collateralMintAddress, signer: false, writable: true },
        {
          address: await deriveAssociatedTokenAddress(
            params.senderAddress,
            metadata.collateralMintAddress,
            metadata.splTokenProgramAddress,
          ),
          signer: false,
          writable: true,
        },
        { address: metadata.escrowPda, signer: false, writable: true },
      ]
      : [
        { address: SYSTEM_PROGRAM_ADDRESS, signer: false, writable: false },
        { address: metadata.nativeCollateralPda, signer: false, writable: true },
      ]),
  ]

  return { programAddress: metadata.warpProgramAddress, accounts, data }
}
