/** Create and fund a testnet account, swap 1.5 USDCx for ETH, and claim the output. */
import { writeFile } from 'node:fs/promises'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { shieldSwapActions } from '@provablehq/shield-swap-sdk'
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

// Authenticate and wait for the faucet records to arrive in the configured scanner.
await client.authenticateShieldSwap()
const drop = await client.api.confirmAirdrop(account.address)

// Quote a 0.5% output floor. Swap chooses single- or multi-hop execution.
const quote = await client.quote({ from: 'USDCx', to: 'ETH', amountIn: '1.5', slippageBps: 50 })
const handle = await client.swap({ quote })

// Wait for the swap to succeed, then submit the claim once.
await client.waitForSwapOutput({ handle })
const claim = await client.claimSwapOutput({ handle })
if (claim.amountOut <= 0n) throw new Error('The claim returned no ETH')
