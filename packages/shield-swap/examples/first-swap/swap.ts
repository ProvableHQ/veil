/** Create and fund a testnet account, swap 1.5 USDCx for ETH, and claim the output. */
import { writeFile } from 'node:fs/promises'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { parseUnits, shieldSwapActions } from '@provablehq/shield-swap-sdk'
import { swapFileStore } from '@provablehq/shield-swap-sdk/node'

// Create an account or use an existing key. Retain a generated key for recovery.
const aleo = await loadNetwork('testnet')
const privateKey = process.env.SHIELD_SWAP_PRIVATE_KEY ?? aleo.generateAccount().privateKey
if (!process.env.SHIELD_SWAP_PRIVATE_KEY) {
  await writeFile('private-key.txt', privateKey, { mode: 0o600, flag: 'wx' })
}

// Create a wallet client for testnet.
const { walletClient, account } = aleo.createAleoClient({ privateKey })
// Add DEX actions (quote, swap, claim) to the same signing client.
const client = walletClient.extend(shieldSwapActions({
  // Enable the DEX API using this client's network defaults for quotes and the faucet.
  api: {},
  // Persist swap data to disk across process restarts and multiple processes.
  blindedIdentities: swapFileStore(`${account.address}.json`),
}))

// Reuse an existing private balance; request test tokens only when needed.
await client.authenticateShieldSwap()
const amountIn = '1.5'
const from = await client.tokenData('USDCx')
const balances = await client.getBalances({ tokens: [from.id] })
if ((balances[from.id]?.private ?? 0n) < parseUnits(amountIn, from.decimals)) {
  console.log('Requesting test tokens and waiting for their records.')
  await client.api.confirmAirdrop(account.address)
} else {
  console.log('Using the existing private USDCx balance; skipping the airdrop.')
}

// Quote a 0.5% slippage allowance. Swap chooses single- or multi-hop execution.
const quote = await client.quote({ from: 'USDCx', to: 'ETH', amountIn, slippageBps: 50 })
const handle = await client.swap({ quote })

// Wait for the swap to succeed, then submit the claim once.
await client.waitForSwapOutput({ handle })
const claim = await client.claimSwapOutput({ handle })
if (claim.amountOut <= 0n) throw new Error('The claim returned no ETH')
