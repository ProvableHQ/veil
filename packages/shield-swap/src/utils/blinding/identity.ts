import type { Client } from '@provablehq/veil-core'
import { DEFAULT_PROGRAM } from '../../constants.js'
import { isBlindedAddressUsed } from '../../actions/reads/isBlindedAddressUsed.js'
import { loadSdk } from '../sdk.js'

/**
 * Domain separator for deriving a blinding factor from a view key and counter.
 *
 * Wallet-side only — the contract never sees the view key, so this value does
 * not appear in the deployed bytecode. Pinned from the Provable reference
 * client (`amm-v3-tests`), where it is documented as
 * `Identifier("amm_v3_blinding_factor")`.
 */
export const BLINDING_FACTOR_DOMAIN =
  '42815354924796718559205719970686750292466968495484257field'

/**
 * Domain separator for deriving a blinded address from a blinding factor.
 *
 * MUST match the constant the program hashes in `verify_blinded_address` —
 * the literal appears in its Poseidon8 preimage cast. Documented in the
 * reference client as `Identifier("amm_v3_private_claim_or_swap")`.
 */
export const CLAIM_OR_SWAP_DOMAIN =
  '11835072102227764468342786961086432175093421716844963782363567713633field'

/**
 * Converts a view key literal to the scalar form the derivation consumes.
 *
 * Local accounts carry `viewKey` as an `AViewKey1…` literal; the blinding
 * derivation hashes the key's scalar. Loads the WASM SDK on first call; pure
 * and local otherwise — the view key never leaves the process.
 *
 * @param viewKey The account view key (`AViewKey1…`).
 * @returns The view key scalar literal (`…scalar`).
 * @throws When `@provablehq/sdk` is not installed, or the view key does not parse.
 *
 * @example
 * const scalar = await viewKeyToScalar(account.viewKey)
 */
export async function viewKeyToScalar(viewKey: string): Promise<string> {
  const { ViewKey } = await loadSdk()
  return ViewKey.from_string(viewKey).to_scalar().toString()
}

/**
 * A single-use blinded identity for one private swap or claim.
 *
 * @property counter The derivation counter that produced this identity.
 * @property blindingFactor Secret field literal passed privately to
 *   `swap` / `claim_swap_output`. Treat like a key: whoever
 *   holds it can claim the swap's output.
 * @property blindedAddress Public address literal the program records in
 *   `used_blinded_addresses`; safe to reveal.
 */
export interface BlindedIdentity {
  counter: number
  blindingFactor: string
  blindedAddress: string
}

/**
 * Derives the blinding factor for a private swap from a view key and counter.
 *
 * Byte-for-byte port of the Provable reference derivation:
 * `Poseidon8([program_address as field, BLINDING_FACTOR_DOMAIN, view_key as
 * field, counter as field])`. Deterministic — the same inputs always yield the
 * same factor, which is how a wallet or bot re-derives identities without
 * storing them.
 *
 * Loads the WASM SDK on first call (see module note); pure and local
 * otherwise — nothing leaves the process, and the view key never goes on
 * chain.
 *
 * @param viewKeyScalar The account view key as a scalar literal
 *   (`account.viewKey().to_scalar().toString()` in the SDK).
 * @param counter Derivation counter (u32). Pick with
 *   {@link nextBlindedIdentity} rather than hardcoding — blinded addresses
 *   are single-use.
 * @param program Program id whose address scopes the derivation. Defaults to
 *   `DEFAULT_PROGRAM`.
 * @returns The blinding factor as a field literal (e.g. `"1234…field"`).
 * @throws When `@provablehq/sdk` is not installed (actionable message), or
 *   when the view-key scalar does not parse.
 *
 * @example
 * const bf = await deriveBlindingFactor(viewKeyScalar, 0)
 */
export async function deriveBlindingFactor(
  viewKeyScalar: string,
  counter: number,
  program: string = DEFAULT_PROGRAM,
): Promise<string> {
  const { Address, Field, Scalar, U32, Poseidon8 } = await loadSdk()

  // self.address as field — x-coordinate of the program's address group element.
  const programAddress = Address.fromProgramId(program).toString()
  const contractAddrField = Address.from_string(programAddress).toGroup().toXCoordinate()

  // view_key as field — scalar bits reinterpreted as a base-field element.
  const viewKeyField = Scalar.fromString(viewKeyScalar).toField()

  // counter as field — u32 widened to field.
  const counterField = U32.fromString(`${counter}u32`).toScalar().toField()

  const preimage = [contractAddrField, Field.fromString(BLINDING_FACTOR_DOMAIN), viewKeyField, counterField]
  return new Poseidon8().hash(preimage).toString()
}

/**
 * Derives the public blinded address for a blinding factor and signer.
 *
 * Byte-for-byte port of the reference derivation the program re-computes in
 * `verify_blinded_address`:
 * `Poseidon8::hash_to_address_raw([program_address, CLAIM_OR_SWAP_DOMAIN,
 * signer, blinding_factor])`. The 252-bit little-endian repacking below
 * emulates snarkVM's `Plaintext::Array::to_fields` and is load-bearing — a
 * one-bit deviation produces an address the program rejects.
 *
 * Loads the WASM SDK on first call; pure and local otherwise.
 *
 * @param blindingFactor Field literal from {@link deriveBlindingFactor}.
 * @param signerAddress The transaction signer's address (`aleo1…`) — the
 *   program binds the blinded address to `self.signer`.
 * @param program Program id whose address scopes the derivation. Defaults to
 *   `DEFAULT_PROGRAM`.
 * @returns The blinded address as an `aleo1…` literal.
 * @throws When `@provablehq/sdk` is not installed, or when an input literal
 *   does not parse.
 *
 * @example
 * const blinded = await deriveBlindedAddress(bf, account.address)
 */
export async function deriveBlindedAddress(
  blindingFactor: string,
  signerAddress: string,
  program: string = DEFAULT_PROGRAM,
): Promise<string> {
  const { Address, Field, Poseidon8 } = await loadSdk()
  const SIZE_IN_DATA_BITS = 252

  const programAddress = Address.fromProgramId(program).toString()
  const contractAddrField = Address.from_string(programAddress).toGroup().toXCoordinate()
  const signerField = Address.from_string(signerAddress).toGroup().toXCoordinate()

  // Emulate Plaintext::Array(<fields>).to_fields: concatenate little-endian
  // bits, then repack into 252-bit field chunks.
  const inputBits = [
    contractAddrField,
    Field.fromString(CLAIM_OR_SWAP_DOMAIN),
    signerField,
    Field.fromString(blindingFactor),
  ].flatMap((f) => f.toBitsLe())

  const preimageFields = []
  for (let i = 0; i < inputBits.length; i += SIZE_IN_DATA_BITS) {
    preimageFields.push(Field.fromBitsLe(inputBits.slice(i, i + SIZE_IN_DATA_BITS)))
  }

  const blindedGroup = new Poseidon8().hashToGroup(preimageFields)
  return Address.fromGroup(blindedGroup.clone()).toString()
}

/**
 * Parameters for {@link nextBlindedIdentity}.
 *
 * @property viewKeyScalar The account view key as a scalar literal.
 * @property signer The transaction signer's address (`aleo1…`).
 * @property program Program to derive for and scan against. Defaults to the
 *   `DEFAULT_PROGRAM`.
 * @property startCounter First counter to try. Defaults to 0.
 * @property maxScan Counters to scan one by one before the search gallops
 *   ahead. Defaults to 64, which covers a store a few swaps behind the chain
 *   without a network round-trip per doubling.
 */
export type NextBlindedIdentityParameters = {
  viewKeyScalar: string
  signer: string
  program?: string
  startCounter?: number
  maxScan?: number
}

/**
 * Highest counter the galloping search probes before giving up.
 *
 * Every counter below it reading as used means the chain is answering for a
 * different account or program, not that the account swapped four million
 * times; failing names that rather than searching forever.
 */
const MAX_GALLOP_COUNTER = 1 << 22

/**
 * Finds the lowest unused counter at or after `start`.
 *
 * Scans `maxScan` counters one by one, which is the common case of a store a
 * few swaps behind the chain. When every one of them is used the account has
 * swapped past the window — a cold store on a long-lived account — so the
 * search gallops ahead in doubling strides until a probe reads unused, then
 * binary-searches back for the lowest unused counter above the last used
 * probe. An account 250 swaps deep costs about 75 reads instead of failing.
 *
 * Any unused counter is a valid identity, so a gap left by a rejected swap is
 * an acceptable answer; the binary search only promises the lowest unused
 * counter between the last used probe and the first unused one.
 *
 * @param isUsed Reads whether the chain has consumed the counter's address.
 * @param start First counter to try.
 * @param maxScan Counters to scan one by one before galloping. Values below 1
 *   are treated as 1.
 * @returns An unused counter, never below `start`.
 * @throws When every probe up to {@link MAX_GALLOP_COUNTER} reads used.
 */
export async function findUnusedCounter(
  isUsed: (counter: number) => Promise<boolean>,
  start: number,
  maxScan: number,
): Promise<number> {
  // At least one linear step, so the gallop always starts above `start` and
  // can never hand back a counter the caller has already moved past.
  const window = Math.max(1, Math.floor(maxScan))
  for (let counter = start; counter < start + window; counter++) {
    if (!(await isUsed(counter))) return counter
  }

  let lastUsed = start + window - 1
  let stride = window
  let probe = lastUsed + stride
  while (await isUsed(probe)) {
    if (probe - start >= MAX_GALLOP_COUNTER) {
      throw new Error(
        `No unused blinded address in counters ${start}…${probe}. ` +
          'Check that the store and the program match the account.',
      )
    }
    lastUsed = probe
    stride *= 2
    probe = lastUsed + stride
  }

  let lo = lastUsed
  let hi = probe
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2)
    if (await isUsed(mid)) lo = mid
    else hi = mid
  }
  return hi
}

/**
 * Finds the first unused blinded identity for an account.
 *
 * Blinded addresses are single-use: each private swap consumes one and the
 * program records it in `used_blinded_addresses`. This derives candidate
 * addresses counter by counter and returns the first one the chain has not
 * seen, galloping ahead when the account has swapped past the scan window
 * (see {@link findUnusedCounter}).
 *
 * Hits the network: one mapping read per probed counter. Also loads the
 * WASM SDK on first call (local derivation).
 *
 * The scan is not atomic with the swap that consumes the identity: two
 * concurrent calls for the same account return the SAME counter, and the
 * second swap is rejected on-chain. Callers submitting swaps concurrently
 * MUST serialize their calls or partition counters via `startCounter`.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params View-key scalar, signer, and optional scan bounds.
 * @returns The first unused identity, with the counter that produced it.
 * @throws When every probed counter reads as used, which points at the wrong
 *   program or account rather than a spent identity space; also propagates
 *   SDK-missing and transport errors. A duplicate-identity rejection on-chain
 *   means concurrent calls raced — serialize them.
 *
 * @example
 * const id = await nextBlindedIdentity(client, { viewKeyScalar, signer })
 * // id.blindingFactor → swap input; id.blindedAddress → public slot
 */
export async function nextBlindedIdentity(
  client: Client,
  params: NextBlindedIdentityParameters,
): Promise<BlindedIdentity> {
  const derive = async (counter: number) => {
    const blindingFactor = await deriveBlindingFactor(params.viewKeyScalar, counter, params.program)
    const blindedAddress = await deriveBlindedAddress(blindingFactor, params.signer, params.program)
    return { counter, blindingFactor, blindedAddress }
  }
  const counter = await findUnusedCounter(
    async (candidate) => {
      const { blindedAddress } = await derive(candidate)
      return isBlindedAddressUsed(client, { address: blindedAddress, program: params.program })
    },
    params.startCounter ?? 0,
    params.maxScan ?? 64,
  )
  return derive(counter)
}
