/**
 * Runs one leg of Base/Arbitrum → Arc → Aleo → Arc → Base/Arbitrum.
 * Uses public USDCx on Aleo and dedicated, idle accounts for delivery observation.
 * Preview is the default; each of the four legs requires an explicit invocation.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createPublicClient as createAleoPublicClient, http as aleoHttp } from '@provablehq/veil-core'
import { createPublicClient, formatUnits, getAddress, http, parseAbi, parseUnits, type Address, type Hex } from 'viem'
import { createAleoClient, createBridgeClient, createEvmClient, evmHttp, evmPrivateKey, type BridgeCheckpoint } from '@provablehq/aleo-bridge-sdk'
import { aleoExampleOptions } from './options.js'
import { followRoundtripLeg } from './roundtrip-lifecycle.js'

const ACK = 'I_UNDERSTAND_THIS_MOVES_REAL_FUNDS'
const ARC_GAS_RESERVE = 100_000n // Keep 0.10 USDC on Arc; gas is paid in USDC.
const MAX_FEE = 100_000n // Per-leg fee budget; the Aleo burn has no on-chain cap.
const BALANCE = parseAbi(['function balanceOf(address owner) view returns (uint256)'])
const CHAINS = {
  base: { id: 8453, rpc: 'https://mainnet.base.org' },
  arbitrum: { id: 42161, rpc: 'https://arb1.arbitrum.io/rpc' },
  arc: { id: 5042, rpc: 'https://rpc.mainnet.arc.io' },
} as const

type LegState = { amount: string, before: string, minimum: string, attempted?: boolean, checkpoint?: BridgeCheckpoint, received?: string }
type State = { version: 1, origin: string, evm: string, aleo: string, amount: string, legs: Record<string, LegState> }

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

/**
 * Previews or executes one checkpointed leg of an L2/Arc/Aleo roundtrip.
 * Reads START_CHAIN (base/arbitrum), LEG (1–4), EVM_ADDRESS and ALEO_RECIPIENT.
 * Execution additionally requires signing keys and the EXECUTE_BRIDGE acknowledgement.
 * @returns Resolves after preview or destination observation for the selected leg.
 * @throws When configuration, funds, fee budgets, checkpoints, or delivery checks fail.
 * @example await runL2ArcAleoRoundtrip()
 */
export async function runL2ArcAleoRoundtrip(): Promise<void> {
  const origin = process.env.START_CHAIN?.trim() || 'base'
  if (origin !== 'base' && origin !== 'arbitrum') throw new Error('START_CHAIN must be base or arbitrum')
  const leg = process.env.LEG?.trim() || '1'
  if (!['1', '2', '3', '4'].includes(leg)) throw new Error('LEG must be 1, 2, 3, or 4')
  const execute = process.env.EXECUTE_BRIDGE === ACK
  const evm = getAddress(required('EVM_ADDRESS'))
  const aleoAddress = required('ALEO_RECIPIENT')
  const rawAmount = process.env.AMOUNT?.trim() || '5'
  if (!/^\d+(?:\.\d{1,6})?$/.test(rawAmount)) throw new Error('AMOUNT must be a positive USDC amount with at most six decimals')
  const initialAmount = formatUnits(parseUnits(rawAmount, 6), 6)
  if (parseUnits(initialAmount, 6) < 3_000_000n) throw new Error('Start with at least 3 USDC to cover fees, Arc gas, and the 2-USDCx burn minimum')
  const path = resolve(process.env.ROUNDTRIP_STATE_FILE?.trim() || `${homedir()}/.local/state/veil/examples/${origin}-arc-aleo.json`)
  const expected = { version: 1 as const, origin, evm, aleo: aleoAddress, amount: initialAmount }
  const state: State = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { ...expected, legs: {} }
  for (const [key, value] of Object.entries(expected)) {
    if (state[key as keyof State] !== value) throw new Error(`Saved journey ${key} differs; reuse the original configuration`)
  }
  const paths = [[origin, 'arc'], ['arc', 'aleo'], ['aleo', 'arc'], ['arc', origin]] as const
  const [source, destination] = paths[Number(leg) - 1]!
  console.table(paths.map(([from, to], index) => ({ leg: index + 1, from, to })))
  let amount = initialAmount
  if (leg !== '1') {
    const received = state.legs[String(Number(leg) - 1)]?.received
    if (!received) throw new Error(`Finish leg ${Number(leg) - 1} with this state file first`)
    const available = BigInt(received) - (leg === '2' ? ARC_GAS_RESERVE : 0n)
    if (available <= 0n || (leg === '2' || leg === '3') && available < 2_000_000n) throw new Error('Received funds cannot cover the next leg and its minimum')
    amount = formatUnits(available, 6)
  }
  const saved = state.legs[leg]
  if (saved?.amount !== undefined && saved.amount !== amount) throw new Error('Saved leg amount differs')
  if (saved?.received) { console.log(`Leg ${leg} already delivered ${formatUnits(BigInt(saved.received), 6)}; no transfer repeated.`); return }

  // The lock prevents two processes from submitting the same fresh leg.
  // After a crash, remove a stale lock only after checking no process is active.
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const lock = openSync(`${path}.lock`, 'wx', 0o600)
  const save = () => {
    writeFileSync(`${path}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 })
    renameSync(`${path}.tmp`, path)
  }
  try {
    // Reject state loaded before another process finished and released its lock.
    if (existsSync(path) && JSON.stringify(JSON.parse(readFileSync(path, 'utf8'))) !== JSON.stringify(state)) {
      throw new Error('Journey state changed before locking; rerun to recover the latest checkpoint')
    }
    const rpc = (chain: keyof typeof CHAINS) => process.env[`${chain.toUpperCase()}_RPC_URL`]?.trim() || CHAINS[chain].rpc
    const readers = { [origin]: createPublicClient({ transport: http(rpc(origin)) }), arc: createPublicClient({ transport: http(rpc('arc')) }) }
    for (const chain of [origin, 'arc'] as const) {
      if (await readers[chain]!.getChainId() !== CHAINS[chain].id) throw new Error(`Wrong ${chain} network`)
    }
    const aleoRpc = process.env.ALEO_RPC_URL?.trim() || 'https://edge.provable.com/api/v2'
    const aleoPublic = createAleoPublicClient({ transport: aleoHttp(aleoRpc, { network: 'mainnet' }) })
    const clients = {
      [origin]: createEvmClient({ transport: evmHttp(rpc(origin)) }),
      arc: createEvmClient({ transport: evmHttp(rpc('arc')) }),
      aleo: createAleoClient({ publicClient: aleoPublic }),
    }
    if (execute && source !== 'aleo') {
      const key = required('EVM_PRIVATE_KEY').replace(/^0x/i, '')
      if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('Invalid EVM_PRIVATE_KEY')
      const account = evmPrivateKey(`0x${key}` as Hex)
      if (account.type !== 'local' || getAddress(account.account.address) !== evm) throw new Error('EVM key must match EVM_ADDRESS')
      Object.assign(clients[source]!, createEvmClient({ transport: evmHttp(rpc(source)), account }))
    }
    if (execute && source === 'aleo') {
      const { loadNetwork } = await import('@provablehq/veil-aleo-sdk')
      const network = await loadNetwork('mainnet')
      const signer = network.createAleoClient({ privateKey: required('ALEO_PRIVATE_KEY'), networkUrl: aleoRpc,
        ...aleoExampleOptions(), useFeeMaster: false, confirmationTimeout: 10 * 60_000 })
      if (String(signer.account.address) !== aleoAddress) throw new Error('Aleo key must match ALEO_RECIPIENT')
      clients.aleo = createAleoClient({ publicClient: signer.publicClient, account: signer.walletClient })
    }
    const budgetedFetch: typeof fetch = async (input, init) => {
      const response = await fetch(input, init)
      if (String(input) === 'https://api.usdcx.aleo.org/api/estimate-burn-fee' && response.ok) {
        const body = await response.clone().json() as { withdrawalFeeBaseUnits?: string }
        if (!body.withdrawalFeeBaseUnits || !/^\d+$/.test(body.withdrawalFeeBaseUnits) || BigInt(body.withdrawalFeeBaseUnits) > MAX_FEE) throw new Error('Withdrawal estimate exceeds 0.10 USDC')
      }
      return response
    }
    const bridge = createBridgeClient({ environment: 'mainnet', clients, fetch: budgetedFetch })
    const balance = async (): Promise<bigint> => {
      if (destination === 'aleo') {
        const raw = await aleoPublic.readMapping({ programId: 'usdcx_stablecoin.aleo', mapping: 'balances', key: aleoAddress })
        if (raw === null) return 0n
        if (!/^\d+u128$/.test(raw)) throw new Error('Unexpected public USDCx balance')
        return BigInt(raw.slice(0, -4))
      }
      const token = bridge.registry.assets.find(asset => asset.id === `${destination}/usdc`)!.locator!.value as Address
      return readers[destination]!.readContract({ address: token, abi: BALANCE, functionName: 'balanceOf', args: [evm] })
    }
    if (saved?.attempted && !saved.checkpoint) throw new Error('Submission may have occurred without a checkpoint. Inspect chain history; do not retry blindly.')
    let plan
    if (!saved?.checkpoint) {
      const cctp = source !== 'aleo' && destination !== 'aleo'
      const quote = await bridge.quote({ source: { chain: source, asset: source === 'aleo' ? 'usdcx' : 'usdc' },
        destination: { chain: destination, asset: destination === 'aleo' ? 'usdcx' : 'usdc' }, amount,
        sender: source === 'aleo' ? aleoAddress : evm, recipient: destination === 'aleo' ? aleoAddress : evm,
        ...(destination === 'aleo' ? { mintMode: 'public' as const } : {}),
        ...(cctp ? { cctp: { speed: source === 'arc' ? 'standard' as const : 'fast' as const, forwarding: true, maxFee: '0.1' } } : {}),
      })
      plan = quote.plan
      if (quote.kind === 'evm-cctp') {
        // Forwarding can spend all maxFee, so keep headroom small.
        const required = quote.protocolFeeAtomic + quote.forwardingFeeAtomic
        const ceiling = (required * 105n + 99n) / 100n + 1000n
        const fee = ceiling < MAX_FEE ? ceiling : MAX_FEE
        plan = { ...plan, amountOut: formatUnits(quote.amountAtomic - fee, 6), cctp: { ...plan.cctp, maxFee: formatUnits(fee, 6) } }
      }
      console.table({ leg, route: plan.route.id, amount, estimatedReceive: plan.amountOut, stateFile: path })
      if (!execute) { console.log(`Preview only. Set EXECUTE_BRIDGE=${ACK} to authorize this leg.`); return }
      state.legs[leg] = { amount, before: String(await balance()), minimum: String(parseUnits(amount, 6) - MAX_FEE), attempted: true }
      save() // Persist intent before the irreversible submission boundary.
    } else if (!execute) {
      console.log(await bridge.recover({ checkpoint: saved.checkpoint }))
      return
    }
    const current = state.legs[leg]!
    const persist = (checkpoint: BridgeCheckpoint) => { current.checkpoint = checkpoint; save() }
    const progress = await followRoundtripLeg(bridge, { plan, checkpoint: current.checkpoint, persist })
    console.log('Source:', progress.receipt.sourceTxId, 'Destination:', progress.receipt.destinationTxId)
    // CCTP completion is verified by the SDK. Public xReserve exposes only
    // provider handoff: use a dedicated idle account and observe its balance.
    // This observation is not a cryptographic link to the source transaction.
    const deadline = Date.now() + 20 * 60_000
    for (;;) {
      const received = await balance() - BigInt(current.before)
      if (received > parseUnits(current.amount, 6)) throw new Error('Unrelated destination activity detected; inspect delivery manually')
      if (received >= BigInt(current.minimum) && received > 0n) {
        current.received = String(received); save()
        console.log(`Leg ${leg}: observed ${formatUnits(received, 6)} at ${destination}. ${leg === '4' ? 'Roundtrip finished.' : `Run LEG=${Number(leg) + 1} next.`}`)
        return
      }
      if (Date.now() >= deadline) throw new Error('Delivery observation timeout. Keep the checkpoint and rerun this leg; do not create another transfer.')
      await new Promise(resolve => setTimeout(resolve, 5_000))
    }
  } finally { closeSync(lock); unlinkSync(`${path}.lock`) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runL2ArcAleoRoundtrip().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
}
