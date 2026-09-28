import {
  encodeAbiParameters,
  getAddress,
  hexToBytes,
  isAddress,
  isHex,
  keccak256,
  padHex,
  toHex,
  type Address,
  type Hash,
  type Hex,
} from 'viem'
import { BridgeError } from '../errors/bridgeErrors.js'
import type { AleoMintMode, BridgeEnvironment } from '../types/protocol.js'

const HOOK_DATA_BYTES = 65
const BECH32_ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'

/** Field equivalent to `Identifier("shielded_usdcx")`. */
export const SHIELDED_USDCX_DOMAIN = '2441763828608840563966202633349235field'

function bech32Polymod(values: readonly number[]): number {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let checksum = 1
  for (const value of values) {
    const top = checksum >>> 25
    checksum = ((checksum & 0x1ffffff) << 5) ^ value
    for (let index = 0; index < 5; index++) if ((top >>> index) & 1) checksum ^= generators[index]!
  }
  return checksum >>> 0
}

function decodeAleoBech32m(address: string): Uint8Array {
  const separator = address.lastIndexOf('1')
  const prefix = address.slice(0, separator)
  const encoded = address.slice(separator + 1)
  const words = [...encoded].map((character) => BECH32_ALPHABET.indexOf(character))
  if (prefix !== 'aleo' || separator < 1 || words.some((word) => word < 0)) throw new Error('invalid encoding')
  const expanded = [...prefix].map((character) => character.charCodeAt(0) >>> 5)
    .concat([0], [...prefix].map((character) => character.charCodeAt(0) & 31), words)
  if (bech32Polymod(expanded) !== 0x2bc830a3) throw new Error('invalid checksum')
  const payload = words.slice(0, -6)
  const bytes: number[] = []
  let accumulator = 0
  let bits = 0
  for (const word of payload) {
    accumulator = (accumulator << 5) | word
    bits += 5
    while (bits >= 8) {
      bits -= 8
      bytes.push((accumulator >>> bits) & 0xff)
    }
  }
  if (bits >= 5 || ((accumulator << (8 - bits)) & 0xff) !== 0) throw new Error('invalid padding')
  return Uint8Array.from(bytes)
}

/**
 * Decodes a checksummed Aleo bech32m address into xReserve bytes32 form.
 *
 * Validates the supplied prefix, length, checksum, padding, and payload width
 * without contacting Aleo or Circle.
 *
 * @param address Aleo account address to encode.
 * @returns Exactly 32 decoded bytes as prefixed hexadecimal.
 * @throws BridgeError When the address has invalid bech32m structure.
 *
 * @example
 * const recipient = aleoAddressToBytes32('aleo1…')
 */
export function aleoAddressToBytes32(address: string): Hex {
  try {
    if (!address.startsWith('aleo1') || address.length !== 63) throw new Error('invalid prefix or length')
    const bytes = decodeAleoBech32m(address)
    if (bytes.length !== 32) throw new Error('invalid payload')
    return toHex(bytes)
  } catch (cause) {
    throw new BridgeError(`Invalid Aleo recipient address: ${address}`, { cause })
  }
}

/**
 * Restores the Aleo account address carried in a bridge protocol's bytes32 recipient field.
 *
 * Call this when reconstructing a transfer from Solana instructions or EVM
 * events, where the destination address is stored without its human-readable
 * prefix and checksum.
 *
 * @param recipient Exactly 32 Aleo address bytes encoded as prefixed hexadecimal.
 * @returns The canonical checksummed `aleo1…` account address.
 * @throws BridgeError When the recipient is not exactly 32 bytes.
 */
export function bytes32ToAleoAddress(recipient: Hex): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(recipient)) {
    throw new BridgeError(`Invalid 32-byte Aleo recipient: ${recipient}`)
  }
  const prefix = 'aleo'
  const words: number[] = []
  let accumulator = 0
  let bits = 0
  for (const byte of hexToBytes(recipient)) {
    accumulator = (accumulator << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      words.push((accumulator >>> bits) & 31)
    }
  }
  if (bits > 0) words.push((accumulator << (5 - bits)) & 31)

  const expanded = [...prefix].map((character) => character.charCodeAt(0) >>> 5)
    .concat([0], [...prefix].map((character) => character.charCodeAt(0) & 31))
  const checksum = bech32Polymod([...expanded, ...words, 0, 0, 0, 0, 0, 0]) ^ 0x2bc830a3
  for (let index = 0; index < 6; index++) {
    words.push((checksum >>> (5 * (5 - index))) & 31)
  }
  return `${prefix}1${words.map((word) => BECH32_ALPHABET[word]).join('')}`
}

async function loadAleoSdk(environment: BridgeEnvironment) {
  const moduleName = '@provablehq/sdk/dynamic.js'
  try {
    const sdk = await import(moduleName) as { loadNetwork: (network: BridgeEnvironment) => Promise<any> }
    return sdk.loadNetwork(environment)
  } catch (cause) {
    throw new BridgeError('Private xReserve mints require the optional @provablehq/sdk package', { cause })
  }
}

/**
 * Derives the Aleo account address owned by a deployed program id.
 *
 * Lazily loads the optional Aleo WASM SDK but performs no network access.
 *
 * @param programId Deployed Aleo program id whose account receives funds.
 * @param environment Consensus environment used for address derivation.
 * @returns The program-owned `aleo1…` account address.
 * @throws BridgeError When the optional SDK is unavailable or derivation fails.
 *
 * @example
 * const wrapper = await aleoProgramAddress('shielded_usdcx_wrapper.aleo', 'mainnet')
 */
export async function aleoProgramAddress(programId: string, environment: BridgeEnvironment): Promise<string> {
  const sdk = await loadAleoSdk(environment)
  return sdk.Address.fromProgramId(programId).to_string()
}

/**
 * Converts an Aleo view key into the scalar consumed by private-mint derivation.
 *
 * @param viewKey Account view key retained by the local signer.
 * @param environment Consensus environment used to load the matching SDK.
 * @returns The canonical Aleo scalar literal.
 * @throws BridgeError When the SDK is unavailable or the view key is invalid.
 */
export async function xReserveViewKeyToScalar(
  viewKey: string,
  environment: BridgeEnvironment,
): Promise<string> {
  const sdk = await loadAleoSdk(environment)
  try {
    return sdk.ViewKey.from_string(viewKey).to_scalar().toString()
  } catch (cause) {
    throw new BridgeError('Invalid Aleo view key for private xReserve mint derivation', { cause })
  }
}

/**
 * Derives the secret scalar for one shielded USDCx deposit identity.
 *
 * This is the local-key counterpart of the Shield implementation:
 * `Poseidon8::hash_to_scalar([program, domain, view_key, counter])`.
 * The view key and resulting scalar never leave the caller's process.
 *
 * @param viewKeyScalar Account view key serialized as an Aleo scalar literal.
 * @param counter Monotonic unsigned 32-bit identity counter.
 * @param environment Consensus environment used to load the matching SDK.
 * @param program Wrapper program whose address scopes the derivation.
 * @returns The derived Aleo scalar literal.
 * @throws BridgeError When an input is invalid or the optional SDK is unavailable.
 */
export async function deriveXReservePrivateMintSecretNonce(
  viewKeyScalar: string,
  counter: number,
  environment: BridgeEnvironment,
  program = 'shielded_usdcx_wrapper.aleo',
): Promise<string> {
  if (!Number.isSafeInteger(counter) || counter < 0 || counter > 0xffffffff) {
    throw new BridgeError('Private mint identity counter must be an unsigned 32-bit integer')
  }
  const sdk = await loadAleoSdk(environment)
  try {
    const programAddress = sdk.Address.fromProgramId(program).to_string()
    const programField = sdk.Address.from_string(programAddress).toGroup().toXCoordinate()
    const viewKeyField = sdk.Scalar.fromString(viewKeyScalar).toField()
    const counterField = sdk.U32.fromString(`${counter}u32`).toField()
    const derived = new sdk.Poseidon8().hashToScalar([
      programField,
      sdk.Field.fromString(SHIELDED_USDCX_DOMAIN),
      viewKeyField,
      counterField,
    ])
    return derived.toString()
  } catch (cause) {
    throw new BridgeError('Could not derive the private xReserve mint scalar', { cause })
  }
}

/**
 * Commits an Aleo recipient to a private-mint scalar using BHP256.
 *
 * @param recipient Aleo address that will own the minted private record.
 * @param secretNonce Aleo scalar produced for this identity.
 * @param environment Consensus environment used to load the matching SDK.
 * @returns Canonical 32-byte little-endian commitment as lowercase hex without a prefix.
 * @throws BridgeError When an input is invalid or the optional SDK is unavailable.
 */
export async function deriveXReservePrivateMintAddressCommitment(
  recipient: string,
  secretNonce: string,
  environment: BridgeEnvironment,
): Promise<string> {
  const sdk = await loadAleoSdk(environment)
  try {
    const bits = sdk.Plaintext.fromString(recipient).toBitsLe()
    const scalar = sdk.Scalar.fromString(secretNonce)
    const committed = new sdk.BHP256().commit(bits, scalar)
    const field = typeof committed === 'string' ? sdk.Field.fromString(committed) : committed
    const bytes = field.toBytesLe()
    if (bytes.length !== 32) throw new Error('commitment did not contain 32 bytes')
    return toHex(bytes).slice(2)
  } catch (cause) {
    throw new BridgeError('Could not derive the private xReserve address commitment', { cause })
  }
}

/**
 * Encodes a shielded USDCx address commitment as xReserve hook data.
 *
 * The commitment must be the canonical lowercase hexadecimal representation of
 * the 32 little-endian bytes returned by the wallet's BHP256 field commitment.
 * This function performs no network access and never receives the secret scalar.
 *
 * @param addressCommitment Public 32-byte recipient commitment without a `0x` prefix.
 * @returns A 65-byte private-mint hook containing selector 2, the commitment, and 32 reserved zero bytes.
 * @throws BridgeError When the commitment is not canonical lowercase hexadecimal.
 *
 * @example
 * const hook = buildXReservePrivateMintHookData('00'.repeat(32))
 */
export function buildXReservePrivateMintHookData(addressCommitment: string): Hex {
  if (!/^[0-9a-f]{64}$/.test(addressCommitment)) {
    throw new BridgeError('Private mint address commitment must be 32 bytes encoded as lowercase hex without a prefix')
  }
  return `0x02${addressCommitment}${'00'.repeat(32)}`
}

/**
 * Decodes the public address commitment from canonical private-mint hook data.
 *
 * Validates the selector and reserved bytes before returning the lowercase
 * commitment used to look up the locally persisted private-mint identity.
 *
 * @param hookData Fixed-width xReserve hook from a deposit or Circle payload.
 * @returns The 32-byte commitment as lowercase hexadecimal without a prefix.
 * @throws BridgeError When the hook is malformed or is not a private-mint hook.
 *
 * @example
 * const commitment = xReservePrivateMintCommitmentFromHookData(
 *   `0x02${'00'.repeat(64)}`,
 * )
 */
export function xReservePrivateMintCommitmentFromHookData(hookData: Hex): string {
  if (!/^0x[0-9a-fA-F]{130}$/.test(hookData)) {
    throw new BridgeError('Private mint hook data must contain 65 bytes')
  }
  const normalized = hookData.slice(2).toLowerCase()
  if (normalized.slice(0, 2) !== '02' || normalized.slice(66) !== '00'.repeat(32)) {
    throw new BridgeError('xReserve hook data is not a canonical private mint commitment')
  }
  return normalized.slice(2, 66)
}

/**
 * Builds the fixed 65-byte xReserve hook for public, record, or wrapper-private minting.
 *
 * Public and record hooks use only the supplied values. Private hooks lazily
 * load Aleo WASM to commit the intended recipient with BHP256 and the selected
 * secret nonce. No chain or bridge provider is contacted.
 *
 * @param mode Destination mint transition selected by the caller.
 * @param recipient Intended Aleo recipient committed by private mode.
 * @param environment Consensus environment used by private commitment derivation.
 * @param secretNonce Aleo scalar literal used by the private commitment. Defaults to `0scalar`.
 * @returns A 65-byte hook whose first byte is 0, 1, or 2.
 * @throws BridgeError When private derivation lacks the optional SDK or the secret nonce is not a valid Aleo scalar.
 *
 * @example
 * const hook = await buildXReserveHookData('record', recipient, 'testnet')
 */
export async function buildXReserveHookData(
  mode: AleoMintMode,
  recipient: string,
  environment: BridgeEnvironment,
  secretNonce = '0scalar',
): Promise<Hex> {
  const bytes = new Uint8Array(HOOK_DATA_BYTES)
  // Byte 0 selects the Aleo delivery transition. The remaining 64 bytes are
  // zero for provider-managed public/record mints and carry the private
  // recipient commitment in bytes 1..32 for wrapper-managed private minting.
  bytes[0] = mode === 'public' ? 0 : mode === 'record' ? 1 : 2
  if (mode === 'private') {
    const sdk = await loadAleoSdk(environment)
    const bits = sdk.Plaintext.fromString(recipient).toBitsLe()
    let scalar
    try {
      scalar = sdk.Scalar.fromString(secretNonce)
    } catch (cause) {
      throw new BridgeError(`Invalid private mint secret nonce: ${secretNonce}`, { cause })
    }
    // BHP256 binds the intended Aleo address to the secret nonce. Revealing the
    // same pair later proves who may complete the private destination mint.
    const committed = new sdk.BHP256().commit(bits, scalar)
    // The web SDK returns a Field object while Shield's mobile SDK returns its
    // literal string. Normalize both forms before serializing the field.
    const commitmentField = typeof committed === 'string' ? sdk.Field.fromString(committed) : committed
    const commitment = commitmentField.toBytesLe()
    if (commitment.length !== 32) throw new BridgeError('Private mint commitment must contain 32 bytes')
    return buildXReservePrivateMintHookData(toHex(commitment).slice(2))
  }
  return toHex(bytes)
}

/**
 * Derives the Circle deposit nonce from source domain, transaction hash, and log index.
 *
 * Follows Circle's ABI-padded nonce preimage exactly without contacting Circle
 * or either chain.
 *
 * @param sourceDomain Circle domain of the source xReserve contract.
 * @param transactionHash Confirmed deposit transaction hash.
 * @param logIndex Zero-based `DepositedToRemote` receipt log index.
 * @returns The Keccak-256 deposit nonce.
 *
 * @example
 * const nonce = calculateXReserveDepositNonce(0, txHash, 3)
 */
export function calculateXReserveDepositNonce(sourceDomain: number, transactionHash: Hash, logIndex: number): Hash {
  // ABI encoding fixes domain and log index at 32 bytes each. Concatenate those
  // encodings with the 32-byte transaction hash before Keccak-256.
  const domain = encodeAbiParameters([{ type: 'uint32' }], [sourceDomain])
  const index = encodeAbiParameters([{ type: 'uint256' }], [BigInt(logIndex)])
  return keccak256(`0x${domain.slice(2)}${transactionHash.slice(2)}${index.slice(2)}`)
}

function uintBytes(value: bigint, bytes: number): Uint8Array {
  if (value < 0n || value >= 1n << BigInt(bytes * 8)) throw new BridgeError(`Unsigned value does not fit in ${bytes} bytes`)
  return hexToBytes(toHex(value, { size: bytes }))
}

/**
 * Builds the canonical 305-byte Circle xReserve v2 deposit payload.
 *
 * Rejects fields with invalid wire widths before constructing the payload. It
 * does not contact Circle or either chain.
 *
 * @param params Event-derived deposit values and reviewed route identifiers.
 * @returns The exact payload submitted to Circle's attester.
 * @throws BridgeError When a value is invalid or exceeds its wire width.
 *
 * @example
 * const payload = buildXReserveDepositPayload(fields)
 */
export function buildXReserveDepositPayload(params: {
  amount: bigint
  remoteDomain: number
  remoteToken: Hex
  remoteRecipient: Hex
  localToken: Address
  depositor: Address
  maxFee: bigint
  nonce: Hash
  hookData: Hex
}): Hex {
  if (!isHex(params.remoteToken, { strict: true }) || hexToBytes(params.remoteToken).length !== 32) throw new BridgeError('remoteToken must contain 32 bytes')
  if (!isHex(params.remoteRecipient, { strict: true }) || hexToBytes(params.remoteRecipient).length !== 32) throw new BridgeError('remoteRecipient must contain 32 bytes')
  if (!isHex(params.hookData, { strict: true }) || hexToBytes(params.hookData).length !== HOOK_DATA_BYTES) throw new BridgeError('hookData must contain 65 bytes')
  if (!isAddress(params.localToken) || !isAddress(params.depositor)) throw new BridgeError('Payload EVM address is invalid')
  // Circle's signed message is a fixed 305-byte binary layout. Keep explicit
  // offsets so a port can reproduce the wire format without ABI assumptions:
  // header[0..8), amount[8..40), domain[40..44), remote token[44..76),
  // recipient[76..108), local token[108..140), depositor[140..172),
  // max fee[172..204), nonce[204..236), hook length[236..240), hook[240..305).
  const payload = new Uint8Array(305)
  payload.set([0x5a, 0x2e, 0x0a, 0xcd, 0, 0, 0, 1], 0)
  payload.set(uintBytes(params.amount, 32), 8)
  payload.set(uintBytes(BigInt(params.remoteDomain), 4), 40)
  payload.set(hexToBytes(params.remoteToken), 44)
  payload.set(hexToBytes(params.remoteRecipient), 76)
  payload.set(hexToBytes(padHex(getAddress(params.localToken), { size: 32 })), 108)
  payload.set(hexToBytes(padHex(getAddress(params.depositor), { size: 32 })), 140)
  payload.set(uintBytes(params.maxFee, 32), 172)
  payload.set(hexToBytes(params.nonce), 204)
  payload.set(uintBytes(BigInt(HOOK_DATA_BYTES), 4), 236)
  payload.set(hexToBytes(params.hookData), 240)
  return toHex(payload)
}

/**
 * Hashes a canonical xReserve deposit payload for Circle attestation lookup.
 *
 * Computes Keccak-256 from the supplied payload without contacting Circle.
 *
 * @param payload Canonical xReserve deposit bytes.
 * @returns The 32-byte Circle message hash.
 *
 * @example
 * const messageHash = calculateXReserveMessageHash(payload)
 */
export function calculateXReserveMessageHash(payload: Hex): Hash {
  return keccak256(payload)
}

/**
 * Reads the deposit nonce from Circle's fixed-width xReserve payload.
 *
 * Applications can use the nonce to verify Aleo delivery even when older saved
 * progress retained the signed payload but omitted the nonce as a separate field.
 * The payload is decoded in memory and no network or wallet is contacted.
 *
 * @param payload Canonical 305-byte xReserve deposit payload returned by Circle.
 * @returns The 32-byte deposit nonce used by the Aleo bridge nullifier mapping.
 * @throws BridgeError When the payload has the wrong header, width, or hook length.
 * @example const nonce = xReserveDepositNonceFromPayload(attestation.payload)
 */
export function xReserveDepositNonceFromPayload(payload: Hex): Hash {
  if (!isHex(payload, { strict: true })) throw new BridgeError('xReserve payload must be prefixed hexadecimal')
  const bytes = hexToBytes(payload)
  if (bytes.length !== 305
    || toHex(bytes.slice(0, 8)) !== '0x5a2e0acd00000001'
    || toHex(bytes.slice(236, 240)) !== '0x00000041') {
    throw new BridgeError('xReserve payload has an invalid deposit layout')
  }
  return toHex(bytes.slice(204, 236))
}

/**
 * Formats fixed-width hexadecimal bytes as an Aleo `[u8; N]` literal.
 *
 * Validates the exact byte width before formatting inputs for a wallet. It does
 * not contact Aleo or prompt the wallet.
 *
 * @param value Prefixed hexadecimal bytes to format.
 * @param expectedBytes Required array width from the target Aleo function.
 * @returns An Aleo array literal containing decimal `u8` values.
 * @throws BridgeError When the input is malformed or has the wrong width.
 *
 * @example
 * const hashInput = xReserveHexToAleoBytes(messageHash, 32)
 */
export function xReserveHexToAleoBytes(value: Hex, expectedBytes: number): string {
  if (!isHex(value, { strict: true })) throw new BridgeError('Aleo byte-array input must be prefixed hexadecimal')
  const bytes = hexToBytes(value)
  if (bytes.length !== expectedBytes) throw new BridgeError(`Aleo byte-array input must contain ${expectedBytes} bytes`)
  return `[${[...bytes].map((byte) => `${byte}u8`).join(',')}]`
}

/**
 * Encodes an Ethereum address as the 32-byte recipient required by xReserve burns.
 *
 * Preserves the 20 address bytes and adds twelve leading zero bytes without
 * contacting Ethereum or Circle.
 *
 * @param address Checksummed or lowercase Ethereum address selected by the caller.
 * @returns The address left-padded to exactly 32 bytes.
 * @throws BridgeError When the address is malformed.
 *
 * @example
 * const recipient = evmAddressToXReserveBytes32('0x0000000000000000000000000000000000000001')
 */
export function evmAddressToXReserveBytes32(address: string): Hex {
  if (!isAddress(address)) throw new BridgeError(`Invalid Ethereum recipient address: ${address}`)
  return padHex(getAddress(address), { size: 32 })
}
