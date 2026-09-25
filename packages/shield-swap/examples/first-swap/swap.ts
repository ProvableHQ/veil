/** Create and fund a testnet account, swap 1.5 USDCx for ETH, and claim the output. */
import { writeFile } from 'node:fs/promises'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { parseUnits, shieldSwapActions, SwapOutputNotFinalizedError } from '@provablehq/shield-swap-sdk'
import { fileBlindedIdentityStore } from '@provablehq/shield-swap-sdk/node'

// Create an account or use an existing key. Retain a generated key for recovery.
const aleo = await loadNetwork('testnet')
const privateKey = process.env.SHIELD_SWAP_PRIVATE_KEY ?? aleo.generateAccount().privateKey
if (!process.env.SHIELD_SWAP_PRIVATE_KEY) {
  await writeFile('private-key.txt', privateKey, { mode: 0o600, flag: 'wx' })
}

const { walletClient, account } = aleo.createAleoClient({ privateKey })
const client = walletClient.extend(shieldSwapActions({
  api: {},
  blindedIdentities: fileBlindedIdentityStore(`${account.address}.json`),
}))

// Authenticate with Shield Swap and wait for the testnet faucet to settle.
await client.authenticateShieldSwap()
const drop = await client.api.confirmAirdrop(account.address)

const from = await client.tokenData('USDCx')
const amountIn = parseUnits('1.5', from.decimals)

// Wait for confirmed faucet records to become readable by the scanner.
for (let attempt = 0; attempt < 40; attempt++) {
  const balances = await client.getBalances()
  if ((balances[from.id]?.private ?? 0n) >= amountIn) break
  if (attempt === 39) throw new Error('USDCx is not available; inspect the faucet result and account balance')
  await new Promise((resolve) => setTimeout(resolve, 15_000))
}

// Plan the route with a 0.5% slippage limit, then submit it once.
const plan = await client.planSwap({ from: from.id, to: 'ETH', amountIn, slippageBps: 50 })
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

// Claim the output. Retry only while it is not yet readable on chain.
for (let attempt = 0; attempt < 40; attempt++) {
  try {
    const claim = await client.claimSwapOutput({ handle, imports: plan.imports })
    if (claim.amountOut <= 0n) throw new Error('The claim returned no ETH')
    break
  } catch (error) {
    if (!(error instanceof SwapOutputNotFinalizedError) || attempt === 39) throw error
    await new Promise((resolve) => setTimeout(resolve, 15_000))
  }
}
