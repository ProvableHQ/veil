import type { AlgorithmGrant } from '../types/inputRequest.js'

/**
 * Identifies the wallet algorithm that produces a `[MerkleProof; 2]` exclusion witness.
 * Compare with the connected wallet's advertised algorithms before enabling derived proofs.
 * @example
 * const supported = algorithms.includes(FREEZELIST_PROOF_ALGORITHM)
 */
export const FREEZELIST_PROOF_ALGORITHM = 'program-freezelist-exclusion-proof' as const

/**
 * Requests a wallet-generated exclusion proof for one freezelist and subject.
 *
 * @property type Selects wallet-side derivation.
 * @property algorithm Selects the freezelist exclusion algorithm.
 * @property args Supplies the freezelist program and optional subject; omitting `address` proves the signer.
 * @property label Supplies an optional wallet display label; omitted by default.
 * @example
 * const proof: FreezelistProofRequest = freezelistProofRequest({ freezelistProgram: 'compliance.aleo' })
 */
export type FreezelistProofRequest = {
  type: 'derived'
  algorithm: typeof FREEZELIST_PROOF_ALGORITHM
  args: {
    freezelistProgram: { type: 'string'; value: string }
    address?: { type: 'address'; value: string }
  }
  label?: string
}

/**
 * Accepts an encoded proof pair or a request resolved by a connected wallet.
 * Local accounts require the encoded string form.
 * @example
 * const proof: FreezelistProofInput = freezelistProofRequest({ freezelistProgram: 'compliance.aleo' })
 */
export type FreezelistProofInput = string | FreezelistProofRequest

/**
 * Configures the list and subject for a wallet-generated exclusion proof.
 *
 * @property freezelistProgram Names the program whose `freeze_list_root` the target contract checks; this may differ from the token or AMM program.
 * @property address Selects an explicit subject. Defaults to the wallet signer when omitted.
 * @property label Supplies a wallet display label. Defaults to no label.
 * @example
 * const options: FreezelistProofRequestParameters = { freezelistProgram: 'compliance.aleo' }
 */
export type FreezelistProofRequestParameters = {
  freezelistProgram: string
  address?: string
  label?: string
}

/**
 * Builds a wallet request for a freezelist exclusion proof without network access.
 * The wallet fetches the list and produces the proof when executing the transaction.
 *
 * @param options Identifies the checked list and optional explicit subject or display label.
 * @returns A structured transaction input requiring a wallet account and matching algorithm grant.
 * @example
 * const proof = freezelistProofRequest({ freezelistProgram: 'compliance.aleo', address: 'aleo1...' })
 */
export function freezelistProofRequest(options: FreezelistProofRequestParameters): FreezelistProofRequest {
  return {
    type: 'derived',
    algorithm: FREEZELIST_PROOF_ALGORITHM,
    args: {
      freezelistProgram: { type: 'string', value: options.freezelistProgram },
      ...(options.address !== undefined ? { address: { type: 'address' as const, value: options.address } } : {}),
    },
    ...(options.label !== undefined ? { label: options.label } : {}),
  }
}

/**
 * Configures a freezelist algorithm grant for one transaction input slot.
 *
 * @property program Names the executed program that consumes the proof.
 * @property function Names the executed function that consumes the proof.
 * @property inputPosition Selects the zero-based proof input position in that function.
 * @property freezelistProgram Restricts the grant to the program owning the checked root.
 * @example
 * const options: FreezelistProofGrantParameters = { program: 'token.aleo', function: 'transfer_private', inputPosition: 3, freezelistProgram: 'compliance.aleo' }
 */
export type FreezelistProofGrantParameters = {
  program: string
  function: string
  inputPosition: number
  freezelistProgram: string
}

/**
 * Builds a connect-time grant restricted to one list and call site without network access.
 * Supply a separate grant for each proof slot before submitting derived requests.
 *
 * @param options Identifies the executed function, zero-based proof position, and allowed list.
 * @returns A grant for use in the wallet connection's `algorithmsAllowed` array.
 * @example
 * const grant = freezelistProofGrant({ program: 'token.aleo', function: 'transfer_private', inputPosition: 3, freezelistProgram: 'compliance.aleo' })
 */
export function freezelistProofGrant(options: FreezelistProofGrantParameters): AlgorithmGrant {
  return {
    algorithm: FREEZELIST_PROOF_ALGORITHM,
    program: options.program,
    function: options.function,
    inputPosition: options.inputPosition,
    argConstraints: { freezelistProgram: [options.freezelistProgram] },
  }
}

/**
 * Checks the runtime shape of a freezelist proof request without resolving its proof.
 * Program deployment, address validity, grants, and frozen-subject checks remain the wallet's responsibility.
 *
 * @param input Inspects an untrusted transaction input for the required algorithm and typed arguments.
 * @returns True when the input has the freezelist request shape.
 * @example
 * if (isFreezelistProofRequest(input)) console.log(input.args.freezelistProgram.value)
 */
export function isFreezelistProofRequest(input: unknown): input is FreezelistProofRequest {
  if (typeof input !== 'object' || input === null) return false
  const request = input as Record<string, unknown>
  if (request.type !== 'derived' || request.algorithm !== FREEZELIST_PROOF_ALGORITHM) return false
  if (request.label !== undefined && typeof request.label !== 'string') return false
  if (typeof request.args !== 'object' || request.args === null) return false
  const args = request.args as Record<string, unknown>
  // Require the exact argument tags the wallet uses to parse each value.
  const matches = (value: unknown, type: string): boolean => {
    if (typeof value !== 'object' || value === null) return false
    const arg = value as Record<string, unknown>
    return arg.type === type && typeof arg.value === 'string'
  }
  return matches(args.freezelistProgram, 'string') &&
    (args.address === undefined || matches(args.address, 'address'))
}
