/**
 * The Aleo WASM SDK (`@provablehq/sdk`), an optional peer dependency.
 *
 * It is loaded lazily so that read-only and wallet-backed code paths never
 * touch WASM: dapps talking to a privacy-preserving wallet derive wallet-side,
 * and pool/price reads need no crypto at all. Only local-account derivations
 * (blinded identities, key hashing) pull it in, on first use.
 */
export type AleoSdk = typeof import('@provablehq/sdk')

let sdkPromise: Promise<AleoSdk> | undefined

/**
 * Lazily imports the optional `@provablehq/sdk` peer dependency.
 *
 * The first call triggers the dynamic import; later calls reuse the cached
 * promise. A failed import resets the cache so a caller can retry after
 * installing the package, and rethrows with an actionable message. Loading a
 * package that only reads chain state or drives a wallet never calls this, so
 * the WASM SDK stays out of those install and startup paths.
 *
 * @returns The loaded WASM SDK module namespace.
 * @throws When `@provablehq/sdk` is not installed — the message names the
 *   install command and the wallet alternative.
 *
 * @example
 * const { BHP256, Plaintext } = await loadSdk()
 */
export async function loadSdk(): Promise<AleoSdk> {
  if (!sdkPromise) {
    sdkPromise = import('@provablehq/sdk').catch((cause) => {
      // Reset so a later call retries after the user installs the package.
      sdkPromise = undefined
      throw new Error(
        'This operation requires the optional @provablehq/sdk peer dependency. ' +
          'Run `pnpm add @provablehq/sdk` (local accounts derive locally), ' +
          'or use a wallet account — a privacy-preserving wallet derives ' +
          'wallet-side without it.',
        { cause },
      )
    })
  }
  return sdkPromise
}
