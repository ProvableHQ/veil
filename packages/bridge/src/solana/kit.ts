import { BridgeError } from '../errors/bridgeErrors.js'

let kitModulePromise: Promise<typeof import('@solana/kit')> | undefined

/**
 * Lazily imports the optional `@solana/kit` peer dependency.
 *
 * This is the only module in the package permitted to import `@solana/kit`
 * directly, so applications that never use Solana do not load the optional
 * dependency. The import is performed at most once per process and does not
 * contact a chain or wallet.
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
