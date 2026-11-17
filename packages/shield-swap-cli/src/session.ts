/**
 * Shared session plumbing for the `shield-swap` command.
 *
 * Owns the state file (`./.shield-swap/<network>/state.json` by default) and
 * the client wiring, so every command starts from `loadSession()` and gets a
 * fully authenticated client plus persistent storage for the DEX grants tied
 * to the account.
 *
 * The private key is not kept here. It is found through the account keystore
 * of `@provablehq/veil-aleo-sdk/node`: a key in the environment, then the
 * account file (`~/.aleo/accounts/<name>.json` by default). The state file
 * records the address and the account name. A state file written by an earlier
 * version still holds its key and keeps working; `shield-swap account migrate`
 * moves that key into an account file.
 *
 * Exported as `@provablehq/shield-swap-cli/session` so a script driving the SDK
 * directly can share the same state file the command line writes.
 *
 * Nothing else is stored. Swap handles belong to the SDK's blinded identity
 * store, and positions are discovered from records with
 * `client.getOwnedPositions()` — a local list of either could only ever be a
 * stale copy of what the chain already knows.
 *
 * The state is scoped by network. Nothing in it is shared between testnet and
 * mainnet: not the API grant, and above all not the identity store, whose
 * reservations are only meaningful against one chain. An account file is not
 * tied to a network, so one account can serve both.
 *
 * The state file holds API credentials, and a legacy one also holds a private
 * key — keep it out of version control (`.shield-swap/` belongs in
 * .gitignore) and treat it like a wallet file.
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
 * Everything that must survive between agent sessions.
 *
 * @property network Network the state belongs to.
 * @property privateKey Legacy only. A state file written before account files
 *   existed holds the key here, and it is still used when no other source
 *   supplies one. New state files never contain it.
 * @property address Address of the account this state belongs to. The key
 *   found at the start of a run MUST derive it.
 * @property account Name of the account file the key is read from. Selected
 *   on later runs unless a `--name` flag or `ALEO_ACCOUNT` names another.
 * @property dexApiToken Long-lived DEX API token minted by `shield-swap setup`.
 * @property accessRedeemed Whether the account has redeemed an invite code.
 */
export type ShieldSwapState = {
  network: string
  /**
   * DEX API origin this session targets. Unset means the SDK's default
   * hosted deployment. Set by `shield-swap setup` (`--api-url` / SHIELD_SWAP_API_URL);
   * the access grant, API token, and airdrop job are scoped to one
   * deployment, so setup clears them when this changes.
   */
  apiUrl?: string
  privateKey?: string
  address?: string
  account?: string
  dexApiToken?: string
  accessRedeemed?: boolean
  /** Faucet job already requested for this account — prevents double-drawing on re-runs. */
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
  // A state file that names a different network is a wrong-chain hazard: its
  // account is fine but its access grant, API token, and airdrop job are not.
  parsed.network = network
  return parsed
}

/**
 * Writes the state file atomically (temp file + rename). The temporary file
 * is created at mode 0600, because the state holds API credentials and a
 * legacy one holds a private key. A crash mid-write can never truncate it.
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
 * Builds the fully wired, authenticated session from the state file.
 *
 * Requires `shield-swap setup` to have run, so the state file records the
 * account. The signing key is resolved through the account keystore: a key in
 * the environment (`ALEO_PRIVATE_KEY`, `ALEO_PRIVATE_KEY_FILE` and their
 * `SHIELD_SWAP_` aliases), then the account file, then a key still held by a
 * state file from an earlier version. The key MUST derive the address the
 * state records. Reading an encrypted account may ask for its password on the
 * terminal.
 *
 * Authenticates with the DEX API on every call — the session JWT covers
 * everything including access/token management, and auto-renews on expiry.
 *
 * The Provable gateway needs no credentials: proving and record scanning work
 * from the private key alone, so nothing is registered or minted.
 *
 * @param options.network Network to open the session on. Defaults to
 *   `SHIELD_SWAP_NETWORK`, then testnet.
 * @param options.name Account name to read the key from. Defaults to
 *   `ALEO_ACCOUNT`, then the name recorded in the state file, then `default`.
 * @returns The authenticated client, its account, the state, the network
 *   handle and name, and the blinded identity store.
 * @throws When `shield-swap setup` has not run for the network, when the DEX
 *   API rejects the session, and with a `KeystoreError` when no key is found
 *   (`ACCOUNT_NOT_FOUND`), the key belongs to another address
 *   (`ADDRESS_MISMATCH`) or the account cannot be unlocked.
 *
 * @example
 * const { client, account } = await loadSession({ network: 'testnet' })
 */
export async function loadSession(options: { network?: string; name?: string } = {}) {
  const network = resolveNetwork(options.network)
  const state = loadState(network)
  // Setup records the address; a state file from an earlier version holds the
  // key itself. A state with neither has never been set up.
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
    // The constructor derives its own account from the key.
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
 * Makes sure the state directory has an account, and records it in the state.
 *
 * Steps, in order:
 *
 * 1. With `importKey`, the key is stored in the selected account file, unless
 *    that file already holds the same account.
 * 2. The key is resolved through the account keystore: the environment, the
 *    account file, then a key still held by a state file from an earlier
 *    version.
 * 3. When nothing is found and `allowGenerate` is true, a new account is
 *    generated and stored in the account file. A fresh key is never created
 *    silently, and never for a state that already records an address.
 *
 * The state then records the address and, when an account file exists, its
 * name; it is saved without a private key. A key supplied through the
 * environment is used for the process and written nowhere. Account files are
 * written in plaintext storage with owner-only access; `shield-swap account
 * protect` changes that. Does not contact a network.
 *
 * @param state State of the selected network. Updated in place and saved.
 * @param options.importKey Private key to store in the account file first,
 *   such as the content of a `--private-key-file`. MUST belong to the account
 *   the state already records, when it records one.
 * @param options.allowGenerate Whether a new account may be generated when no
 *   key is found. Defaults to false.
 * @param options.name Account name to use. Defaults to `ALEO_ACCOUNT`, then
 *   the name recorded in the state, then `default`.
 * @returns The updated state.
 * @throws NeedsConfigDecisionError When no key is found and none may be
 *   generated.
 * @throws When `importKey` belongs to another account than the state records,
 *   and with a `KeystoreError` when the account file holds another account
 *   (`ACCOUNT_EXISTS`), the resolved key belongs to another address
 *   (`ADDRESS_MISMATCH`), the state records an account whose key is not found
 *   (`ACCOUNT_NOT_FOUND`) or the account cannot be unlocked.
 *
 * @example
 * const state = await ensureKeyMaterial(loadState('testnet'), { allowGenerate: true })
 */
export async function ensureKeyMaterial(
  state: ShieldSwapState,
  options: { importKey?: string; allowGenerate?: boolean; name?: string } = {},
): Promise<ShieldSwapState> {
  // Rejects a state for an unknown network before any account file is written.
  resolveNetwork(state.network)
  const name = accountName(state, options.name)
  const selected = name === undefined ? {} : { name }

  if (options.importKey !== undefined) {
    const imported = accountOfKey(options.importKey, 'The key to import')
    // A legacy state may hold a key without its address.
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
    // The same account already stored with its key needs nothing. Any other
    // content is left to the keystore, which refuses to replace it.
    const existing = await accountInfo(selected)
    if (existing?.address === imported.address && existing.storage === 'none') {
      // An address-only file keeps no key by choice, and the keystore never
      // adds one to it. Saying so here beats a later "no key stored" error
      // about a key the user has just supplied.
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
    // A state that records an address belongs to that account. Generating
    // another key here would strand its funds and access.
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
  // An explicit name is recorded. Otherwise a recorded name stays, so a
  // one-off ALEO_ACCOUNT does not rewrite it.
  if (loaded.stored) state.account = options.name ?? state.account ?? loaded.stored.name
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


