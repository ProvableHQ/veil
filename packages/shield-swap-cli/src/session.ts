/**
 * Shared session plumbing for the `shield-swap` command.
 *
 * Owns the state file (`./.shield-swap/<network>/state.json` by default) and
 * the client wiring, so every command starts from `loadSession()` and gets a
 * fully authenticated client plus persistent storage for the one thing that
 * must survive a crash and cannot be rediscovered: the private key, plus the
 * DEX grants tied to it.
 *
 * Exported as `@provablehq/shield-swap-cli/session` so a script driving the SDK
 * directly can share the same state file the command line writes.
 *
 * Nothing else is stored. Swap handles belong to the SDK's blinded identity
 * store, and positions are discovered from records with
 * `client.getOwnedPositions()` — a local list of either could only ever be a
 * stale copy of what the chain already knows.
 *
 * Everything is scoped by network. Nothing is shared between testnet and
 * mainnet: not the key, not the API grant, and above all not the identity
 * store, whose reservations are only meaningful against one chain.
 *
 * The state file holds a private key and API credentials — keep it out of
 * version control (`.shield-swap/` belongs in .gitignore) and treat it like
 * a wallet file.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import {
  loadNetwork,
  generateAccount,
} from '@provablehq/veil-aleo-sdk'
import { fileCredentialStore } from '@provablehq/veil-aleo-sdk/node'
import { shieldSwapActions, getPrivateBalances, parseUnits, DEFAULT_PROGRAM } from '@provablehq/shield-swap-sdk'
import { fileBlindedIdentityStore } from '@provablehq/shield-swap-sdk/node'

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

export const NETWORK_URL = 'https://api.provable.com/v2'

/** Everything that must survive between agent sessions. */
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
  dexApiToken?: string
  accessRedeemed?: boolean
  /** Faucet job already requested for this account — prevents double-drawing on re-runs. */
  airdropJobId?: string
}

const STATE_ROOT = process.env.SHIELD_SWAP_STATE_DIR ?? join(process.cwd(), '.shield-swap')

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
 * Where Provable API credentials live for a network.
 *
 * Separate from the state file because the SDK owns the format: `shield-swap setup`
 * hands `fileCredentialStore` this path and the client reads and writes it
 * directly, including registering a consumer when the file is absent.
 */
export function credentialsPath(network: Network): string {
  return join(stateDir(network), 'provable-credentials.json')
}

function statePath(network: Network): string {
  return join(stateDir(network), 'state.json')
}

/** The pre-network layout, still read for testnet so existing keys survive. */
const LEGACY_STATE_PATH = join(STATE_ROOT, 'state.json')

/**
 * Reads a network's state file, or returns a fresh empty state.
 *
 * Falls back to the pre-network layout for testnet only, so an existing
 * `.shield-swap/state.json` keeps working; the next save writes it to the
 * network-scoped path.
 */
export function loadState(network: Network): ShieldSwapState {
  const path = existsSync(statePath(network))
    ? statePath(network)
    : network === 'testnet' && existsSync(LEGACY_STATE_PATH)
      ? LEGACY_STATE_PATH
      : undefined
  if (!path) return { network }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as ShieldSwapState
  // A state file that names a different network is a wrong-chain hazard: its
  // key is fine but its access grant, API token, and airdrop job are not.
  parsed.network = network
  return parsed
}

/**
 * Writes the state file atomically (temp file + rename, 0600 — it holds the
 * private key). A crash mid-write can never truncate the only copy of the
 * key and the open swap handles.
 */
export function saveState(state: ShieldSwapState): void {
  const network = resolveNetwork(state.network)
  mkdirSync(stateDir(network), { recursive: true })
  const target = statePath(network)
  const tmp = `${target}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2))
  chmodSync(tmp, 0o600)
  renameSync(tmp, target)
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
 * Requires `shield-swap setup` to have run (key material in the state file).
 * Authenticates with the DEX API on every call — the session JWT covers
 * everything including access/token management, and auto-renews on expiry.
 *
 * Provable API credentials are not required up front: the client registers a
 * consumer through the credential file on first prove or scan when it holds
 * none — though `shield-swap setup` registers and verifies eagerly, so a session built
 * after setup has working credentials rather than untested ones.
 */
export async function loadSession(options: { network?: string } = {}) {
  const network = resolveNetwork(options.network)
  const state = loadState(network)
  if (!state.privateKey) {
    throw new Error(
      `No shield-swap session found for ${network} — run \`shield-swap setup --network ${network}\` first (see startup.md).`,
    )
  }

  const aleo = await loadNetwork(network)
  // Credentials reach both the prover and the scanner through one session the
  // client builds from the store, so a single JWT serves both.
  // No prover or scanner URL: both default to the Provable API and take the
  // network from the client, so naming them here would only risk drift.
  const scanner = aleo.createRemoteScanner()
  const { walletClient, account } = aleo.createAleoClient({
    privateKey: state.privateKey,
    networkUrl: NETWORK_URL,
    provingMode: 'delegated',
    credentialStore: fileCredentialStore(credentialsPath(network)),
    // Faucet-funded accounts hold no public credits; the delegated prover
    // pays fees from its FeeMaster account. Opt out with
    // SHIELD_SWAP_FEE_MASTER=0 when the account funds its own fees.
    useFeeMaster: process.env.SHIELD_SWAP_FEE_MASTER !== '0',
    records: scanner,
  })
  // SHIELD_SWAP_API_URL overrides for one-off runs; the persistent choice
  // lives in the state file (`shield-swap setup --api-url`).
  const apiUrl = process.env.SHIELD_SWAP_API_URL ?? state.apiUrl
  // The identity store is what makes concurrent swaps safe and unclaimed swaps
  // recoverable, and it is scoped by network because a reservation is only
  // meaningful against the chain it was checked on. Every swap through this
  // client reserves and records automatically.
  const blindedIdentities = fileBlindedIdentityStore(blindedStorePath(network))
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

  return { client, account, scanner, state, aleo, network, blindedIdentities }
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
 * Resolves key material and stores it. Priority: existing state → imported
 * key (`importKey`) → fresh generation, but only when `allowGenerate` is
 * true. Returning users keep their account; a fresh key is never created
 * silently.
 */
export async function ensureKeyMaterial(
  state: ShieldSwapState,
  options: { importKey?: string; allowGenerate?: boolean } = {},
): Promise<ShieldSwapState> {
  const network = resolveNetwork(state.network)
  await loadNetwork(network) // initializes the WASM the account helpers use
  if (state.privateKey && options.importKey && options.importKey !== state.privateKey) {
    throw new Error(
      `a DIFFERENT account is already configured here (${state.address ?? 'address unknown'}). ` +
        'Refusing to switch silently — its funds and access live on that key. To use the imported ' +
        `key instead, move or delete the state directory first, then re-run with --private-key-file.`,
    )
  }
  if (!state.privateKey) {
    if (options.importKey) {
      state.privateKey = options.importKey
    } else if (options.allowGenerate) {
      state.privateKey = generateAccount().privateKey
    } else {
      throw new NeedsConfigDecisionError()
    }
  }
  // Derive the address from the key so imported/seeded states are complete.
  const aleo = await loadNetwork(network)
  state.address = aleo.privateKeyToAccount(state.privateKey).address
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


