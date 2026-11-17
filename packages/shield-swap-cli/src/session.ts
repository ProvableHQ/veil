/**
 * Creates authenticated Shield Swap sessions for CLI commands and scripts.
 *
 * Import `@provablehq/shield-swap-cli/session` to share the CLI's saved account
 * selection, DEX credentials, and blinded identity store.
 *
 * Session state is saved in `./.shield-swap/<network>/state.json` by default.
 * Signing keys come from the environment, an account file, or a private key
 * already present in the state file. Generated and imported keys are saved
 * in account files, normally under `~/.aleo/accounts`.
 *
 * Testnet and mainnet use separate session state and blinded identity files.
 * Account files can be used on either network. Swap recovery data belongs to
 * the blinded identity store; positions are read with `getOwnedPositions()`.
 *
 * Keep `.shield-swap/` out of version control. State files contain API
 * credentials and may also contain private keys.
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadNetwork, generateAccount } from '@provablehq/veil-aleo-sdk'
import { KeystoreError, accountInfo, saveAccount, type LoadedAccount } from '@provablehq/veil-aleo-sdk/node'
import { shieldSwapActions, getPrivateBalances, parseUnits, DEFAULT_PROGRAM } from '@provablehq/shield-swap-sdk'
import { fileBlindedIdentityStore } from '@provablehq/shield-swap-sdk/node'
import { accountName, accountOfKey, resolveAccount } from './account-lookup.js'
import { STATE_ROOT, existingStatePath, statePath, writeStateFile } from './state-files.js'

/** The networks these scripts run against. */
export type Network = 'testnet' | 'mainnet'

/**
 * Resolves the network from an explicit choice, the environment, or the default.
 *
 * Testnet is the default and mainnet is never reached by omission: a script has
 * to be told, because everything downstream — the DEX API host, the prover, the
 * scanner, the token registry, and the identity store — is per-network, and the
 * mainnet ones move real value.
 *
 * @param explicit A `--network` value, when a script parsed one.
 * @throws When the value is neither network, rather than silently using testnet.
 */
export function resolveNetwork(explicit?: string): Network {
  const value = explicit ?? process.env.SHIELD_SWAP_NETWORK ?? 'testnet'
  if (value !== 'testnet' && value !== 'mainnet') {
    throw new Error(`Unknown network "${value}" — use testnet or mainnet.`)
  }
  return value
}

export const NETWORK_URL = 'https://edge.provable.com/api/v2'

/**
 * Stores the account selection and DEX credentials for a network's session.
 *
 * @property network Network associated with the session state.
 * @property apiUrl Optional DEX API origin. Defaults to the SDK's hosted API.
 *   Setup clears access, API token, and airdrop state when this origin changes.
 * @property privateKey Optional fallback key, used when the environment and
 *   account file supply none. Setup preserves existing values but stores new
 *   keys in account files. Use `account migrate --remove-legacy-key` to remove it.
 * @property address Optional account address checked against the resolved key.
 *   Setup records it; a session requires this address or a stored private key.
 * @property account Optional saved account name. Used unless an explicit name
 *   or `ALEO_ACCOUNT` overrides it; otherwise the name defaults to `default`.
 * @property dexApiToken Optional long-lived DEX API token created during setup.
 * @property accessRedeemed Records whether setup confirmed invite-code access.
 *   Absent until access has been checked.
 * @property airdropJobId Optional faucet job to resume checking on subsequent
 *   setup runs instead of requesting another airdrop.
 *
 * @example
 * const state: ShieldSwapState = { network: 'testnet', account: 'trading' }
 */
export type ShieldSwapState = {
  network: string
  apiUrl?: string
  privateKey?: string
  address?: string
  account?: string
  dexApiToken?: string
  accessRedeemed?: boolean
  airdropJobId?: string
}

/** Per-network state directory. Nothing is shared between networks. */
export function stateDir(network: Network): string {
  return join(STATE_ROOT, network)
}

/**
 * Where the blinded identity store lives for a network.
 *
 * Scoped by network because a reservation is only meaningful against the chain
 * it was checked on: counters reserved against testnet's
 * `used_blinded_addresses` say nothing about mainnet's, and one shared file
 * would hand out identities the other chain has already consumed.
 */
export function blindedStorePath(network: Network): string {
  return join(stateDir(network), 'blinded.json')
}

/**
 * Reads a network's state file, or returns a fresh empty state.
 *
 * Falls back to the pre-network layout for testnet only, so an existing
 * `.shield-swap/state.json` keeps working; the next save writes it to the
 * network-scoped path.
 */
export function loadState(network: Network): ShieldSwapState {
  const path = existingStatePath(network)
  if (!path) return { network }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as ShieldSwapState
  // Use the requested network even if the file contains a different network name.
  parsed.network = network
  return parsed
}

/**
 * Saves session state for its selected network.
 *
 * Creates the network directory if needed and replaces the state file
 * atomically. Writes with mode 0600 for owner-only access on POSIX systems.
 *
 * @param state Session data to write, including the network that selects its path.
 * @throws If the network is invalid or the state cannot be serialized or written.
 *
 * @example
 * saveState({ network: 'testnet', account: 'trading' })
 */
export function saveState(state: ShieldSwapState): void {
  const network = resolveNetwork(state.network)
  mkdirSync(stateDir(network), { recursive: true })
  writeStateFile(statePath(network), state)
}


/**
 * Renders a raw base-unit amount in human units ("0.0534 ETH"), the ONLY
 * format that should ever reach the user. Raw units (wei-style integers)
 * are SDK-facing; showing them to a person misstates their balances by
 * orders of magnitude.
 */
export function formatAmount(amount: bigint, decimals: number, symbol?: string): string {
  const scale = 10n ** BigInt(decimals)
  const whole = amount / scale
  const frac = amount % scale
  let s = whole.toLocaleString('en-US')
  if (frac > 0n) {
    // Full precision minus trailing zeros — tiny testnet amounts live many
    // places below the decimal point and must not round away to nothing.
    const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
    if (fracStr) s += `.${fracStr}`
  }
  return symbol ? `${s} ${symbol}` : s
}

/** What {@link namedAmounts} needs of a pool's token to place an amount. */
export type AmountToken = { id: string; symbol: string; decimals: number }

/**
 * Places caller-named amounts into a pool's own token order.
 *
 * A pool orders its tokens by id, not by anything a caller types, so `--amount0`
 * is unknowable without reading the pool first: naming a pair `USDCx:ETH` does
 * not make USDCx side 0. `--amount USDCx:0.5` names the token instead and is
 * matched here, while `--amount0`/`--amount1` stay available for callers who know
 * the order. Parsing is the inverse of {@link formatAmount}: human decimals in,
 * raw base units out. Pure and local.
 *
 * @param params.entries `--amount` values, each `<symbol|id>:<decimal>`.
 * @param params.indexed The raw `--amount0` and `--amount1` strings, in that
 *   order, `undefined` where the flag was absent.
 * @param params.tokens The pool's tokens in ITS order — `[token0, token1]`.
 * @returns Raw base units per side, `undefined` where nothing named that side.
 * @throws When an entry is malformed, names a token outside the pair, or names a
 *   side twice — including once by symbol and once by index, where preferring
 *   either would commit an amount the caller did not ask for.
 *
 * @example
 * const { amount0, amount1 } = namedAmounts({
 *   entries: ['USDCx:0.5'],
 *   indexed: [undefined, undefined],
 *   tokens: [token0, token1],
 * })
 */
export function namedAmounts(params: {
  entries: string[]
  indexed: readonly [string | undefined, string | undefined]
  tokens: readonly [AmountToken, AmountToken]
}): { amount0: bigint | undefined; amount1: bigint | undefined } {
  const [token0, token1] = params.tokens
  const amounts: Array<bigint | undefined> = [
    params.indexed[0] ? parseUnits(params.indexed[0], token0.decimals) : undefined,
    params.indexed[1] ? parseUnits(params.indexed[1], token1.decimals) : undefined,
  ]
  // Tracked alongside so a collision can name both flags rather than just the token.
  const namedBy = [params.indexed[0] ? '--amount0' : undefined, params.indexed[1] ? '--amount1' : undefined]

  for (const entry of params.entries) {
    const parts = entry.split(':')
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`--amount takes <symbol>:<amount>, e.g. --amount ${token0.symbol}:0.5 — got "${entry}"`)
    }
    const [name, value] = parts as [string, string]
    const wanted = name.trim()
    const side = [token0, token1].findIndex(
      (token) => token.symbol.toLowerCase() === wanted.toLowerCase() || token.id === wanted,
    )
    if (side === -1) {
      throw new Error(`"${wanted}" is not in this pool's pair — it holds ${token0.symbol} and ${token1.symbol}.`)
    }
    const token = side === 0 ? token0 : token1
    if (amounts[side] !== undefined) {
      throw new Error(`${token.symbol} is named twice, by ${namedBy[side]} and --amount ${entry}.`)
    }
    amounts[side] = parseUnits(value.trim(), token.decimals)
    namedBy[side] = `--amount ${entry}`
  }
  return { amount0: amounts[0], amount1: amounts[1] }
}

/**
 * Opens the CLI's trading account for use in a Veil script.
 *
 * Run `shield-swap setup` first, then call this helper to trade with the same
 * address and retain swap recovery data between the CLI and the script.
 * The saved address is checked against the resolved key to prevent signing
 * with a different account. An encrypted account may prompt for its password;
 * unattended scripts need a password source such as `ALEO_ACCOUNT_PASSWORD`
 * or a password saved in the macOS Keychain.
 *
 * Authenticates with the DEX API on each call and opens the network's blinded
 * identity store for swap reservations and recovery. If `VEIL_INVENTORY_DB`
 * is set, also opens that database for record reservations.
 *
 * @param options Optional network and account selection. Defaults to `{}`.
 * @param options.network Optional network. Defaults to `SHIELD_SWAP_NETWORK`,
 *   then `testnet`.
 * @param options.name Optional account name. Defaults to `ALEO_ACCOUNT`, then
 *   the name in the state file, then `default`.
 * @returns The authenticated client, signing account, session state, network
 *   name and SDK, and blinded identity store.
 * @throws If session state is missing, the key does not match the saved address,
 *   the account cannot be unlocked, storage cannot be opened, or authentication fails.
 *
 * @example
 * const { client, account } = await loadSession({ network: 'testnet' })
 */
export async function loadSession(options: { network?: string; name?: string } = {}) {
  const network = resolveNetwork(options.network)
  const state = loadState(network)
  // Accept either a saved address or a key from which the address can be derived.
  if (!state.address && !state.privateKey) {
    throw new Error(
      `No shield-swap session found for ${network} — run \`shield-swap setup --network ${network}\` first (see startup.md).`,
    )
  }
  const { account: signer } = await resolveAccount({ state, name: options.name })

  const aleo = await loadNetwork(network)
  // Open the shared journal only when the caller explicitly selects a database.
  const inventoryPath = process.env.VEIL_INVENTORY_DB
  const inventoryStore = inventoryPath
    ? await (await import('./storage.js')).sqliteRecordInventoryStore(inventoryPath)
    : undefined
  // No prover or scanner URL: both default to the Provable gateway and take the
  // network from the client, so naming them here would only risk drift.
  const { walletClient, account } = aleo.createAleoClient({
    privateKey: signer.privateKey,
    networkUrl: NETWORK_URL,
    // Apply the shared reservations to wallet writes and Shield Swap actions.
    recordManagement: inventoryStore ? {
      enabled: true, store: inventoryStore, chainId: `aleo:${network}`,
    } : undefined,
    // Faucet-funded accounts hold no public credits; the delegated prover
    // pays fees from its FeeMaster account. Opt out with
    // SHIELD_SWAP_FEE_MASTER=0 when the account funds its own fees.
    useFeeMaster: process.env.SHIELD_SWAP_FEE_MASTER !== '0',
  })
  // SHIELD_SWAP_API_URL overrides for one-off runs; the persistent choice
  // lives in the state file (`shield-swap setup --api-url`).
  const apiUrl = process.env.SHIELD_SWAP_API_URL ?? state.apiUrl
  // The identity store is what makes concurrent swaps safe and unclaimed swaps
  // recoverable, and it is scoped by network because a reservation is only
  // meaningful against the chain it was checked on. Every swap through this
  // client reserves and records automatically.
  const blindedIdentities = fileBlindedIdentityStore(blindedStorePath(network))
  // SDK proving supplies automatic freezelist witnesses for every write command;
  // shieldSwapActions checks current roots and caches witnesses for this session.
  const client = walletClient.extend(
    shieldSwapActions({ api: { baseUrl: apiUrl }, blindedIdentities }),
  )
  try {
    await client.authenticateShieldSwap()
  } catch (error) {
    // A pinned host is invisible state: it lives in a file nobody re-reads, so
    // when the deployment behind it is retired every call fails with a bare 404
    // and nothing points at the pin. Name it, and say how to drop it.
    if (!apiUrl) throw error
    const source =
      process.env.SHIELD_SWAP_API_URL === apiUrl ? 'SHIELD_SWAP_API_URL' : `apiUrl in ${statePath(network)}`
    throw new Error(
      `could not authenticate with the DEX API at ${apiUrl}, which is pinned by ${source} rather than ` +
        `derived from the network. If that deployment is gone, re-pin with \`shield-swap setup --api-url ` +
        `<origin>\` or clear the field to fall back to the default for ${network}.`,
      { cause: error },
    )
  }

  return { client, account, state, aleo, network, blindedIdentities }
}



/** Polls a predicate until it returns true or attempts run out. */
export async function pollUntil(fn: () => Promise<boolean>, attempts: number, intervalMs: number): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return false
}

/**
 * Sets up a Shield Swap session to use an existing or newly created account.
 *
 * Use `importKey` to save an existing key or `allowGenerate` to create an
 * account when no key is available. Otherwise, uses the environment, account
 * file, or key in the state file. An existing session cannot switch addresses.
 *
 * Prefer creating or importing a protected account with `shield-swap account`
 * before calling this helper. New account files written here use plaintext:
 * anyone who can read the file can use its key. Use `account protect --storage
 * keychain` on macOS or `--storage encrypted` to protect an existing file.
 * Environment keys are not copied to disk, and keys already in the state file
 * are preserved. Loading an encrypted account may prompt for a password.
 *
 * @param state Session state to update in place and save.
 * @param options Optional key import, generation, and account selection.
 *   Defaults to `{}`.
 * @param options.importKey Optional private key to save before account lookup.
 *   Must match the saved address, if present. When omitted, imports no key.
 * @param options.allowGenerate Creates an account only if no key is found and
 *   the state has no address. Defaults to false.
 * @param options.name Optional account name. Defaults to `ALEO_ACCOUNT`, then
 *   the name in the state file, then `default`.
 * @returns The updated and saved state.
 * @throws NeedsConfigDecisionError If no account is available and generation
 *   is not allowed.
 * @throws If the imported or resolved key conflicts with the saved account,
 *   an address-only file cannot store the imported key, a configured account
 *   has no available key, or account or state storage fails.
 *
 * @example
 * const state = await ensureKeyMaterial(loadState('testnet'), { allowGenerate: true })
 */
export async function ensureKeyMaterial(
  state: ShieldSwapState,
  options: { importKey?: string; allowGenerate?: boolean; name?: string } = {},
): Promise<ShieldSwapState> {
  // Validate the network before writing an account file.
  resolveNetwork(state.network)
  const name = accountName(state, options.name)
  const selected = name === undefined ? {} : { name }

  if (options.importKey !== undefined) {
    const imported = accountOfKey(options.importKey, 'The key to import')
    // Derive the expected address if the state contains only a key.
    const recorded =
      state.address ??
      (state.privateKey ? accountOfKey(state.privateKey, 'The key in the state file').address : undefined)
    if (recorded !== undefined && recorded !== imported.address) {
      throw new Error(
        `a DIFFERENT account is already configured here (${recorded}). ` +
          'Refusing to switch silently — its funds and access live on that key. To use the imported ' +
          `key instead, move or delete the state directory first, then re-run with --private-key-file.`,
      )
    }
    // Preserve the existing storage when the same account is already saved.
    const existing = await accountInfo(selected)
    if (existing?.address === imported.address && existing.storage === 'none') {
      // Address-only storage cannot accept an imported key. Explain how to
      // supply the key or replace the file before attempting a lookup.
      throw new KeystoreError(
        'KEY_NOT_STORED',
        `Account file ${existing.path} records the address ${existing.address} without a key, so the imported ` +
          'key cannot be stored in it. Supply the key through ALEO_PRIVATE_KEY or ALEO_PRIVATE_KEY_FILE on ' +
          'every run, or remove that file and import again.',
      )
    }
    if (existing?.address !== imported.address) await saveAccount(imported, selected)
  }

  let loaded: LoadedAccount
  try {
    loaded = await resolveAccount({ state, name: options.name })
  } catch (error) {
    if (!(error instanceof KeystoreError) || error.code !== 'ACCOUNT_NOT_FOUND') throw error
    // Require the existing account's key; a generated account cannot access its funds.
    if (state.address) {
      throw new KeystoreError(
        'ACCOUNT_NOT_FOUND',
        `This state directory is set up for ${state.address}, and the key of that account was not found. ${error.message}`,
      )
    }
    if (!options.allowGenerate) throw new NeedsConfigDecisionError()
    await saveAccount(generateAccount(), selected)
    loaded = await resolveAccount({ state, name: options.name })
  }

  state.address = loaded.account.address
  // Save an explicit name even before its account file exists: a key from the
  // environment may be imported under that name later. Preserve the saved name
  // for environment overrides.
  if (options.name !== undefined) state.account = options.name
  else if (loaded.stored) state.account ??= loaded.stored.name
  saveState(state)
  return state
}

/** Signals that setup must ask the user about existing config before creating anything. */
export class NeedsConfigDecisionError extends Error {
  constructor() {
    super('no key material found and none provided')
    this.name = 'NeedsConfigDecisionError'
  }
}


