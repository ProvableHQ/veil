import type { Transaction } from './transaction.js'
import type { Network } from './wallet.js'

/**
 * Options for building an execution transaction.
 *
 * `imports` are program names the caller knows will be reached via
 * dynamic dispatch. Static imports (those declared in the program's
 * `import` block) are discovered automatically — only list dynamic ones
 * the prover can't infer. The proving implementation (or the wallet)
 * fetches the bytecode for each named program; callers don't supply
 * source.
 *
 * When `privateFee` is true, the proving implementation resolves the fee
 * record via the wallet client's `recordProvider` — callers don't pick
 * the record themselves.
 *
 * @property {string} programName - Program id, e.g. `token.aleo`.
 * @property {string} functionName - Function/transition name to invoke within the program.
 * @property {string[]} inputs - Function inputs as Aleo-encoded strings (e.g. `'100u64'`, `'aleo1...'`).
 * @property {boolean} [privateFee] - If true, pay the fee from a private record instead of the public credits balance. Defaults to `false`. The fee record is resolved via the record provider; callers do not supply one.
 * @property {string[]} [imports] - Names of programs reached via dynamic dispatch that the prover can't discover statically.
 */
export type BuildTransactionOptions = {
  programName: string
  functionName: string
  inputs: string[]
  privateFee?: boolean | undefined
  imports?: string[] | undefined
}

/**
 * Options for a local simulation — runs the function without proving or
 * broadcasting, so it is free and leaves no on-chain trace.
 *
 * @property inputs Function inputs as Aleo-encoded strings (e.g. '100u64').
 * @property programSource Program source, when the caller already has it; fetched otherwise.
 * @property programImports Import program name → source, for imports the simulator cannot fetch.
 */
export type SimulateOptions = {
  programName: string
  functionName: string
  inputs: string[]
  programSource?: string | undefined
  programImports?: Record<string, string> | undefined
}

/**
 * Options for an execute call — proves, broadcasts, and waits for
 * confirmation, so it hits the network and costs a fee.
 *
 * @property inputs Function inputs as Aleo-encoded strings (e.g. '100u64').
 * @property privateFee If true, pay the fee from a private record instead of
 *   the public credits balance. Defaults to false.
 * @property programSource Program source, when the caller already has it; fetched otherwise.
 * @property programImports Import program name → source, for imports the prover cannot fetch.
 */
export type ExecuteOptions = {
  programName: string
  functionName: string
  inputs: string[]
  /** Priority fee in microcredits (1 credit = 1_000_000 microcredits) */
  fee: bigint
  privateFee?: boolean | undefined
  programSource?: string | undefined
  programImports?: Record<string, string> | undefined
}

/** Result of a local simulation, before ABI parsing — outputs are raw Aleo-encoded strings. */
export type RawSimulateResult = {
  /** Per-transition results with program/function metadata */
  transitions: RawTransitionResult[]
  /** Outputs of the called function's transition only — inner cross-program transition outputs live in `transitions[]`. */
  outputs: string[]
}

/** Raw per-transition result from the proving layer (before ABI parsing) */
export type RawTransitionResult = {
  transitionId: string
  program: string
  function: string
  outputs: string[]
}

/** Result of an execute call, before ABI parsing — the confirmed transaction id plus raw Aleo-encoded output strings. */
export type RawExecuteResult = {
  transactionId: string
  /** Per-transition results with program/function metadata */
  transitions: RawTransitionResult[]
  /** Outputs of the called function's transition only — inner cross-program transition outputs live in `transitions[]`. */
  outputs: string[]
}

/**
 * Options for building a deployment transaction.
 *
 * Deployment auto-discovers imports from the program source — there is
 * no `imports` field here.
 *
 * When `privateFee` is true, the proving implementation resolves the fee
 * record via the wallet client's `recordProvider` — callers don't pick
 * the record themselves.
 *
 * @property {string} program - Aleo program source (`program X.aleo; ...`).
 * @property {boolean} [privateFee] - If true, pay the deployment fee from a private record instead of the public credits balance. Defaults to `false`. The fee record is resolved via the record provider; callers do not supply one.
 */
export type BuildDeploymentOptions = {
  program: string
  privateFee?: boolean | undefined
}

/**
 * SDK-backed adapter for wallet-side operations that need network binaries.
 *
 * Hosts proving (`buildTransaction`/`buildDeployment`), execution
 * (`simulate`/`execute`), decryption (`decrypt`), and SDK rebinding
 * (`switchNetwork`).
 *
 * @property {'delegated' | 'local'} mode - Where proofs are produced. `'local'` builds in-process via the SDK's WASM binaries; `'delegated'` submits a proving request to a remote prover service (configured via `url`/`apiKey`).
 * @property {string} [url] - Prover service URL. Required for `mode: 'delegated'`, ignored otherwise.
 * @property {string} [apiKey] - API key for the prover service, if it requires one.
 * @property {boolean} [useFeeMaster] - If true, the delegated prover pays transaction fees from its own FeeMaster account on behalf of the caller. Only meaningful when `mode: 'delegated'` — a billing arrangement with the prover service, not a per-transaction flag.
 */
export type ProvingConfig = {
  mode: 'delegated' | 'local' | 'devnode'
  url?: string | undefined
  apiKey?: string | undefined
  useFeeMaster?: boolean | undefined
  buildTransaction?: (options: BuildTransactionOptions) => Promise<Transaction>
  buildDeployment?: (options: BuildDeploymentOptions) => Promise<Transaction>
  decrypt?: (
    cipherText: string,
    tpk?: string,
    programId?: string,
    functionName?: string,
    index?: number,
  ) => Promise<string>
  switchNetwork?: (network: Network) => Promise<void>
  /** Local execution without broadcasting — returns raw output strings */
  simulate?: (options: SimulateOptions) => Promise<RawSimulateResult>
  /** Build, broadcast, wait for confirmation, and return raw output strings */
  execute?: (options: ExecuteOptions) => Promise<RawExecuteResult>
}

