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
 * Despite the name, this hosts more than transaction proving: it's the
 * single slot a local wallet client uses to reach a network-bound SDK. As
 * of today it carries proving (`buildTransaction`/`buildDeployment`),
 * decryption (`decrypt`), and SDK rebinding (`switchNetwork`).
 *
 * @property {'delegated' | 'local'} mode - Where proofs are produced. `'local'` builds in-process via the SDK's WASM binaries; `'delegated'` submits a proving request to a remote prover service (configured via `url`/`apiKey`).
 * @property {string} [url] - Prover service URL. Required for `mode: 'delegated'`, ignored otherwise.
 * @property {string} [apiKey] - API key for the prover service, if it requires one.
 * @property {boolean} [useFeeMaster] - If true, the delegated prover pays transaction fees from its own FeeMaster account on behalf of the caller. Only meaningful when `mode: 'delegated'` — a billing arrangement with the prover service, not a per-transaction flag.
 * @property {(options: BuildTransactionOptions) => Promise<Transaction>} [buildTransaction] - Build an execution transaction for a program function call.
 * @property {(options: BuildDeploymentOptions) => Promise<Transaction>} [buildDeployment] - Build a deployment transaction for an Aleo program.
 * @property {Function} [decrypt] - Decrypt a record ciphertext using the wallet's view key.
 * @property {(network: Network) => Promise<void>} [switchNetwork] - Reload the SDK binaries for a different network. Implementations bound to a specific SDK module (e.g. via @veil/provable) provide this so `walletClient.switchChain` can rebind for a local account.
 */
export type ProvingConfig = {
  mode: 'delegated' | 'local'
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
}
