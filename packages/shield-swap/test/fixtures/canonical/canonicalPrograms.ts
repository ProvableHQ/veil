import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Program } from '@provablehq/sdk'

/**
 * Pinned canonical token programs for the `shield_swap.aleo` devnode fixture.
 *
 * The wrapper and stablecoin half of the stack has no Leo source in the amm-v3
 * tree: those programs live only as deployed testnet bytecode. Each one is
 * pinned here by id, edition, and the SHA-256 of the exact Explorer bytecode;
 * the bytecode itself is vendored beside this module as `<id>.aleo`, so devnode
 * runs never reach the network. `pin-canonical.ts` refreshes the vendored files
 * and re-verifies the pins.
 *
 * Canonical bytecode embeds the real testnet owner addresses, which the devnode
 * operator does not control. A per-program {@link DevnodeAdaptation} rewrites
 * those addresses (asserting the occurrence count, so an unreviewed re-pin
 * fails loudly) and appends a constructor to programs that predate constructors.
 *
 * Pins mirror the `deploy/shield-swap-edition-1` tag of amm-v3 —
 * `ts-tests/scripts/canonical-token-programs.ts` there — which is the amm-v3
 * revision the fixture builds the rest of the stack from.
 */

/** Directory holding the vendored `<id>.aleo` bytecode. */
const CANONICAL_PROGRAM_DIR = dirname(fileURLToPath(import.meta.url))

/** Explorer endpoint the pin script reads program bytecode from. */
const CANONICAL_PROGRAM_API = 'https://api.explorer.provable.com/v1/testnet/program'

/** Testnet owner of the `test_usdcx_*` stablecoin stack. */
const USDCX_OWNER = 'aleo17pmtmh8t7zwh0qfj8z0cmg0rqt4rtg4t85dy5ldrst5u0c4yvufq3gl9lf'
/** Testnet owner of the USDCx multisig core. */
const USDCX_MULTISIG_OWNER = 'aleo1cytp7hvkrcw7x2myhzh9qgyhfaelpgcykp5yppjr7zdzekqz5qrs2dd7h6'

/** The USDCx stablecoin's compliance freezelist. */
export const USDCX_FREEZELIST_PROGRAM = 'test_usdcx_freezelist.aleo'
/** The USDCx stablecoin — the wrapped-USDCx wrapper's underlying asset. */
export const USDCX_STABLECOIN_PROGRAM = 'test_usdcx_stablecoin.aleo'
/** The native-credits ARC-20 wrapper; its underlying asset is `credits.aleo`. */
export const CREDITS_WRAPPER_PROGRAM = 'shield_swap_arc20_credits.aleo'
/** The wrapped-USDCx ARC-20 wrapper. */
export const USDCX_WRAPPER_PROGRAM = 'shield_swap_arc20_wrapped_usdcx.aleo'

/**
 * Substitutes one embedded address for the devnode operator's.
 *
 * @property kind Discriminant.
 * @property sourceAddress The testnet address baked into the canonical bytecode.
 * @property expectedCount Exact number of occurrences the pinned bytecode
 *   carries. A mismatch means the pin moved and the substitution needs review.
 */
export interface AddressAdaptation {
  kind: 'address'
  sourceAddress: string
  expectedCount: number
}

/**
 * Appends an edition-0 constructor to a program deployed before constructors
 * became mandatory. snarkVM rejects a constructor-less deployment.
 *
 * @property kind Discriminant.
 */
export interface LegacyConstructorAdaptation {
  kind: 'legacy-constructor'
}

/** What one canonical program needs rewritten before it deploys to a devnode. */
export type DevnodeAdaptation = AddressAdaptation | LegacyConstructorAdaptation

/**
 * One pinned canonical program.
 *
 * @property id Program id, matching the vendored `<id>.aleo` filename.
 * @property edition On-chain edition the pin was taken from.
 * @property sha256 Hex SHA-256 of the exact Explorer bytecode.
 * @property devnodeAdaptation Rewrite applied before a devnode deployment.
 *   Absent when the bytecode deploys as-is.
 */
export interface CanonicalProgramSpec {
  id: string
  edition: number
  sha256: string
  devnodeAdaptation?: DevnodeAdaptation
}

/** Merkle library imported by the USDCx freezelist and stablecoin. */
export const MERKLE_TREE_SPEC: CanonicalProgramSpec = {
  id: 'merkle_tree.aleo',
  edition: 1,
  sha256: '8a2bae818bda4e194de82d4b0f2aa227cd9fdb09fad94ae1cd43dd3553306897',
  devnodeAdaptation: { kind: 'legacy-constructor' },
}

/** Upgrade multisig the USDCx freezelist and stablecoin gate their editions on. */
export const USDCX_MULTISIG_SPEC: CanonicalProgramSpec = {
  id: 'test_usdcx_multisig_core.aleo',
  edition: 0,
  sha256: '8e52bb7f03ba9c6b5c922e6fb114a1d2b0e8117c05cada0b43cdb8340f7dd517',
  devnodeAdaptation: { kind: 'address', sourceAddress: USDCX_MULTISIG_OWNER, expectedCount: 3 },
}

/** USDCx freezelist: its constructor and `initialize` both gate on the owner. */
export const USDCX_FREEZELIST_SPEC: CanonicalProgramSpec = {
  id: USDCX_FREEZELIST_PROGRAM,
  edition: 1,
  sha256: '9235a601bfecadcc9f4d55aacc42bc150346d7f825d7280fc65c8140769e8a53',
  devnodeAdaptation: { kind: 'address', sourceAddress: USDCX_OWNER, expectedCount: 2 },
}

/** USDCx stablecoin: its constructor and `initialize` both gate on the owner. */
export const USDCX_STABLECOIN_SPEC: CanonicalProgramSpec = {
  id: USDCX_STABLECOIN_PROGRAM,
  edition: 2,
  sha256: 'eb251dddb0c5a7790a1aeb2128dd725bf252848eb38b895265a32c6e92aa90b0',
  devnodeAdaptation: { kind: 'address', sourceAddress: USDCX_OWNER, expectedCount: 2 },
}

/**
 * Native-credits wrapper. Needs no adaptation: its bridge transitions gate on
 * the router program addresses, which the fixture deploys under the same
 * program names, and it has no mint authority to reassign.
 */
export const CREDITS_WRAPPER_SPEC: CanonicalProgramSpec = {
  id: CREDITS_WRAPPER_PROGRAM,
  edition: 0,
  sha256: '661bf4ecea3f17267931f3f5cb8e7ec4571fff5c6aa9fe95cba7e820f1134ff4',
}

/** Wrapped-USDCx wrapper. Needs no adaptation, for the same reason. */
export const USDCX_WRAPPER_SPEC: CanonicalProgramSpec = {
  id: USDCX_WRAPPER_PROGRAM,
  edition: 0,
  sha256: '68ea61a8ea2dd7d1d696151f1589e92cd60328a6b3cef69577ac221a06ccef8b',
}

/**
 * Every canonical program the fixture deploys, in dependency order (each
 * program's imports precede it).
 */
export const CANONICAL_PROGRAM_SPECS: readonly CanonicalProgramSpec[] = [
  MERKLE_TREE_SPEC,
  USDCX_MULTISIG_SPEC,
  USDCX_FREEZELIST_SPEC,
  USDCX_STABLECOIN_SPEC,
  CREDITS_WRAPPER_SPEC,
  USDCX_WRAPPER_SPEC,
]

/**
 * Replaces every occurrence of `needle`, asserting the count first.
 *
 * The count is the drift detector: a re-pinned program that gained or lost a
 * reference fails here instead of deploying with a half-rewritten owner. Pure
 * and local.
 *
 * @param source Text to rewrite.
 * @param needle Exact substring to replace.
 * @param replacement Text to substitute.
 * @param expectedCount Occurrences the caller asserts `source` contains.
 * @param label Prefix for the error message, naming the program and rewrite.
 * @returns The rewritten text.
 * @throws When the occurrence count differs from `expectedCount`.
 */
export function replaceExactOccurrences(
  source: string,
  needle: string,
  replacement: string,
  expectedCount: number,
  label: string,
): string {
  const count = source.split(needle).length - 1
  if (count !== expectedCount) {
    throw new Error(`${label}: expected ${expectedCount} occurrence(s) of ${needle}, found ${count}`)
  }
  return source.split(needle).join(replacement)
}

/**
 * Parses a program and asserts it declares the expected id.
 *
 * Guards every rewrite: a substitution that corrupts the bytecode fails here
 * rather than as an opaque devnode deployment rejection. Pure and local
 * (parsing runs in the wasm, no network).
 *
 * @param programId The id the source must declare.
 * @param source Aleo instructions to parse.
 * @throws When the source does not parse or declares a different id.
 */
function validateProgramSource(programId: string, source: string): void {
  let program: Program
  try {
    program = Program.fromString(source)
  } catch (error) {
    throw new Error(
      `${programId} source is not a valid Aleo program: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const parsedProgramId = program.id()
  program.free()
  if (parsedProgramId !== programId) {
    throw new Error(`${programId} source declares a different program id: ${parsedProgramId}`)
  }
}

/**
 * Applies a spec's devnode adaptation.
 *
 * Pure and local; returns `source` unchanged for a spec that needs none.
 *
 * @param source The canonical bytecode.
 * @param spec The program's pin, carrying the adaptation.
 * @param deployerAddress The devnode operator that replaces the embedded owner.
 * @returns The adapted bytecode.
 * @throws When an address count does not match the pin, when a
 *   legacy-constructor program already declares a constructor, or when the
 *   adaptation kind is unknown.
 */
function adaptCanonicalSourceForDevnode(
  source: string,
  spec: CanonicalProgramSpec,
  deployerAddress: string,
): string {
  const adaptation = spec.devnodeAdaptation
  if (!adaptation) return source

  if (adaptation.kind === 'address') {
    return replaceExactOccurrences(
      source,
      adaptation.sourceAddress,
      deployerAddress,
      adaptation.expectedCount,
      `${spec.id} devnode address adaptation`,
    )
  }

  if (adaptation.kind === 'legacy-constructor') {
    if (source.includes('\nconstructor:')) {
      throw new Error(`${spec.id} already has a constructor; remove its legacy devnode adaptation`)
    }
    return `${source.trimEnd()}

constructor:
    assert.eq edition 0u16;
`
  }

  throw new Error(`${spec.id} has an unsupported devnode adaptation`)
}

/** Path of a spec's vendored bytecode. */
export function canonicalProgramPath(spec: CanonicalProgramSpec): string {
  return join(CANONICAL_PROGRAM_DIR, spec.id)
}

/**
 * Reads a spec's vendored bytecode and verifies it against the pin.
 *
 * Reads from disk only — the canonical source of truth for a devnode run.
 *
 * @param spec The program's pin.
 * @returns The exact canonical bytecode, unadapted.
 * @throws When the file is missing, its SHA-256 differs from the pin, or it
 *   does not parse as the pinned program.
 */
function readCanonicalProgram(spec: CanonicalProgramSpec): string {
  const path = canonicalProgramPath(spec)
  let source: string
  try {
    source = readFileSync(path, 'utf-8')
  } catch (error) {
    throw new Error(
      `${spec.id} bytecode is not vendored at ${path} — run ` +
        `"pnpm tsx packages/shield-swap/test/fixtures/canonical/pin-canonical.ts": ` +
        `${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const digest = createHash('sha256').update(source).digest('hex')
  if (digest !== spec.sha256) {
    throw new Error(
      `${spec.id} edition ${spec.edition} SHA-256 mismatch at ${path}: expected ${spec.sha256}, found ${digest}`,
    )
  }
  validateProgramSource(spec.id, source)
  return source
}

/**
 * Loads a spec's vendored bytecode adapted for a devnode deployment.
 *
 * @param spec The program's pin.
 * @param deployerAddress The devnode operator that replaces the embedded owner.
 * @returns Bytecode ready to deploy from `deployerAddress`.
 * @throws Whatever {@link readCanonicalProgram} or
 *   {@link adaptCanonicalSourceForDevnode} throws.
 */
export function loadCanonicalProgramForDevnode(
  spec: CanonicalProgramSpec,
  deployerAddress: string,
): string {
  const adapted = adaptCanonicalSourceForDevnode(readCanonicalProgram(spec), spec, deployerAddress)
  validateProgramSource(spec.id, adapted)
  return adapted
}

/**
 * Fetches a spec's bytecode from the Explorer and verifies it against the pin.
 *
 * Used by the pin script; hits the network, retrying three times.
 *
 * @param spec The program's pin.
 * @returns The exact canonical bytecode, unadapted.
 * @throws When every attempt fails, the SHA-256 differs from the pin, or the
 *   response does not parse as the pinned program.
 */
export async function fetchCanonicalProgram(spec: CanonicalProgramSpec): Promise<string> {
  const url = `${CANONICAL_PROGRAM_API}/${spec.id}/${spec.edition}`
  let lastError: unknown
  let source: string | undefined
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body: unknown = await response.json()
      if (typeof body !== 'string') throw new Error('response was not a JSON-encoded program string')
      source = body
      break
    } catch (error) {
      lastError = error
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500))
    }
  }
  if (source === undefined) {
    throw new Error(
      `Could not fetch ${spec.id} edition ${spec.edition}: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    )
  }

  const digest = createHash('sha256').update(source).digest('hex')
  if (digest !== spec.sha256) {
    throw new Error(
      `${spec.id} edition ${spec.edition} SHA-256 mismatch: pinned ${spec.sha256}, fetched ${digest}. ` +
        `The deployment moved — re-pin only after reviewing the new bytecode and its adaptation counts.`,
    )
  }
  validateProgramSource(spec.id, source)
  return source
}
