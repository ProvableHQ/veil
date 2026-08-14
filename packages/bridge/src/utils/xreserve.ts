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
 * Pure and local; validates the prefix, length, checksum, padding, and payload width.
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
 * Builds the fixed 65-byte xReserve hook for public, record, or wrapper-private minting.
 *
 * Public and record hooks are pure and local. Private hooks lazily load Aleo WASM
 * to commit the intended recipient with BHP256 and scalar zero.
 *
 * @param mode Destination mint transition selected by the caller.
 * @param recipient Intended Aleo recipient committed by private mode.
 * @param environment Consensus environment used by private commitment derivation.
 * @returns A 65-byte hook whose first byte is 0, 1, or 2.
 * @throws BridgeError When private derivation lacks the optional SDK.
 *
 * @example
 * const hook = await buildXReserveHookData('record', recipient, 'testnet')
 */
export async function buildXReserveHookData(
  mode: AleoMintMode,
  recipient: string,
  environment: BridgeEnvironment,
): Promise<Hex> {
  const bytes = new Uint8Array(HOOK_DATA_BYTES)
  bytes[0] = mode === 'public' ? 0 : mode === 'record' ? 1 : 2
  if (mode === 'private') {
    const sdk = await loadAleoSdk(environment)
    const bits = sdk.Plaintext.fromString(recipient).toBitsLe()
    const commitment = new sdk.BHP256().commit(bits, sdk.Scalar.zero()).toBytesLe()
    if (commitment.length !== 32) throw new BridgeError('Private mint commitment must contain 32 bytes')
    bytes.set(commitment, 1)
  }
  return toHex(bytes)
}

/**
 * Derives the Circle deposit nonce from source domain, transaction hash, and log index.
 *
 * Pure and local; follows Circle's ABI-padded nonce preimage exactly.
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
 * Pure and local; rejects fields with invalid wire widths before constructing the payload.
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
 * Pure and local; computes Keccak-256 without contacting Circle.
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
 * Formats fixed-width hexadecimal bytes as an Aleo `[u8; N]` literal.
 *
 * Pure and local; validates the exact byte width before formatting inputs for a wallet.
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
 * Pure and local; preserves the 20 address bytes and adds twelve leading zero bytes.
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
