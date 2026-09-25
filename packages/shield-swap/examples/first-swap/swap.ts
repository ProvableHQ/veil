/** Runs one USDCx-to-ETH testnet swap and saves its confirmed claim result. */
import assert from 'node:assert/strict'
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import {
  formatUnits,
  parseUnits,
  shieldSwapActions,
  SwapOutputNotFinalizedError,
  type MultiHopSwapHandle,
  type SwapHandle,
} from '@provablehq/shield-swap-sdk'
import { fileBlindedIdentityStore } from '@provablehq/shield-swap-sdk/node'
import { loadPrivateKey, reserveSwap } from './state.js'

const { values } = parseArgs({
  options: {
    'invite-code': { type: 'string' },
    claim: { type: 'boolean', default: false },
  },
})

const stateDirectory = join(dirname(fileURLToPath(import.meta.url)), '.state')
await mkdir(stateDirectory, { recursive: true, mode: 0o700 })
await writeFile(join(stateDirectory, '.gitignore'), '*\n', { mode: 0o600 })
const aleo = await loadNetwork('testnet')
const privateKey = await loadPrivateKey(
  join(stateDirectory, 'account.json'),
  process.env.SHIELD_SWAP_PRIVATE_KEY,
  () => aleo.generateAccount().privateKey,
)
const { walletClient, account } = aleo.createAleoClient({ privateKey })
const accountDirectory = join(stateDirectory, account.address)
await mkdir(accountDirectory, { recursive: true, mode: 0o700 })

// One process owns the account's records and recovery files at a time.
const lockPath = join(accountDirectory, 'run.lock')
const lock = await open(lockPath, 'wx', 0o600)
try {
  const client = walletClient.extend(shieldSwapActions({
    api: {},
    blindedIdentities: fileBlindedIdentityStore(join(accountDirectory, 'identities.json')),
  }))
  const receiptPath = join(accountDirectory, 'result.json')
  const submissionPath = join(accountDirectory, 'submission.json')
  await client.authenticateShieldSwap()

  const access = await client.api.getReferralStatus()
  if (!access.has_access) {
    if (!values['invite-code']) {
      throw new Error('Account needs access. Run npm start -- --invite-code <code> with an issued invite code.')
    }
    await client.api.redeemReferralCode(values['invite-code'])
  }

  /** Claims a known swap, retrying only while its output is not readable. */
  async function claimWhenReady(handle: SwapHandle | MultiHopSwapHandle, imports: Record<string, string>) {
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        return await client.claimSwapOutput({ handle, imports })
      } catch (error) {
        if (!(error instanceof SwapOutputNotFinalizedError)) throw error
        await new Promise((resolve) => setTimeout(resolve, 15_000))
      }
    }
    throw new Error('Output is not readable. Run npm run claim after checking transaction status.')
  }

  /** Claims the output and saves its amounts and transaction ids without claim secrets. */
  async function claimAndSave(handle: SwapHandle | MultiHopSwapHandle, imports: Record<string, string>) {
    const from = await client.tokenData(handle.tokenInId)
    const to = await client.tokenData(handle.tokenOutId)
    const claim = await claimWhenReady(handle, imports)
    const result = {
      network: 'testnet',
      address: account.address,
      swapTransactionId: handle.transactionId,
      claimTransactionId: claim.transactionId,
      received: { amount: formatUnits(claim.amountOut, to.decimals), symbol: to.symbol },
      refunded: { amount: formatUnits(claim.amountRemaining, from.decimals), symbol: from.symbol },
    }
    await writeFile(`${receiptPath}.tmp`, JSON.stringify(result, null, 2), { mode: 0o600 })
    await rename(`${receiptPath}.tmp`, receiptPath)
    assert.ok(claim.amountOut > 0n, 'Claim confirmed without an output amount; inspect result.json')
  }

  if (values.claim) {
    const submission = JSON.parse(await readFile(submissionPath, 'utf8'))
    const pending = await client.getUnclaimedSwaps()
    if (pending.unresolvable.length || pending.swaps.some((swap) => !swap.handle)) {
      throw new Error('A pending swap needs history reconciliation. Keep .state and inspect the SDK recovery guide.')
    }
    if (pending.swaps.length === 0) {
      throw new Error('No claimable output found. The swap may be pending or already claimed; no new swap was submitted.')
    }
    for (const swap of pending.swaps) {
      const handle = swap.handle!
      await claimAndSave(handle, submission.imports)
    }
  } else {
    // Check before requesting another faucet drop or planning another trade.
    try {
      await readFile(submissionPath)
      throw new Error('A swap was already attempted. Inspect result.json or run npm run claim.')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    const drop = await client.api.confirmAirdrop(account.address)
    await writeFile(join(accountDirectory, 'airdrop.json'), JSON.stringify(drop, null, 2), { mode: 0o600 })

    const from = await client.tokenData('USDCx')
    const amountIn = parseUnits('1.5', from.decimals)
    // The faucet can settle before the scanner indexes the private records.
    let funded = false
    for (let attempt = 0; attempt < 40; attempt++) {
      const balances = await client.getBalances()
      if ((balances[from.id]?.private ?? 0n) >= amountIn) {
        funded = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 15_000))
    }
    if (!funded) {
      const fundingStatus = drop.status === 'settled'
        ? drop.job.results.find((token) => token.symbol === 'USDCx')?.status ?? 'missing'
        : drop.status
      throw new Error(`Spendable USDCx did not arrive (faucet: ${fundingStatus}); inspect airdrop.json and retry later.`)
    }

    const plan = await client.planSwap({ from: from.id, to: 'ETH', amountIn, slippageBps: 50 })
    await reserveSwap(submissionPath, { network: 'testnet', imports: plan.imports })
    const parameters = {
      tokenInId: plan.from.id,
      amountIn: plan.amountIn,
      expectedOut: plan.expectedOut,
      slippageBps: plan.slippageBps,
      imports: plan.imports,
    }
    const handle = plan.multiHop
      ? await client.swapMultiHop({ ...parameters, poolKeys: plan.poolKeys })
      : await client.swap({ ...parameters, poolKey: plan.poolKeys[0]! })
    await claimAndSave(handle, plan.imports)
  }
} finally {
  await lock.close()
  await unlink(lockPath)
}
