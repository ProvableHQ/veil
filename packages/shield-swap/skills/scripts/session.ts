/**
 * Shared session plumbing for the shield-swap agent skills.
 *
 * Owns the state file (`./.shield-swap/state.json` by default) and the
 * client wiring, so every runbook snippet starts from `loadSession()` and
 * gets a fully authenticated client plus persistent storage for the things
 * that must survive a crash: the private key, API credentials, open swap
 * handles, and position token ids.
 *
 * The state file holds a private key and API credentials — keep it out of
 * version control (`.shield-swap/` belongs in .gitignore) and treat it like
 * a wallet file.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { loadNetwork, generateAccount } from '@provablehq/veil-aleo-sdk'
import { shieldSwapActions, authenticateWithAccount, getPrivateBalances, dustScale } from '@provablehq/shield-swap-sdk'
import type { SwapHandle, MultiHopSwapHandle } from '@provablehq/shield-swap-sdk'

export const NETWORK = 'testnet' as const
export const NETWORK_URL = 'https://api.provable.com/v2'
export const PROVER_URL = `https://api.provable.com/prove/${NETWORK}`
export const SCANNER_URL = 'https://api.provable.com/scanner'
export const CONSUMERS_URL = 'https://api.provable.com/consumers'

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
  privateKey?: string
  address?: string
  provableApi?: { consumerId: string; apiKey: string }
  dexApiToken?: string
  accessRedeemed?: boolean
  /** Faucet job already requested for this account — prevents double-drawing on re-runs. */
  airdropJobId?: string
  /** Open swap handles, JSON-safe (bigints as strings). The only path to unclaimed funds. */
  swapHandles: Record<string, unknown>[]
  positions: TrackedPosition[]
}

const STATE_DIR = process.env.SHIELD_SWAP_STATE_DIR ?? join(process.cwd(), '.shield-swap')
const STATE_PATH = join(STATE_DIR, 'state.json')

/** Reads the state file, or returns a fresh empty state. */
export function loadState(): ShieldSwapState {
  if (!existsSync(STATE_PATH)) {
    return { network: NETWORK, swapHandles: [], positions: [] }
  }
  const parsed = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as ShieldSwapState
  parsed.swapHandles ??= []
  parsed.positions ??= []
  return parsed
}

/**
 * Writes the state file atomically (temp file + rename, 0600 — it holds the
 * private key). A crash mid-write can never truncate the only copy of the
 * key and the open swap handles.
 */
export function saveState(state: ShieldSwapState): void {
  mkdirSync(STATE_DIR, { recursive: true })
  const tmp = `${STATE_PATH}.tmp`
  writeFileSync(tmp, JSON.stringify(state, jsonSafe, 2))
  chmodSync(tmp, 0o600)
  renameSync(tmp, STATE_PATH)
}

/**
 * Appends a swap handle with a fresh read-modify-write, so a long-running
 * script holding a stale state snapshot cannot clobber handles another
 * script persisted meanwhile. Returns the reloaded state.
 */
export function appendSwapHandle(handle: SwapHandle | MultiHopSwapHandle): ShieldSwapState {
  const state = loadState()
  state.swapHandles.push(serializeHandle(handle))
  saveState(state)
  return state
}

/** Removes a claimed handle by its transaction id, with a fresh read-modify-write. */
export function removeSwapHandle(transactionId: string): ShieldSwapState {
  const state = loadState()
  state.swapHandles = state.swapHandles.filter((h) => h.transactionId !== transactionId)
  saveState(state)
  return state
}

/** Appends a tracked position with a fresh read-modify-write. */
export function appendPosition(position: TrackedPosition): ShieldSwapState {
  const state = loadState()
  state.positions.push(position)
  saveState(state)
  return state
}

function jsonSafe(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}

/** Serializes a swap handle (single- or multi-hop) for the state file (bigints become strings). */
export function serializeHandle(handle: SwapHandle | MultiHopSwapHandle): Record<string, unknown> {
  return JSON.parse(JSON.stringify(handle, jsonSafe)) as Record<string, unknown>
}

/** True when a stored handle came from `swapMultiHop` — claim it with `claimMultiHopOutput`. */
export function isMultiHopHandle(stored: Record<string, unknown>): boolean {
  return Array.isArray(stored.poolKeys)
}

/**
 * Revives a stored handle's bigint fields so the claim actions accept it.
 * Handles both shapes: single-hop (`SwapHandle`) and multi-hop
 * (`MultiHopSwapHandle`, including each hop's `sqrtPriceLimit`).
 */
export function deserializeHandle(stored: Record<string, unknown>): SwapHandle | MultiHopSwapHandle {
  const h = { ...stored } as Record<string, unknown>
  for (const key of ['amountIn', 'sqrtPriceLimit', 'nonce', 'amountOutMin']) {
    if (typeof h[key] === 'string') h[key] = BigInt(h[key] as string)
  }
  if (Array.isArray(h.hops)) {
    h.hops = (h.hops as Array<Record<string, unknown>>).map((hop) => ({
      ...hop,
      sqrtPriceLimit: typeof hop.sqrtPriceLimit === 'string' ? BigInt(hop.sqrtPriceLimit) : hop.sqrtPriceLimit,
    }))
  }
  return h as unknown as SwapHandle | MultiHopSwapHandle
}

/**
 * Floors an amount to the token's no-dust rule. The contract rejects
 * amounts whose low `decimals - 9` digits are non-zero (tokens with more
 * than 9 decimals) — every swap or deposit amount MUST pass through this.
 */
export function floorToDust(amount: bigint, decimals: number): bigint {
  const scale = dustScale(decimals)
  return amount - (amount % scale)
}

/**
 * Builds the fully wired, authenticated session from the state file.
 *
 * Requires setup.ts to have run (key material + Provable API credentials in
 * the state file). Authenticates with the DEX API on every call — the
 * session JWT covers everything including access/token management, and
 * auto-renews on expiry.
 */
export async function loadSession() {
  const state = loadState()
  if (!state.privateKey || !state.provableApi) {
    throw new Error('No shield-swap session found — run setup.ts first (see startup.md).')
  }

  const aleo = await loadNetwork(NETWORK)
  const scanner = aleo.createRemoteScanner({
    url: SCANNER_URL,
    consumerId: state.provableApi.consumerId,
    apiKey: state.provableApi.apiKey,
  })
  const { walletClient, account } = aleo.createAleoClient({
    privateKey: state.privateKey,
    networkUrl: NETWORK_URL,
    provingMode: 'delegated',
    proverUrl: PROVER_URL,
    apiKey: state.provableApi.apiKey,
    consumerId: state.provableApi.consumerId,
    records: scanner,
  })
  const client = walletClient.extend(shieldSwapActions({ api: {} }))
  await authenticateWithAccount(client.api, account)

  return { client, account, scanner, state, aleo }
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
    wrapperProgram?: string
    publicAmount: bigint
    privateAmount: bigint
  }>
> {
  const tokens = (await client.api.getTokens()).data
  const pub = new Map(
    (await client.api.getPublicBalances({ user: address })).data.map((b) => [b.token_id, BigInt(b.balance ?? 0)]),
  )
  const programs = tokens.map((t) => t.wrapper_program).filter((p): p is string => !!p)
  const priv = await getPrivateBalances(client, { programs })
  return tokens.map((t) => ({
    tokenId: t.address,
    symbol: t.symbol,
    decimals: t.decimals,
    wrapperProgram: t.wrapper_program ?? undefined,
    publicAmount: pub.get(t.address) ?? 0n,
    privateAmount: t.wrapper_program ? (priv[t.wrapper_program] ?? 0n) : 0n,
  }))
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
  await loadNetwork(NETWORK) // initializes the WASM the account helpers use
  if (state.privateKey && options.importKey && options.importKey !== state.privateKey) {
    throw new Error(
      `a DIFFERENT account is already configured here (${state.address ?? 'address unknown'}). ` +
        'Refusing to switch silently — its funds and access live on that key. To use the imported ' +
        `key instead, move or delete the state directory first, then re-run with --private-key.`,
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
  const aleo = await loadNetwork(NETWORK)
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
 * Registers a Provable API consumer for delegated proving + record scanning
 * (no-op when credentials exist). Imported credentials win over
 * registration, so returning users keep their consumer. The API key is
 * shown once at registration — it is stored in the state file immediately.
 */
export async function ensureProvableApiCredentials(
  state: ShieldSwapState,
  imported?: { consumerId: string; apiKey: string },
): Promise<ShieldSwapState> {
  if (state.provableApi) return state
  if (imported) {
    state.provableApi = imported
    saveState(state)
    return state
  }
  const username = `ss-agent-${state.address!.slice(5, 17)}`
  const res = await fetch(CONSUMERS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username }),
  })
  if (!res.ok) throw new Error(`Provable API consumer registration failed (${res.status}): ${await res.text()}`)
  const body = (await res.json()) as { consumer: { id: string }; key: string }
  state.provableApi = { consumerId: body.consumer.id, apiKey: body.key }
  saveState(state)
  return state
}
