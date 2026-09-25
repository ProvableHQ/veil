import { readFile, writeFile } from 'node:fs/promises'

/**
 * Loads an existing key or saves a generated account before any network calls.
 *
 * @param file Account file, written with owner-only permissions.
 * @param supplied Optional key provided by the caller; never saved to disk.
 * @param generate Creates a key when no supplied or saved account exists.
 * @returns The private key to use for this run.
 * @throws If an existing account file cannot be read or contains no key.
 */
export async function loadPrivateKey(
  file: string,
  supplied: string | undefined,
  generate: () => string,
): Promise<string> {
  if (supplied !== undefined) {
    if (!supplied.trim()) throw new Error('SHIELD_SWAP_PRIVATE_KEY is empty')
    return supplied
  }
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'))
    if (typeof saved.privateKey !== 'string' || !saved.privateKey) {
      throw new Error('Saved account has no private key; refusing to replace it')
    }
    return saved.privateKey
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const privateKey = generate()
  await writeFile(file, JSON.stringify({ privateKey }), { mode: 0o600, flag: 'wx' })
  return privateKey
}

/**
 * Records submission intent before a swap can move tokens.
 *
 * @param file Marker retained across restarts, including failed submissions.
 * @param details Route imports needed by the claim-only recovery command.
 * @throws If submission has already started; the caller must reconcile it.
 */
export async function reserveSwap(file: string, details: unknown): Promise<void> {
  try {
    await writeFile(file, JSON.stringify(details), { mode: 0o600, flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('A swap was already attempted. Run npm run claim; do not submit it again.')
    }
    throw error
  }
}
