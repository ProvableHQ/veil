/**
 * Shared session plumbing for the shield-swap agent skills.
 *
 * Owns the state file (`./.shield-swap/state.json` by default) and the
 * client wiring, so every runbook snippet starts from `loadSession()` and
 * gets a fully authenticated client plus persistent storage for the things
 * that must survive a crash: the private key, API credentials, and position
 * token ids. Swap handles are no longer kept here — the SDK's blinded identity
 * store owns them, which is also what makes concurrent swaps safe.
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
  DEFAULT_PROVER_URL,
  DEFAULT_SCANNER_URL,
} from '@provablehq/veil-aleo-sdk'
import type { ProvableCredentialStore } from '@provablehq/veil-aleo-sdk'
import { shieldSwapActions, getPrivateBalances, DEFAULT_PROGRAM } from '@provablehq/shield-swap-sdk'
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
/**
 * Base URL of the prover — the SDK appends the active network.
 *
 * Re-exported from the SDK rather than restated so the two cannot drift; the
 * client would default to it anyway under delegated proving.
 */
export const PROVER_URL = DEFAULT_PROVER_URL
/** Base URL of the record scanner — re-exported so the two cannot drift. */
export const SCANNER_URL = DEFAULT_SCANNER_URL

/** A liquidity position the account opened, tracked for later operations. */
export type TrackedPosition = {
  positionTokenId: string
  poolKey: string
  token0Program: string
  token1Program: string
  openedAt: string
}

/** Everything that must survive between agent sessions. */
export type ShieldSwapState = {
  network: string
  /**
   * DEX API origin this session targets. Unset means the SDK's default
   * hosted deployment. Set by setup.ts (`--api-url` / SHIELD_SWAP_API_URL);
   * the access grant, API token, and airdrop job are scoped to one
   * deployment, so setup clears them when this changes.
   */
  apiUrl?: string
  privateKey?: string
  address?: string
  provableApi?: { consumerId: string; apiKey: string }
  dexApiToken?: string
  accessRedeemed?: boolean
  /** Faucet job already requested for this account — prevents double-drawing on re-runs. */
  airdropJobId?: string
  positions: TrackedPosition[]
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
  if (!path) return { network, positions: [] }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as ShieldSwapState
  parsed.positions ??= []
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
  writeFileSync(tmp, JSON.stringify(state, jsonSafe, 2))
  chmodSync(tmp, 0o600)
  renameSync(tmp, target)
}

/** Appends a tracked position with a fresh read-modify-write. */
export function appendPosition(network: Network, position: TrackedPosition): ShieldSwapState {
  const state = loadState(network)
  state.positions.push(position)
  saveState(state)
  return state
}

function jsonSafe(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
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

/**
 * Builds the fully wired, authenticated session from the state file.
 *
 * Requires setup.ts to have run (key material in the state file).
 * Authenticates with the DEX API on every call — the session JWT covers
 * everything including access/token management, and auto-renews on expiry.
 *
 * Provable API credentials are not required up front: the client registers a
 * consumer through {@link credentialStore} on first prove or scan when the
 * state file holds none.
 */
export async function loadSession(options: { network?: string } = {}) {
  const network = resolveNetwork(options.network)
  const state = loadState(network)
  if (!state.privateKey) {
    throw new Error(
      `No shield-swap session found for ${network} — run setup.ts --network ${network} first (see startup.md).`,
    )
  }

  const aleo = await loadNetwork(network)
  // Credentials reach both the prover and the scanner through one session the
  // client builds from the store, so a single JWT serves both.
  const scanner = aleo.createRemoteScanner({ url: SCANNER_URL })
  const { walletClient, account } = aleo.createAleoClient({
    privateKey: state.privateKey,
    networkUrl: NETWORK_URL,
    provingMode: 'delegated',
    proverUrl: PROVER_URL,
    credentialStore: credentialStoreFor(network),
    // Faucet-funded accounts hold no public credits; the delegated prover
    // pays fees from its FeeMaster account. Opt out with
    // SHIELD_SWAP_FEE_MASTER=0 when the account funds its own fees.
    useFeeMaster: process.env.SHIELD_SWAP_FEE_MASTER !== '0',
    records: scanner,
  })
  // SHIELD_SWAP_API_URL overrides for one-off runs; the persistent choice
  // lives in the state file (setup.ts --api-url).
  const apiUrl = process.env.SHIELD_SWAP_API_URL ?? state.apiUrl
  // The identity store is what makes concurrent swaps safe and unclaimed swaps
  // recoverable, and it is scoped by network because a reservation is only
  // meaningful against the chain it was checked on. Every swap through this
  // client reserves and records automatically.
  const blindedIdentities = fileBlindedIdentityStore(blindedStorePath(network))
  const client = walletClient.extend(
    shieldSwapActions({ api: { baseUrl: apiUrl }, blindedIdentities }),
  )
  await client.authenticateShieldSwap()

  return { client, account, scanner, state, aleo, network, blindedIdentities }
}

/**
 * Reads the account's holdings per token, public and private combined.
 *
 * The faucet airdrops PRIVATE records, so public balances alone always read
 * zero for a fresh account — any funding check must include the private
 * side (scanned via the record service, which indexes asynchronously).
 */
export async function getHoldings(
  client: Awaited<ReturnType<typeof loadSession>>['client'],
  address: string,
): Promise<
  Array<{
    tokenId: string
    symbol: string
    decimals: number
    underlyingProgram?: string
    publicAmount: bigint
    privateAmount: bigint
  }>
> {
  const tokens = (await client.api.getTokens()).data
  const pub = new Map(
    (await client.api.getPublicBalances({ user: address })).data.map((b) => [b.token_id, BigInt(b.balance ?? 0)]),
  )
  // Private records live in the underlying program (a plain token's own, or a
  // wrapped asset's underlying — credits for ALEO).
  const programs = tokens.map((t) => t.underlying_program).filter((p): p is string => !!p)
  const priv = await getPrivateBalances(client, { programs })
  return tokens.map((t) => ({
    tokenId: t.address,
    symbol: t.symbol,
    decimals: t.decimals,
    underlyingProgram: t.underlying_program ?? undefined,
    publicAmount: pub.get(t.address) ?? 0n,
    privateAmount: t.underlying_program ? (priv[t.underlying_program] ?? 0n) : 0n,
  }))
}

/**
 * Builds the imports map a DEX write needs: the given token programs PLUS
 * the DEX program's own declared imports. The prover resolves the closure
 * of supplied sources but not the main program's static imports (e.g.
 * `test_shield_swap_multisig_core.aleo`), so a write submitted with only
 * the token programs fails with "its import … must be added first".
 */
export async function buildDexImports(
  client: Awaited<ReturnType<typeof loadSession>>['client'],
  tokenPrograms: string[],
  program = DEFAULT_PROGRAM,
): Promise<Record<string, string>> {
  const { getProgram } = await import('@provablehq/veil-core')
  const imports: Record<string, string> = {}
  for (const p of new Set(tokenPrograms)) {
    imports[p] = await getProgram(client, { programId: p })
  }
  const dexSource = await getProgram(client, { programId: program })
  for (const m of dexSource.matchAll(/^import ([\w.]+);/gm)) {
    const dep = m[1]!
    if (!imports[dep]) imports[dep] = await getProgram(client, { programId: dep })
  }
  return imports
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

/**
 * Backs Provable API credentials with a network's state file.
 *
 * The SDK reads through this on first use and writes back once, immediately
 * after registering a consumer — the API key is issued once, so the write
 * must not be deferred. State is re-read on save rather than captured, so a
 * concurrent update elsewhere in the run is not clobbered.
 */
export function credentialStoreFor(network: Network): ProvableCredentialStore {
  return {
    load: () => loadState(network).provableApi,
    save: (credentials) => {
      const state = loadState(network)
      state.provableApi = credentials
      saveState(state)
    },
  }
}

