#!/usr/bin/env node
// Bridge activity monitor for the Hyperlane and Circle xReserve routes used by
// Shield Swap. Scans both sides of each bridge over a time window and prints a
// summary with anomaly flags.
//
//   Ethereum side (JSON-RPC eth_getLogs):
//     - xReserve DepositedToRemote on 0x8888…e3Ce, filtered to the Aleo USDCx route
//     - Hyperlane Mailbox Dispatch (→ Aleo domain) and Process (← Aleo domain)
//     - Warp router SentTransferRemote / ReceivedTransferRemote (ETH, WBTC, USDT)
//   Aleo side (Provable explorer API):
//     - usdcx_bridge_v2.aleo, shielded_usdcx_wrapper.aleo (xReserve)
//     - hyp_mailbox.aleo, hyp_warp_token_{eth,wbtc,usdt,sol}_v2.aleo (Hyperlane)
//
// Addresses and program ids are pinned from DEFAULT_BRIDGE_REGISTRY
// (src/registry/default.ts, version 2026-08-17.aleo-sol-router.1).
//
// Usage:
//   node scripts/monitor-bridges.mjs [--hours 24] [--rpc <url>] [--json]
//   ETH_RPC_URL=<url> node scripts/monitor-bridges.mjs --hours 6

import { createPublicClient, http, parseAbiItem, formatUnits, getAddress } from 'viem'

// ---------------------------------------------------------------------------
// Configuration (pinned from the reviewed bridge registry)
// ---------------------------------------------------------------------------

const ALEO_HYPERLANE_DOMAIN = 1634493807
const ALEO_XRESERVE_DOMAIN = 10002

const XRESERVE = {
  contract: '0x8888888199b2Df864bf678259607d6D5EBb4e3Ce',
  usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  remoteTokenBytes32: '0x11ea7dab1d29d5f61500582c63e98c42e1165f9ba050ea9d0c6af9f871987711', // usdcx_stablecoin.aleo
  minimumAmountAtomic: 2_000_000n, // 2 USDC route minimum
  decimals: 6,
}

const HYPERLANE_MAILBOX = '0xc005dc82818d67AF737725bD4bf75435d065D239'

const WARP_ROUTERS = [
  { symbol: 'ETH', address: '0x38D447694f5c1f773ae3132cf93bF30B7Ec1Fa5A', decimals: 18, kind: 'native' },
  { symbol: 'WBTC', address: '0x20CDC85778b732073F7EecEF3DF25c0d310f8772', decimals: 8, kind: 'collateral' },
  { symbol: 'USDT', address: '0x3C2064D78e4578E8F936E3db42aEF044E33FBF31', decimals: 6, kind: 'collateral' },
]

const ALEO_PROGRAMS = [
  { id: 'usdcx_bridge_v2.aleo', bridge: 'xreserve' },
  { id: 'shielded_usdcx_wrapper.aleo', bridge: 'xreserve' },
  { id: 'hyp_mailbox.aleo', bridge: 'hyperlane' },
  { id: 'hyp_warp_token_eth_v2.aleo', bridge: 'hyperlane' },
  { id: 'hyp_warp_token_wbtc_v2.aleo', bridge: 'hyperlane' },
  { id: 'hyp_warp_token_usdt_v2.aleo', bridge: 'hyperlane' },
  { id: 'hyp_warp_token_sol_v2.aleo', bridge: 'hyperlane' },
]

const ALEO_EXPLORER = 'https://api.explorer.provable.com/v2/mainnet'

// Per-token "large transfer" flag thresholds, in whole tokens.
const LARGE_THRESHOLDS = { USDC: 100_000, USDT: 100_000, ETH: 50, WBTC: 2, SOL: 2_000 }
// Flag any single address responsible for at least this many events in the window.
const HIGH_FREQUENCY_COUNT = 5

const EVENTS = {
  depositedToRemote: parseAbiItem(
    'event DepositedToRemote(address indexed localToken, uint256 value, address indexed localDepositor, bytes32 indexed remoteRecipient, uint32 remoteDomain, bytes32 remoteToken, uint256 maxFee, bytes hookData)',
  ),
  dispatch: parseAbiItem(
    'event Dispatch(address indexed sender, uint32 indexed destination, bytes32 indexed recipient, bytes message)',
  ),
  process: parseAbiItem(
    'event Process(uint32 indexed origin, bytes32 indexed sender, address indexed recipient)',
  ),
  sentTransferRemote: parseAbiItem(
    'event SentTransferRemote(uint32 indexed destination, bytes32 indexed recipient, uint256 amount)',
  ),
  receivedTransferRemote: parseAbiItem(
    'event ReceivedTransferRemote(uint32 indexed origin, bytes32 indexed recipient, uint256 amount)',
  ),
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { hours: 24, rpc: process.env.ETH_RPC_URL ?? 'https://eth.drpc.org', json: false }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--hours') args.hours = Number(argv[++i])
    else if (a === '--rpc') args.rpc = argv[++i]
    else if (a === '--json') args.json = true
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/monitor-bridges.mjs [--hours N] [--rpc URL] [--json]')
      process.exit(0)
    } else throw new Error(`Unknown argument: ${a}`)
  }
  if (!Number.isFinite(args.hours) || args.hours <= 0) throw new Error('--hours must be a positive number')
  return args
}

// ---------------------------------------------------------------------------
// Terminal styling
// ---------------------------------------------------------------------------

const useColor = (process.stdout.isTTY || !!process.env.FORCE_COLOR) && !process.env.NO_COLOR
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s))
const C = {
  bold: paint('1'),
  dim: paint('2'),
  red: paint('31'),
  green: paint('32'),
  yellow: paint('33'),
  magenta: paint('35'),
  cyan: paint('36'),
  gray: paint('90'),
  boldCyan: paint('1;36'),
  boldRed: paint('1;31'),
}
const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '')

// Renders rows with padded columns, a dim underlined header, and per-column
// alignment ('l' or 'r'). Widths are measured on ANSI-stripped text so colored
// cells align correctly.
function renderTable(headers, rows, aligns = []) {
  const all = [headers, ...rows]
  const widths = headers.map((_, col) => Math.max(...all.map((r) => stripAnsi(r[col] ?? '').length)))
  const pad = (cell, col) => {
    const raw = cell ?? ''
    const gap = widths[col] - stripAnsi(raw).length
    return aligns[col] === 'r' ? ' '.repeat(gap) + raw : raw + ' '.repeat(gap)
  }
  const lines = []
  lines.push('  ' + headers.map((cell, col) => C.dim(C.bold(pad(cell, col)))).join('  '))
  lines.push('  ' + widths.map((w) => C.dim('─'.repeat(w))).join('  '))
  for (const row of rows) lines.push('  ' + row.map(pad).join('  '))
  return lines
}

function section(title) {
  return ['', C.boldCyan(`◆ ${title}`), C.dim('═'.repeat(stripAnsi(title).length + 2))]
}

function fmt(amount, decimals) {
  const s = formatUnits(amount, decimals)
  const [i, f] = s.split('.')
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return f ? `${int}.${f.slice(0, 6)}` : int
}

const fmtTime = (seconds) => new Date(seconds * 1000).toISOString().slice(5, 16).replace('T', ' ')
const shortHex = (hex, head = 8, tail = 6) => (hex.length <= head + tail + 3 ? hex : `${hex.slice(0, 2 + head)}…${hex.slice(-tail)}`)

// ---------------------------------------------------------------------------
// Ethereum scanning
// ---------------------------------------------------------------------------

// Public RPCs intermittently rate-limit; retry transient failures with backoff.
const isTransient = (err) => /timeout|rate|429|busy|try again|free plan/i.test(String(err?.details ?? err?.message ?? err))

async function withRetry(fn, attempts = 5) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (!isTransient(err) || i === attempts - 1) throw err
      await new Promise((resolve) => setTimeout(resolve, 750 * (i + 1)))
    }
  }
  throw lastErr
}

async function findStartBlock(client, latestBlock, cutoffSeconds) {
  // Estimate from ~12s block time, then correct once against the actual timestamp.
  let guess = latestBlock.number - BigInt(Math.ceil((Number(latestBlock.timestamp) - cutoffSeconds) / 12))
  if (guess < 0n) guess = 0n
  const b = await withRetry(() => client.getBlock({ blockNumber: guess }))
  const drift = Number(b.timestamp) - cutoffSeconds
  let corrected = guess - BigInt(Math.round(drift / 12))
  if (corrected < 0n) corrected = 0n
  if (corrected > latestBlock.number) corrected = latestBlock.number
  return corrected
}

async function getLogsChunked(client, { address, event, args, fromBlock, toBlock }, chunkSize = 5000n) {
  const out = []
  let from = fromBlock
  let size = chunkSize
  while (from <= toBlock) {
    const to = from + size - 1n > toBlock ? toBlock : from + size - 1n
    try {
      const logs = await withRetry(() => client.getLogs({ address, event, args, fromBlock: from, toBlock: to }))
      out.push(...logs)
      from = to + 1n
    } catch (err) {
      // Providers reject over-wide ranges; halve and retry.
      if (size > 250n) { size /= 2n; continue }
      throw err
    }
  }
  return out
}

async function scanEthereum(client, fromBlock, toBlock) {
  const routerAddresses = WARP_ROUTERS.map((r) => r.address)
  const [deposits, dispatches, processes, sent, received] = await Promise.all([
    getLogsChunked(client, { address: XRESERVE.contract, event: EVENTS.depositedToRemote, fromBlock, toBlock }),
    getLogsChunked(client, {
      address: HYPERLANE_MAILBOX,
      event: EVENTS.dispatch,
      args: { destination: ALEO_HYPERLANE_DOMAIN },
      fromBlock,
      toBlock,
    }),
    getLogsChunked(client, {
      address: HYPERLANE_MAILBOX,
      event: EVENTS.process,
      args: { origin: ALEO_HYPERLANE_DOMAIN },
      fromBlock,
      toBlock,
    }),
    getLogsChunked(client, { address: routerAddresses, event: EVENTS.sentTransferRemote, fromBlock, toBlock }),
    getLogsChunked(client, { address: routerAddresses, event: EVENTS.receivedTransferRemote, fromBlock, toBlock }),
  ])
  return { deposits, dispatches, processes, sent, received }
}

// ---------------------------------------------------------------------------
// Aleo scanning
// ---------------------------------------------------------------------------

async function fetchAleoCalls(programId, cutoffSeconds, maxPages = 40) {
  const calls = []
  let cursor = null
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ limit: '50', sort: 'desc' })
    if (cursor) {
      params.set('cursor_block_number', String(cursor.block_number))
      params.set('cursor_transition_id', cursor.transition_id)
      params.set('direction', 'next')
    }
    const res = await fetch(`${ALEO_EXPLORER}/programs/${programId}/latest-calls/paginated?${params}`)
    if (!res.ok) throw new Error(`Aleo explorer ${res.status} for ${programId}`)
    const body = await res.json()
    let reachedCutoff = false
    for (const call of body.calls ?? []) {
      if (Number(call.block_timestamp) < cutoffSeconds) { reachedCutoff = true; break }
      calls.push(call)
    }
    if (reachedCutoff || !body.next_cursor || (body.calls ?? []).length === 0) return { calls, truncated: false }
    cursor = body.next_cursor
  }
  return { calls, truncated: true }
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

// Accumulates {count, amount, first, last} per key; `at` may be a block number
// (bigint) or unix timestamp — whichever the caller uses consistently.
function tally(map, key, amount = 0n, at = null) {
  const entry = map.get(key) ?? { count: 0, amount: 0n, first: null, last: null }
  entry.count += 1
  entry.amount += amount
  if (at != null) {
    if (entry.first == null || at < entry.first) entry.first = at
    if (entry.last == null || at > entry.last) entry.last = at
  }
  map.set(key, entry)
  return entry
}

const byAmountDesc = (a, b) => (b[1].amount > a[1].amount ? 1 : b[1].amount < a[1].amount ? -1 : 0)

function summarizeXReserve(deposits) {
  const aleo = { count: 0, volume: 0n, privateMints: 0, publicMints: 0, max: 0n, bySender: new Map(), transfers: [] }
  let otherDomains = 0
  const flags = []
  for (const log of deposits) {
    const a = log.args
    if (a.remoteDomain !== ALEO_XRESERVE_DOMAIN || a.remoteToken.toLowerCase() !== XRESERVE.remoteTokenBytes32) {
      otherDomains += 1
      continue
    }
    aleo.count += 1
    aleo.volume += a.value
    if (a.value > aleo.max) aleo.max = a.value
    const isPrivate = a.hookData && a.hookData !== '0x'
    if (isPrivate) aleo.privateMints += 1
    else aleo.publicMints += 1
    const entry = tally(aleo.bySender, getAddress(a.localDepositor), a.value, log.blockNumber)
    if (isPrivate) entry.privateCount = (entry.privateCount ?? 0) + 1
    aleo.transfers.push({ tx: log.transactionHash, block: log.blockNumber, sender: getAddress(a.localDepositor), amount: a.value, private: isPrivate })
    if (a.value < XRESERVE.minimumAmountAtomic) {
      flags.push(`xReserve deposit below the 2 USDC route minimum: ${fmt(a.value, 6)} USDC in ${log.transactionHash}`)
    }
    if (Number(formatUnits(a.value, 6)) >= LARGE_THRESHOLDS.USDC) {
      flags.push(`Large xReserve deposit: ${fmt(a.value, 6)} USDC from ${getAddress(a.localDepositor)} in ${log.transactionHash}`)
    }
  }
  for (const [sender, { count }] of aleo.bySender) {
    if (count >= HIGH_FREQUENCY_COUNT) flags.push(`High-frequency xReserve depositor: ${sender} made ${count} deposits`)
  }
  return { aleo, otherDomains, flags }
}

function summarizeHyperlane(sent, received, dispatches, processes) {
  const byRouter = new Map(WARP_ROUTERS.map((r) => [r.address.toLowerCase(), {
    ...r,
    out: { count: 0, volume: 0n, max: 0n, byRecipient: new Map(), transfers: [] },
    in: { count: 0, volume: 0n, max: 0n },
  }]))
  const flags = []
  for (const log of sent) {
    const r = byRouter.get(log.address.toLowerCase())
    if (!r) continue
    // Only Aleo-bound sends belong to this route set.
    if (log.args.destination !== ALEO_HYPERLANE_DOMAIN) continue
    r.out.count += 1
    r.out.volume += log.args.amount
    if (log.args.amount > r.out.max) r.out.max = log.args.amount
    tally(r.out.byRecipient, log.args.recipient, log.args.amount, log.blockNumber)
    r.out.transfers.push({ tx: log.transactionHash, block: log.blockNumber, recipient: log.args.recipient, amount: log.args.amount, symbol: r.symbol, decimals: r.decimals })
    if (Number(formatUnits(log.args.amount, r.decimals)) >= (LARGE_THRESHOLDS[r.symbol] ?? Infinity)) {
      flags.push(`Large Hyperlane send: ${fmt(log.args.amount, r.decimals)} ${r.symbol} → Aleo in ${log.transactionHash}`)
    }
  }
  for (const log of received) {
    const r = byRouter.get(log.address.toLowerCase())
    if (!r || log.args.origin !== ALEO_HYPERLANE_DOMAIN) continue
    r.in.count += 1
    r.in.volume += log.args.amount
    if (log.args.amount > r.in.max) r.in.max = log.args.amount
    if (Number(formatUnits(log.args.amount, r.decimals)) >= (LARGE_THRESHOLDS[r.symbol] ?? Infinity)) {
      flags.push(`Large Hyperlane receive: ${fmt(log.args.amount, r.decimals)} ${r.symbol} ← Aleo in ${log.transactionHash}`)
    }
  }
  for (const r of byRouter.values()) {
    for (const [recipient, { count }] of r.out.byRecipient) {
      if (count >= HIGH_FREQUENCY_COUNT) flags.push(`High-frequency Hyperlane recipient (${r.symbol}): ${recipient} received ${count} sends`)
    }
  }
  // Dispatches from addresses that are not the three known warp routers are
  // unexpected traffic to the Aleo domain and worth a look.
  const knownSenders = new Set(WARP_ROUTERS.map((r) => r.address.toLowerCase()))
  const unknownDispatches = dispatches.filter((d) => !knownSenders.has(d.args.sender.toLowerCase()))
  for (const d of unknownDispatches) {
    flags.push(`Mailbox Dispatch to Aleo from unknown sender ${getAddress(d.args.sender)} in ${d.transactionHash}`)
  }
  return { byRouter, dispatchCount: dispatches.length, processCount: processes.length, unknownDispatches, flags }
}

function summarizeAleo(programResults) {
  const perProgram = []
  const flags = []
  for (const { id, bridge, calls, truncated } of programResults) {
    const byFunction = new Map()
    let rejected = 0
    let first = null
    let last = null
    for (const c of calls) {
      const ts = Number(c.block_timestamp)
      tally(byFunction, c.function_id, 0n, ts)
      if (first == null || ts < first) first = ts
      if (last == null || ts > last) last = ts
      if (c.status !== 'Accepted') rejected += 1
    }
    if (rejected > 0) flags.push(`${id}: ${rejected} non-accepted transaction(s) in the window`)
    if (truncated) flags.push(`${id}: pagination cap reached — counts are a lower bound`)
    perProgram.push({ id, bridge, total: calls.length, rejected, byFunction, first, last, truncated })
  }
  return { perProgram, flags }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printReport({ args, window, xr, hl, aleo, allFlags }) {
  // Ethereum logs carry block numbers, not timestamps; interpolate from the
  // steady 12s post-merge block time (accurate to seconds over a day window).
  const blockTime = (block) => window.nowSeconds - Number(window.toBlock - block) * 12
  const lines = []

  lines.push(C.bold(`Shield Swap bridge activity — last ${args.hours}h`))
  lines.push(C.gray(`Window   ${new Date(window.cutoffSeconds * 1000).toISOString()} → ${new Date(window.nowSeconds * 1000).toISOString()} (times below are UTC)`))
  lines.push(C.gray(`Ethereum blocks ${window.fromBlock}–${window.toBlock}`))

  // ---- xReserve --------------------------------------------------------
  lines.push(...section('Circle xReserve (USDC ⇄ USDCx)'))
  lines.push(`  Ethereum → Aleo: ${C.bold(xr.aleo.count)} deposit(s), ${C.green(fmt(xr.aleo.volume, 6) + ' USDC')} total, largest ${fmt(xr.aleo.max, 6)}`
    + C.gray(` · ${xr.aleo.publicMints} public / ${xr.aleo.privateMints} private mints`)
    + (xr.otherDomains > 0 ? C.gray(` · ${xr.otherDomains} non-Aleo deposit(s) ignored`) : ''))
  const senders = [...xr.aleo.bySender.entries()].sort(byAmountDesc)
  if (senders.length > 0) {
    lines.push('')
    lines.push(...renderTable(
      ['DEPOSITOR', 'TXS', 'FIRST', 'LAST', 'VOLUME (USDC)', 'MODE'],
      senders.slice(0, 10).map(([sender, e]) => [
        sender,
        String(e.count),
        fmtTime(blockTime(e.first)),
        fmtTime(blockTime(e.last)),
        C.green(fmt(e.amount, 6)),
        (e.privateCount ?? 0) === e.count ? C.magenta('private') : (e.privateCount ?? 0) === 0 ? 'public' : C.magenta(`${e.privateCount} priv`) + ` / ${e.count - (e.privateCount ?? 0)} pub`,
      ]),
      ['l', 'r', 'l', 'l', 'r', 'l'],
    ))
    if (senders.length > 10) lines.push(C.gray(`  … ${senders.length - 10} more depositor(s), see --json`))
  }
  const recentDeposits = [...xr.aleo.transfers].reverse().slice(0, 12)
  if (recentDeposits.length > 0) {
    lines.push('')
    lines.push(...renderTable(
      ['TIME', 'AMOUNT (USDC)', 'FROM', 'MODE', 'TX'],
      recentDeposits.map((t) => [
        fmtTime(blockTime(t.block)),
        C.green(fmt(t.amount, 6)),
        shortHex(t.sender),
        t.private ? C.magenta('private') : 'public',
        C.gray(shortHex(t.tx)),
      ]),
      ['l', 'r', 'l', 'l', 'l'],
    ))
    if (xr.aleo.transfers.length > 12) lines.push(C.gray(`  … ${xr.aleo.transfers.length - 12} earlier deposit(s), see --json for all (with full hashes)`))
  }

  // ---- Hyperlane -------------------------------------------------------
  lines.push(...section('Hyperlane warp routes (ETH / WBTC / USDT)'))
  lines.push(...renderTable(
    ['TOKEN', 'ETH→ALEO TXS', 'VOLUME', 'LARGEST', 'ALEO→ETH TXS', 'VOLUME'],
    [...hl.byRouter.values()].map((r) => [
      C.bold(r.symbol),
      String(r.out.count),
      C.green(`${fmt(r.out.volume, r.decimals)} ${r.symbol}`),
      fmt(r.out.max, r.decimals),
      String(r.in.count),
      C.green(`${fmt(r.in.volume, r.decimals)} ${r.symbol}`),
    ]),
    ['l', 'r', 'r', 'r', 'r', 'r'],
  ))
  lines.push('')
  lines.push(`  Mailbox: ${C.bold(hl.dispatchCount)} dispatch(es) → Aleo, ${C.bold(hl.processCount)} process(es) ← Aleo`)
  const allSends = [...hl.byRouter.values()].flatMap((r) => r.out.transfers).sort((a, b) => Number(b.block - a.block)).slice(0, 12)
  if (allSends.length > 0) {
    lines.push('')
    lines.push(...renderTable(
      ['TIME', 'TOKEN', 'AMOUNT', 'RECIPIENT (ALEO, bytes32)', 'TX'],
      allSends.map((t) => [
        fmtTime(blockTime(t.block)),
        t.symbol,
        C.green(fmt(t.amount, t.decimals)),
        shortHex(t.recipient, 10, 8),
        C.gray(shortHex(t.tx)),
      ]),
      ['l', 'l', 'r', 'l', 'l'],
    ))
  }

  // ---- Aleo programs ---------------------------------------------------
  lines.push(...section('Aleo-side program activity'))
  lines.push(...renderTable(
    ['PROGRAM', 'CALLS', 'REJECTED', 'FIRST', 'LAST', 'FUNCTIONS'],
    aleo.perProgram.map((p) => [
      p.id,
      String(p.total),
      p.rejected > 0 ? C.red(String(p.rejected)) : C.gray('0'),
      p.first != null ? fmtTime(p.first) : C.gray('—'),
      p.last != null ? fmtTime(p.last) : C.gray('—'),
      [...p.byFunction.entries()].map(([f, { count }]) => `${f}×${count}`).join(', ') || C.gray('none'),
    ]),
    ['l', 'r', 'r', 'l', 'l', 'l'],
  ))

  // ---- Reconciliation --------------------------------------------------
  lines.push(...section('Reconciliation'))
  const aleoMailbox = aleo.perProgram.find((p) => p.id === 'hyp_mailbox.aleo')
  const aleoProcess = aleoMailbox ? [...aleoMailbox.byFunction.entries()].filter(([f]) => f.startsWith('process')).reduce((n, [, v]) => n + v.count, 0) : 0
  lines.push(`  Hyperlane ETH→Aleo dispatches vs Aleo mailbox process calls: ${C.bold(hl.dispatchCount)} vs ${C.bold(aleoProcess)} ${C.gray('(Aleo count includes all origin chains, e.g. Solana)')}`)
  const burns = aleo.perProgram.find((p) => p.id === 'usdcx_bridge_v2.aleo')
  const wrapper = aleo.perProgram.find((p) => p.id === 'shielded_usdcx_wrapper.aleo')
  const burnCount = [burns, wrapper].filter(Boolean).flatMap((p) => [...p.byFunction.entries()]).filter(([f]) => f.includes('burn')).reduce((n, [, v]) => n + v.count, 0)
  lines.push(`  xReserve Aleo burn calls (Circle attestation → Ethereum payout is off-chain): ${C.bold(burnCount)}`)
  lines.push(C.gray('  Cross-chain settlement lags the window edges; small deltas are normal, large ones are not.'))

  // ---- Flags -----------------------------------------------------------
  lines.push(...section(`Anomaly flags (${allFlags.length})`))
  if (allFlags.length === 0) {
    lines.push(C.green('  None.') + C.gray(' Thresholds: ' + Object.entries(LARGE_THRESHOLDS).map(([k, v]) => `${k}≥${v}`).join(', ') + `; high-frequency ≥${HIGH_FREQUENCY_COUNT} events/address.`))
  }
  for (const f of allFlags) lines.push(`  ${C.boldRed('⚠')} ${C.yellow(f)}`)
  lines.push('')

  console.log(lines.join('\n'))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv)
  const nowSeconds = Math.floor(Date.now() / 1000)
  const cutoffSeconds = nowSeconds - Math.round(args.hours * 3600)

  const client = createPublicClient({ transport: http(args.rpc, { retryCount: 5, retryDelay: 500, timeout: 30_000 }) })
  const latest = await withRetry(() => client.getBlock())
  const fromBlock = await findStartBlock(client, latest, cutoffSeconds)

  const [eth, ...aleoResults] = await Promise.all([
    scanEthereum(client, fromBlock, latest.number),
    ...ALEO_PROGRAMS.map(async (p) => ({ ...p, ...(await fetchAleoCalls(p.id, cutoffSeconds)) })),
  ])

  const xr = summarizeXReserve(eth.deposits)
  const hl = summarizeHyperlane(eth.sent, eth.received, eth.dispatches, eth.processes)
  const aleo = summarizeAleo(aleoResults)
  const allFlags = [...xr.flags, ...hl.flags, ...aleo.flags]

  const window = { nowSeconds, cutoffSeconds, fromBlock, toBlock: latest.number }

  if (args.json) {
    const json = JSON.stringify({ window, xreserve: xr, hyperlane: { ...hl, byRouter: [...hl.byRouter.values()] }, aleo, flags: allFlags },
      (_, v) => typeof v === 'bigint' ? v.toString() : v instanceof Map ? Object.fromEntries(v) : v, 2)
    console.log(json)
    return
  }
  printReport({ args, window, xr, hl, aleo, allFlags })
}

main().catch((err) => {
  console.error(`monitor-bridges failed: ${err.message ?? err}`)
  process.exit(1)
})
