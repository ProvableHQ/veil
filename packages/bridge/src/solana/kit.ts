import { BridgeError } from '../errors/bridgeErrors.js'

let kitModulePromise: Promise<typeof import('@solana/kit')> | undefined

/**
 * Lazily imports the optional `@solana/kit` peer dependency.
 *
 * This is the only module in the package permitted to import `@solana/kit`
 * directly, so the main entry point stays free of the dependency for callers
 * who never touch Solana. The import is performed at most once per process;
 * the resolved module promise is cached and reused by every caller. Purely a
 * module loader — it hits neither the network nor a wallet.
 *
 * @returns The `@solana/kit` module namespace once dynamic import resolves.
 * @throws BridgeError When `@solana/kit` cannot be resolved, naming the
 * install command and wrapping the original module-resolution error as
 * `cause`.
 *
 * @example
 * const kit = await loadKit()
 * const signer = await kit.createKeyPairSignerFromBytes(secretKeyBytes)
 */
export async function loadKit(): Promise<typeof import('@solana/kit')> {
  kitModulePromise ??= import('@solana/kit')
  try {
    return await kitModulePromise
  } catch (cause) {
    throw new BridgeError(
      'Solana support requires the optional peer dependency @solana/kit; install it with: pnpm add @solana/kit',
      { cause },
    )
  }
}
