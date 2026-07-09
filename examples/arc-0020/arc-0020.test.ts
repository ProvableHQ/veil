/**
 * ARC-0020 integration tests — Veil implementation.
 *
 * Run: VEIL_DEVNODE_INTEGRATION=1 pnpm vitest run examples/arc-0020/arc-0020.test.ts
 *
 * One devnode, one shared ledger.  All four programs are deployed once in
 * beforeAll, then both test suites run against the same chain state.
 *
 * Static source checks run without a devnode.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createTestClient, http, type TestClient } from '@provablehq/veil-core'
import { startDevnode, type DevnodeInstance } from '@provablehq/veil-aleo-devnode'
import { createDevnodeClient } from '@provablehq/veil-aleo-sdk'
import { createLeoClient } from '@provablehq/veil-leo'

import { createTokenRegistryContract } from './generated/token_registry.js'
import { createWrappedCreditsContract } from './generated/wrapped_credits.js'
import { createWrappedTokenRegistryContract } from './generated/wrapped_token_registry.js'
import { createDummyExchangeContract } from './generated/dummy_exchange.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const RUN = process.env.VEIL_DEVNODE_INTEGRATION === '1'
const SOCKET_ADDR = '127.0.0.1:3030'

// Same private keys as the reference test suite (index 0 is the devnode seed account).
const PRIVATE_KEYS: [string, string, string, string] = [
  'APrivateKey1zkp8CZNn3yeCseEtxuVPbDCwSyhGW6yZKUYKfgXmcpoGPWH',
  'APrivateKey1zkp2RWGDcde3efb89rjhME1VYA8QMxcxep5DShNBR6n8Yjh',
  'APrivateKey1zkp2GUmKbVsuc1NSj28pa1WTQuZaK5f1DQJAT6vPcHyWokG',
  'APrivateKey1zkpBjpEgLo4arVUkQmcLdKQMiAKGaHAQVVwmF8HQby8vdYs',
]

// ── Utility helpers ───────────────────────────────────────────────────────────

/**
 * Encode a program name (without .aleo) into the Aleo field literal used by
 * dummy_exchange for dynamic dispatch: little-endian UTF-8 bytes packed into a
 * field element.
 */
function programNameToTokenId(name: string): string {
  let id = 0n
  let i = 0
  for (const byte of new TextEncoder().encode(name)) {
    id += BigInt(byte) * (256n ** BigInt(i++))
  }
  return `${id}field`
}

/** Encode an ASCII string into a Leo u128 literal (little-endian byte layout). */
function asciiToU128(s: string): bigint {
  let result = 0n
  let i = 0
  for (const byte of new TextEncoder().encode(s)) {
    if (i >= 16) throw new Error(`"${s}" is longer than 16 bytes`)
    result += BigInt(byte) * (256n ** BigInt(i++))
  }
  return result
}

/**
 * Parse a bigint from any Leo plaintext value.
 * Works for simple scalars ("1000u128") and struct strings
 * ("{ ..., balance: 500u128, ... }") — extracts the last u-typed number.
 */
function parseBigint(raw: unknown): bigint {
  const s = String(raw ?? '')
  if (!s || s === 'null') return 0n
  const matches = [...s.matchAll(/(\d+)u\d+/g)]
  if (matches.length === 0) return 0n
  return BigInt(matches[matches.length - 1]![1]!)
}

/** Extract a named field value from a Leo struct plaintext string. */
function parseStructField(raw: unknown, field: string): bigint {
  const s = String(raw ?? '')
  const m = s.match(new RegExp(`${field}:\\s*(\\d+)u\\d+`))
  return m ? BigInt(m[1]!) : 0n
}

// ── Shared state, populated in beforeAll ─────────────────────────────────────

let devnode: DevnodeInstance
let tc: TestClient
let exchangeAddress: string

type WCContract  = ReturnType<typeof createWrappedCreditsContract>
type WTRContract = ReturnType<typeof createWrappedTokenRegistryContract>
type TRContract  = ReturnType<typeof createTokenRegistryContract>
type DexContract = ReturnType<typeof createDummyExchangeContract>

// Four contract instances, one per account, for each program
let wc:  [WCContract,  WCContract,  WCContract,  WCContract]
let wtr: [WTRContract, WTRContract, WTRContract, WTRContract]
let tr:  [TRContract,  TRContract,  TRContract,  TRContract]
let dex: [DexContract, DexContract, DexContract, DexContract]

let addrs: [string, string, string, string]

// ── Shared advance helper ─────────────────────────────────────────────────────

async function advance(count = 1) {
  await tc.advanceBlock({ count })
}

// ── One shared devnode lifecycle ──────────────────────────────────────────────

if (RUN) {
  beforeAll(async () => {
    devnode = await startDevnode({ socketAddr: SOCKET_ADDR, readyTimeout: 60_000 })
    tc = createTestClient({ transport: http(`http://${SOCKET_ADDR}`, { network: 'testnet' }) })

    // Build all four programs with the leo_view CLI
    for (const name of ['token_registry', 'wrapped_credits', 'wrapped_token_registry', 'dummy_exchange']) {
      const leo = createLeoClient({ cwd: join(__dirname, name), leoPath: 'leo_view', disableUpdateCheck: true })
      await leo.build()
    }

    // Create per-account devnode clients
    const clients = PRIVATE_KEYS.map((pk) =>
      createDevnodeClient({ privateKey: pk, socketAddr: SOCKET_ADDR })
    ) as [ReturnType<typeof createDevnodeClient>, ReturnType<typeof createDevnodeClient>, ReturnType<typeof createDevnodeClient>, ReturnType<typeof createDevnodeClient>]

    addrs = clients.map((c) => c.account.address) as [string, string, string, string]

    const { publicClient, walletClient: wc0 } = clients[0]

    // Deploy in dependency order: token_registry → wrapped_token_registry → wrapped_credits → dummy_exchange
    const sources: Record<string, string> = {}
    for (const name of ['token_registry', 'wrapped_credits', 'wrapped_token_registry', 'dummy_exchange']) {
      sources[name] = readFileSync(join(__dirname, `${name}/build/main.aleo`), 'utf-8')
    }

    await wc0.deployContract({ program: sources.token_registry! })
    await advance()
    await wc0.deployContract({ program: sources.wrapped_credits! })
    await advance()
    await wc0.deployContract({ program: sources.wrapped_token_registry! })
    await advance()
    await wc0.deployContract({ program: sources.dummy_exchange! })
    await advance()

    // Compute dummy_exchange program address (used as spender in approve calls)
    // @ts-expect-error — @provablehq/sdk is a transitive dep; Address.fromProgramId is available at runtime
    const { Address } = await import('@provablehq/sdk')
    exchangeAddress = Address.fromProgramId('dummy_exchange.aleo').to_string()

    // Instantiate typed contract handles for each of the four accounts
    const makeContracts = <T>(factory: (opts: { publicClient: typeof publicClient, walletClient: ReturnType<typeof createDevnodeClient>['walletClient'] }) => T): [T, T, T, T] =>
      clients.map((c) => factory({ publicClient, walletClient: c.walletClient })) as [T, T, T, T]

    wc  = makeContracts(createWrappedCreditsContract)
    wtr = makeContracts(createWrappedTokenRegistryContract)
    tr  = makeContracts(createTokenRegistryContract)
    dex = makeContracts(createDummyExchangeContract)

    // Fund accounts 1–3 with native credits so they can pay transaction fees
    for (const addr of [addrs[1], addrs[2], addrs[3]]) {
      await wc0.writeContract({ program: 'credits.aleo', function: 'transfer_public', inputs: [addr, '1000000u64'] })
      await advance()
    }

    // Seed account 0 with 5 000 wrapped credits
    await wc[0].write.deposit_credits_public_signer({ amount: 5000n })
    await advance()

    // Initialize token_registry and register tokens
    await tr[0].write.initialize({})
    await advance()

    await tr[0].write.register_token({
      token_id: '12345field',
      name: asciiToU128('TEST'),
      symbol: asciiToU128('TST'),
      decimals: 6,
      max_supply: 1_000_000n,
      external_authorization_required: false,
      external_authorization_party: addrs[0],
    })
    await advance()

    // Mint custom token to addr0 for transfer tests
    await tr[0].write.mint_public({ token_id: '12345field', recipient: addrs[0], amount: 10_000n, authorized_until: 4294967295 })
    await advance()
  }, 600_000)

  afterAll(async () => {
    await tc.shutdown()
    await devnode.stop()
  })
}

// ── Balance helpers ───────────────────────────────────────────────────────────

async function wcBal(addr: string): Promise<bigint> {
  try { return parseBigint(await wc[0].read.balances({ key: addr })) } catch { return 0n }
}
async function wtrBal(addr: string): Promise<bigint> {
  try { return parseBigint(await wtr[0].read.balances({ key: addr })) } catch { return 0n }
}
async function trBal(tokenId: string, addr: string): Promise<bigint> {
  try { return parseStructField(await tr[0].read.authorized_balances({ key: `{ account: ${addr}, token_id: ${tokenId} }` }), 'balance') } catch { return 0n }
}

// ── Setup helper for wrapped_token_registry tests ────────────────────────────

async function ensureWrappedTokenBalance(minAmount = 500n) {
  const bal = await wtrBal(addrs[0])
  if (bal < minAmount) {
    // Re-mint WRAPPED_TOKEN_ID into token_registry for addr0
    try {
      await tr[0].write.register_token({
        token_id: '99999field',
        name: asciiToU128('TEST'),
        symbol: asciiToU128('TST'),
        decimals: 6,
        max_supply: 10_000_000n,
        external_authorization_required: false,
        external_authorization_party: addrs[0],
      })
      await advance()
    } catch { /* already registered */ }
    await tr[0].write.mint_public({ token_id: '99999field', recipient: addrs[0], amount: 2000n, authorized_until: 4294967295 })
    await advance()
    await wtr[0].write.deposit_token_public_signer({ amount: 1000n })
    await advance()
  }
}

// ── Static source checks (no devnode) ────────────────────────────────────────

describe('ARC-0020: static source checks', () => {
  function extractInterface(content: string, name: string): string {
    const m = content.match(new RegExp(`interface\\s+${name}\\s*\\{`))
    if (!m || m.index === undefined) throw new Error(`interface ${name} not found`)
    const open = content.indexOf('{', m.index)
    let depth = 0
    for (let i = open; i < content.length; i++) {
      if (content[i] === '{') depth++
      else if (content[i] === '}') { depth--; if (depth === 0) return content.slice(m.index, i + 1).trim() }
    }
    throw new Error(`unclosed interface ${name}`)
  }

  const wcSrc  = readFileSync(join(__dirname, 'wrapped_credits/src/main.leo'), 'utf-8')
  const wtrSrc = readFileSync(join(__dirname, 'wrapped_token_registry/src/main.leo'), 'utf-8')

  it('wrapped_credits declares IARC20', () => {
    expect(wcSrc).toMatch(/interface\s+IARC20\s*\{/)
    expect(wcSrc).toMatch(/program wrapped_credits\.aleo:\s*IARC20/)
  })

  it('wrapped_token_registry declares IARC20', () => {
    expect(wtrSrc).toMatch(/interface\s+IARC20\s*\{/)
    expect(wtrSrc).toMatch(/program wrapped_token_registry\.aleo:\s*IARC20/)
  })

  it('both wrappers declare the exact same IARC20 interface', () => {
    expect(extractInterface(wcSrc, 'IARC20')).toBe(extractInterface(wtrSrc, 'IARC20'))
  })
})

// ── Suite 1: wrapped_credits.aleo ────────────────────────────────────────────

describe.runIf(RUN)('ARC-0020: wrapped_credits', () => {

  // ── Wrapper-specific: deposit / withdraw ──────────────────────────────────

  it('deposit_credits_public_signer (positive): only depositor balance increases', async () => {
    const before0 = await wcBal(addrs[0])
    const before1 = await wcBal(addrs[1])
    await wc[0].write.deposit_credits_public_signer({ amount: 1000n })
    await advance()
    expect(await wcBal(addrs[0]) - before0).toBe(1000n)
    expect(await wcBal(addrs[1])).toBe(before1)
  })

  it('withdraw_credits_public (positive): balance decreases', async () => {
    const before = await wcBal(addrs[0])
    await wc[0].write.withdraw_credits_public({ amount: 250n })
    await advance()
    expect(before - await wcBal(addrs[0])).toBe(250n)
  })

  it('withdraw_credits_public (negative): over-withdrawal rejects, balance unchanged', async () => {
    const before = await wcBal(addrs[0])
    await expect(wc[0].write.withdraw_credits_public({ amount: 999_999_999_999n })).rejects.toThrow()
    expect(await wcBal(addrs[0])).toBe(before)
  })

  it('withdraw_credits_public_signer (positive): balance decreases', async () => {
    const before = await wcBal(addrs[0])
    await wc[0].write.withdraw_credits_public_signer({ amount: 123n })
    await advance()
    expect(before - await wcBal(addrs[0])).toBe(123n)
  })

  it('withdraw_credits_public_signer (negative): over-withdrawal rejects', async () => {
    const before = await wcBal(addrs[0])
    await expect(wc[0].write.withdraw_credits_public_signer({ amount: 999_999_999_999n })).rejects.toThrow()
    expect(await wcBal(addrs[0])).toBe(before)
  })

  // ── IARC20: transfer_public ───────────────────────────────────────────────

  it('transfer_public (positive): balances shift correctly', async () => {
    const before0 = await wcBal(addrs[0])
    const before1 = await wcBal(addrs[1])
    await wc[0].write.transfer_public({ recipient: addrs[1], amount: 321n })
    await advance()
    expect(before0 - await wcBal(addrs[0])).toBe(321n)
    expect(await wcBal(addrs[1]) - before1).toBe(321n)
  })

  it('transfer_public (negative): insufficient balance rejects', async () => {
    const before1 = await wcBal(addrs[1])
    await expect(wc[1].write.transfer_public({ recipient: addrs[0], amount: before1 + 1n })).rejects.toThrow()
    expect(await wcBal(addrs[1])).toBe(before1)
  })

  it('transfer_public_as_signer (positive): debits signer, credits recipient', async () => {
    const before0 = await wcBal(addrs[0])
    const before1 = await wcBal(addrs[1])
    await wc[0].write.transfer_public_as_signer({ recipient: addrs[1], amount: 70n })
    await advance()
    expect(before0 - await wcBal(addrs[0])).toBe(70n)
    expect(await wcBal(addrs[1]) - before1).toBe(70n)
  })

  it('transfer_public_as_signer (negative): insufficient balance rejects', async () => {
    const balance1 = await wcBal(addrs[1])
    const before0 = await wcBal(addrs[0])
    await expect(wc[1].write.transfer_public_as_signer({ recipient: addrs[0], amount: balance1 + 1n })).rejects.toThrow()
    expect(await wcBal(addrs[0])).toBe(before0)
    expect(await wcBal(addrs[1])).toBe(balance1)
  })

  // ── IARC20: transfer_public_to_private ───────────────────────────────────

  it('transfer_public_to_private (positive): debits public balance', async () => {
    const before = await wcBal(addrs[0])
    await wc[0].write.transfer_public_to_private({ recipient: addrs[1], amount: 60n })
    await advance()
    expect(before - await wcBal(addrs[0])).toBe(60n)
  })

  it('transfer_public_to_private (negative): overflow rejects', async () => {
    const before = await wcBal(addrs[0])
    await expect(wc[0].write.transfer_public_to_private({ recipient: addrs[1], amount: 999_999_999_999_999_999_999_999n })).rejects.toThrow()
    expect(await wcBal(addrs[0])).toBe(before)
  })

  // ── IARC20: approvals + transfer_from ────────────────────────────────────

  it('approve_public + transfer_from_public: spender moves tokens on behalf of owner', async () => {
    await wc[0].write.approve_public({ spender: addrs[1], amount: 150n })
    await advance()
    const before0 = await wcBal(addrs[0])
    const before1 = await wcBal(addrs[1])
    await wc[1].write.transfer_from_public({ owner: addrs[0], recipient: addrs[1], amount: 100n })
    await advance()
    expect(before0 - await wcBal(addrs[0])).toBe(100n)
    expect(await wcBal(addrs[1]) - before1).toBe(100n)
    // Drain remaining allowance
    await wc[0].write.unapprove_public({ spender: addrs[1], amount: 50n })
    await advance()
  })

  it('transfer_from_public (negative): exceeds allowance rejects', async () => {
    await wc[0].write.approve_public({ spender: addrs[3], amount: 25n })
    await advance()
    const before0 = await wcBal(addrs[0])
    const before3 = await wcBal(addrs[3])
    await expect(wc[3].write.transfer_from_public({ owner: addrs[0], recipient: addrs[3], amount: 50n })).rejects.toThrow()
    expect(await wcBal(addrs[0])).toBe(before0)
    expect(await wcBal(addrs[3])).toBe(before3)
  })

  it('unapprove_public: remaining allowance is consumed; next transfer_from rejects', async () => {
    await wc[0].write.approve_public({ spender: addrs[2], amount: 200n })
    await advance()
    await wc[0].write.unapprove_public({ spender: addrs[2], amount: 100n })
    await advance()
    const before0 = await wcBal(addrs[0])
    const before2 = await wcBal(addrs[2])
    // 100 remaining allowance — should succeed
    await wc[2].write.transfer_from_public({ owner: addrs[0], recipient: addrs[2], amount: 100n })
    await advance()
    expect(before0 - await wcBal(addrs[0])).toBe(100n)
    expect(await wcBal(addrs[2]) - before2).toBe(100n)
    // Allowance now zero — should reject
    await expect(wc[2].write.transfer_from_public({ owner: addrs[0], recipient: addrs[2], amount: 1n })).rejects.toThrow()
  })

  it('transfer_from_public_to_private (positive): spender converts owner public to private Token', async () => {
    await wc[0].write.approve_public({ spender: addrs[1], amount: 80n })
    await advance()
    const before0 = await wcBal(addrs[0])
    await wc[1].write.transfer_from_public_to_private({ owner: addrs[0], recipient: addrs[2], amount: 40n })
    await advance()
    expect(before0 - await wcBal(addrs[0])).toBe(40n)
  })

  it('transfer_from_public_to_private (negative): exceeds allowance rejects', async () => {
    await wc[0].write.approve_public({ spender: addrs[3], amount: 10n })
    await advance()
    const before0 = await wcBal(addrs[0])
    await expect(wc[3].write.transfer_from_public_to_private({ owner: addrs[0], recipient: addrs[3], amount: 50n })).rejects.toThrow()
    expect(await wcBal(addrs[0])).toBe(before0)
  })

  // ── dummy_exchange: interface dispatch into wrapped_credits ───────────────

  const wcTokenId = programNameToTokenId('wrapped_credits')

  it('dummy_exchange.transfer_from: pulls via allowance through IARC20 dynamic dispatch', async () => {
    await wc[0].write.approve_public({ spender: exchangeAddress, amount: 75n })
    await advance()
    const before0 = await wcBal(addrs[0])
    const before1 = await wcBal(addrs[1])
    await dex[0].write.transfer_from({ token_id: wcTokenId, owner: addrs[0], recipient: addrs[1], amount: 75n })
    await advance()
    expect(before0 - await wcBal(addrs[0])).toBe(75n)
    expect(await wcBal(addrs[1]) - before1).toBe(75n)
  })

  it('dummy_exchange.swap: net balance change equals amountIn − amountOut', async () => {
    const amountIn = 75n
    const amountOut = 50n
    // Pre-fund exchange with amount_out so it can pay on the push leg
    await wc[0].write.transfer_public({ recipient: exchangeAddress, amount: amountOut })
    await advance()
    await wc[0].write.approve_public({ spender: exchangeAddress, amount: amountIn })
    await advance()
    const before0 = await wcBal(addrs[0])
    const beforeExchange = await wcBal(exchangeAddress)
    await dex[0].write.swap({ token_in: wcTokenId, token_out: wcTokenId, amount_in: amountIn, amount_out: amountOut })
    await advance()
    expect(before0 - await wcBal(addrs[0])).toBe(amountIn - amountOut)
    expect(await wcBal(exchangeAddress) - beforeExchange).toBe(amountIn - amountOut)
  })
})

// ── Suite 2: token_registry.aleo + wrapped_token_registry.aleo ───────────────

describe.runIf(RUN)('ARC-0020: token_registry + wrapped_token_registry', () => {
  const CUSTOM_TOKEN_ID = '12345field'
  const AUTHORIZED_UNTIL = 4294967295

  // ── token_registry ────────────────────────────────────────────────────────

  it('initialize (negative): second call rejects', async () => {
    await expect(tr[0].write.initialize({})).rejects.toThrow()
  })

  it('register_token (negative): duplicate token_id rejects', async () => {
    await expect(tr[0].write.register_token({
      token_id: CUSTOM_TOKEN_ID, name: 1n, symbol: 1n, decimals: 6,
      max_supply: 1n, external_authorization_required: false, external_authorization_party: addrs[0],
    })).rejects.toThrow()
  })

  it('mint_public (positive): admin mints and balance increases', async () => {
    const before = await trBal(CUSTOM_TOKEN_ID, addrs[0])
    await tr[0].write.mint_public({ token_id: CUSTOM_TOKEN_ID, recipient: addrs[0], amount: 500n, authorized_until: AUTHORIZED_UNTIL })
    await advance()
    expect(await trBal(CUSTOM_TOKEN_ID, addrs[0]) - before).toBe(500n)
  })

  it('mint_public (negative): non-admin cannot mint', async () => {
    await expect(tr[1].write.mint_public({ token_id: CUSTOM_TOKEN_ID, recipient: addrs[1], amount: 100n, authorized_until: AUTHORIZED_UNTIL })).rejects.toThrow()
  })

  it('transfer_public (positive): moves token balance between users', async () => {
    const before0 = await trBal(CUSTOM_TOKEN_ID, addrs[0])
    const before1 = await trBal(CUSTOM_TOKEN_ID, addrs[1])
    await tr[0].write.transfer_public({ token_id: CUSTOM_TOKEN_ID, recipient: addrs[1], amount: 200n })
    await advance()
    expect(before0 - await trBal(CUSTOM_TOKEN_ID, addrs[0])).toBe(200n)
    expect(await trBal(CUSTOM_TOKEN_ID, addrs[1]) - before1).toBe(200n)
  })

  it('transfer_public (negative): insufficient balance rejects', async () => {
    await expect(tr[1].write.transfer_public({ token_id: CUSTOM_TOKEN_ID, recipient: addrs[0], amount: 999_999_999_999n })).rejects.toThrow()
  })

  it('transfer_from_public (negative): exceeds allowance rejects', async () => {
    await expect(tr[0].write.transfer_from_public({ token_id: CUSTOM_TOKEN_ID, owner: addrs[1], recipient: addrs[0], amount: 999_999n })).rejects.toThrow()
  })

  // ── wrapped_token_registry ─────────────────────────────────────────────────

  it('deposit_token_public_signer: increases wrapped balance', async () => {
    await ensureWrappedTokenBalance()
    const before = await wtrBal(addrs[0])
    await wtr[0].write.deposit_token_public_signer({ amount: 300n })
    await advance()
    expect(await wtrBal(addrs[0]) - before).toBe(300n)
  })

  it('withdraw_token_public: decreases wrapped balance', async () => {
    await ensureWrappedTokenBalance(200n)
    const before = await wtrBal(addrs[0])
    await wtr[0].write.withdraw_token_public({ amount: 100n })
    await advance()
    expect(before - await wtrBal(addrs[0])).toBe(100n)
  })

  it('transfer_public (wTR, positive): moves wrapped balance between users', async () => {
    await ensureWrappedTokenBalance(200n)
    const before0 = await wtrBal(addrs[0])
    const before1 = await wtrBal(addrs[1])
    await wtr[0].write.transfer_public({ recipient: addrs[1], amount: 100n })
    await advance()
    expect(before0 - await wtrBal(addrs[0])).toBe(100n)
    expect(await wtrBal(addrs[1]) - before1).toBe(100n)
  })

  it('transfer_public (wTR, negative): insufficient balance rejects', async () => {
    const balance1 = await wtrBal(addrs[1])
    await expect(wtr[1].write.transfer_public({ recipient: addrs[0], amount: balance1 + 1n })).rejects.toThrow()
  })

  // ── dummy_exchange: interface dispatch into wrapped_token_registry ─────────

  const wtrTokenId = programNameToTokenId('wrapped_token_registry')

  it('dummy_exchange.transfer_from (wTR): pulls via IARC20 allowance', async () => {
    await ensureWrappedTokenBalance(200n)
    await wtr[0].write.approve_public({ spender: exchangeAddress, amount: 75n })
    await advance()
    const before0 = await wtrBal(addrs[0])
    const before1 = await wtrBal(addrs[1])
    await dex[0].write.transfer_from({ token_id: wtrTokenId, owner: addrs[0], recipient: addrs[1], amount: 75n })
    await advance()
    expect(before0 - await wtrBal(addrs[0])).toBe(75n)
    expect(await wtrBal(addrs[1]) - before1).toBe(75n)
  })

  it('dummy_exchange.swap (wTR): net balance change equals amountIn − amountOut', async () => {
    await ensureWrappedTokenBalance(300n)
    const amountIn = 75n
    const amountOut = 50n
    await wtr[0].write.transfer_public({ recipient: exchangeAddress, amount: amountOut })
    await advance()
    await wtr[0].write.approve_public({ spender: exchangeAddress, amount: amountIn })
    await advance()
    const before0 = await wtrBal(addrs[0])
    const beforeExchange = await wtrBal(exchangeAddress)
    await dex[0].write.swap({ token_in: wtrTokenId, token_out: wtrTokenId, amount_in: amountIn, amount_out: amountOut })
    await advance()
    expect(before0 - await wtrBal(addrs[0])).toBe(amountIn - amountOut)
    expect(await wtrBal(exchangeAddress) - beforeExchange).toBe(amountIn - amountOut)
  })
})
