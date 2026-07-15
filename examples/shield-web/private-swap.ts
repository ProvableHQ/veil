/**
 * A private swap on Shield Swap using the Shield WEB wallet.
 *
 * This runs in the BROWSER, not Node: the Shield wallet extension is injected
 * into the page, holds the keys and records, derives the single-use blinded
 * identity a private swap settles under, and proves the transaction. The app
 * never touches a private key.
 *
 * If you know viem, the shape is familiar — build a wallet client from the
 * connected wallet, `.extend()` it with the DEX actions, call typed methods.
 * A private swap is two wallet-signed transactions: a `swap` request, then a
 * `claim` once the chain has computed the output.
 *
 * Wire `shieldPrivateSwap()` to a button in a dApp (it needs a user gesture to
 * open the wallet). Requires `@provablehq/aleo-wallet-adaptor-shield` and the
 * Shield extension installed in the browser.
 */

import {
  createWalletClient,
  fallback,
  http,
  getProgram,
  getTransaction,
  extractTransitions,
  type InputRequest,
} from '@provablehq/veil-core'
import { fromWalletAdapter } from '@provablehq/veil-aleo-wallet-adapter'
import { ShieldWalletAdapter } from '@provablehq/aleo-wallet-adaptor-shield'
import { Network } from '@provablehq/aleo-types'
import { WalletDecryptPermission } from '@provablehq/aleo-wallet-standard'
import {
  shieldSwapActions,
  SHIELD_SWAP_ALGORITHM_GRANTS,
  SwapOutputNotFinalizedError,
} from '@provablehq/shield-swap-sdk'

const NODE_URL = 'https://api.provable.com/v2' // Aleo node — chain reads
const AMM_API_URL = 'https://amm-api.dev.provable.com' // Shield Swap indexer — pool discovery

/**
 * Connects the Shield web wallet and runs one private swap end to end.
 *
 * @param amountIn Raw atomic amount of the pool's token0 to sell (u128 width).
 * @returns The swap id and the claimed output/refund amounts.
 */
export async function shieldPrivateSwap(amountIn = 1_000_000n) {
  // 1. Connect the Shield web wallet. The algorithm grants authorize it to
  //    derive the blinded identity private swaps and claims need; UponRequest
  //    makes it prompt before decrypting your records.
  const adapter = new ShieldWalletAdapter()
  await adapter.connect(
    Network.TESTNET,
    WalletDecryptPermission.UponRequest,
    undefined, // programs to pre-grant decrypt for (optional; UponRequest prompts instead)
    { algorithmsAllowed: SHIELD_SWAP_ALGORITHM_GRANTS },
  )

  // 2. Build the client. The wallet transport signs + proves; an http transport
  //    serves chain reads — `fallback` tries the wallet first, then the node.
  const { account, transport: wallet } = fromWalletAdapter(adapter)
  const client = createWalletClient({
    account,
    transport: fallback([wallet, http(NODE_URL, { network: 'testnet' })]),
  }).extend(shieldSwapActions({ api: { baseUrl: AMM_API_URL } }))

  // 3. Pick a pool and read its token metadata.
  const { data: pools } = await client.api.getPools()
  const pool = pools[0]
  if (!pool) throw new Error('Shield Swap has no pools to trade against yet.')
  const t0 = pool.token0_info
  const t1 = pool.token1_info
  if (!t0?.wrapper_program || !t1?.wrapper_program) {
    throw new Error('Pool token metadata is not indexed yet — try again shortly.')
  }

  // 4. Preload the token program sources the swap dispatches into.
  const imports = {
    [t0.wrapper_program]: await getProgram(client, { programId: t0.wrapper_program }),
    [t1.wrapper_program]: await getProgram(client, { programId: t1.wrapper_program }),
  }

  // 5. Phase 1 — request the swap. On the wallet path the records live in the
  //    wallet, so hand it a `record` InputRequest (it selects one covering the
  //    amount) rather than a program id, and it fills the blinding slots itself.
  //    The returned handle therefore comes back WITHOUT swapId / blindedAddress.
  const tokenRecord: InputRequest = {
    type: 'record',
    program: t0.wrapper_program,
    recordname: 'Token',
    filters: { amount: { gte: `${amountIn}u128` } },
  }
  const handle = await client.swap({
    poolKey: pool.key,
    tokenInId: pool.token0,
    amountIn,
    slippageBps: 100, // 1% spot-price floor; pass expectedOut from a real quote for larger trades
    imports,
    tokenRecord,
  })

  // 6. Recover swapId + blindedAddress from the confirmed request transaction —
  //    the wallet filled the blinding slots, so the handle lacks them. swapId is
  //    the swap transition's first `field` output; the blinded address is the
  //    swap's recorded recipient.
  const tx = await getTransaction(client, { id: handle.transactionId })
  const swapId = extractTransitions(tx).outputs.find((output) => output.endsWith('field'))
  if (!swapId) {
    throw new Error('swap_id not in the request transaction yet — retry once it finalizes.')
  }
  handle.swapId = swapId
  handle.blindedAddress = (await client.api.getSwap(swapId)).data.recipient

  // 7. Phase 2 — claim. The output is not yours until claimed. Retry while the
  //    request finalizes (the indexer runs a few seconds behind the chain).
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const { amountOut, amountRemaining } = await client.claimSwapOutput({ handle, imports })
      return { swapId, amountOut, amountRemaining }
    } catch (err) {
      if (!(err instanceof SwapOutputNotFinalizedError)) throw err
      await new Promise((resolve) => setTimeout(resolve, 3_000))
    }
  }
  throw new Error('Swap output did not finalize in time.')
}
