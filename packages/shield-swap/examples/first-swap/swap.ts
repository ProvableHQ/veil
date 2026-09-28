/** Create and fund a testnet account, swap 1.5 USDCx for ETH, and claim the output. */
import { writeFile } from 'node:fs/promises'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { waitForConfirmation } from '@provablehq/veil-core'
import { parseUnits, shieldSwapActions } from '@provablehq/shield-swap-sdk'
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

// Authenticate and wait for the faucet records to arrive in the configured scanner.
await client.authenticateShieldSwap()
const drop = await client.api.confirmAirdrop(account.address)

const from = await client.tokenData('USDCx')
const amountIn = parseUnits('1.5', from.decimals)

// Quote a 0.5% output floor. Swap chooses single- or multi-hop execution.
const quote = await client.quote({ from: from.id, to: 'ETH', amountIn, slippageBps: 50 })
const handle = await client.swap({ quote })

// The claim dispatches to the input/output token programs, whose sources it needs.
const imports = await client.resolveDexImports({
  tokenPrograms: [quote.from, quote.to].flatMap((token) => token.ammTokenProgram ? [token.ammTokenProgram] : []),
  program: quote.program,
})

// Wait for the swap to succeed, then submit the claim once.
await waitForConfirmation(client, handle.transactionId)
const claim = await client.claimSwapOutput({ handle, imports })
if (claim.amountOut <= 0n) throw new Error('The claim returned no ETH')
