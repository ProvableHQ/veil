/**
 * Getting from nothing to a client that can trade.
 *
 * Three things have to exist before a swap will go through, and they are issued
 * by different services, so it is worth knowing which is which:
 *
 *   1. An Aleo account. A private key. Generated locally, never registered
 *      anywhere.
 *   2. A Shield Swap session. The account signs a challenge; most DEX endpoints
 *      refuse to answer without it.
 *   3. DEX access. Invite-gated per account, redeemed with a code.
 *
 * Delegated proving and the record scanner run on the Provable gateway, which
 * needs no credentials. Each step below checks before it acts, so running this
 * twice is safe. Every credential it obtains is returned rather than written
 * anywhere — persisting them is the caller's decision.
 *
 * Reads that touch only pools and tokens need none of this. Start at
 * `readClient` if that is all the work requires.
 */
import { createPublicClient, http, publicActions } from '../../packages/core/src/index.js'
import { generateAccount, loadNetwork } from '../../packages/provable-sdk/src/index.js'
import { shieldSwapActions } from '../../packages/shield-swap/src/index.js'

const NODE_URL = 'https://edge.provable.com/api/v2'

/**
 * Builds a client that reads pools, tokens, and chain state.
 *
 * No key, no proving, no scanner — a transport is the whole requirement. Pool
 * and token discovery are the two DEX endpoints served without a bearer token,
 * and every chain read goes straight to the node.
 */
export function readClient() {
  return createPublicClient({ transport: http(NODE_URL, { network: 'testnet' }) }).extend(
    shieldSwapActions({ api: {} }),
  )
}

/**
 * Walks the whole bootstrap and returns a client ready to sign, prove, and trade.
 *
 * @param config.privateKey An existing account. Omit to generate a fresh one —
 *   which is a new, unfunded account, not a way to recover an old one.
 * @param config.provable Legacy Provable consumer credentials. Falls back to
 *   ALEO_CONSUMER_ID and ALEO_DPS_API_KEY in the environment. Not needed; the
 *   gateway is unauthenticated, and the pair is carried but never sent.
 * @param config.username Ignored. Nothing registers anymore.
 * @param config.inviteCode Redeemed when the account does not yet have DEX
 *   access. Codes are one-time.
 */
export async function setupClient(config: {
  privateKey?: string
  provable?: { consumerId: string; apiKey: string }
  username?: string
  inviteCode?: string
} = {}) {
  // ── 1. The account ──────────────────────────────────────────────────
  // A key is generated locally and is immediately valid on chain — there is no
  // registration step and nothing to wait for. A fresh one holds nothing, so a
  // returning user passes their existing key instead.
  const privateKey = config.privateKey ?? generateAccount().privateKey

  // ── 2. The client ───────────────────────────────────────────────────
  // `provingMode: 'delegated'` sends proving to the Provable prover instead of
  // running it locally, which is what keeps this usable without a heavy WASM
  // build. The prover also pays transaction fees from its FeeMaster account, so
  // a faucet-funded account needs no public credits of its own. The gateway
  // needs no credentials: legacy consumer credentials are accepted and unused.
  const provable =
    config.provable ??
    (process.env.ALEO_CONSUMER_ID && process.env.ALEO_DPS_API_KEY
      ? { consumerId: process.env.ALEO_CONSUMER_ID, apiKey: process.env.ALEO_DPS_API_KEY }
      : undefined)
  const aleo = await loadNetwork('testnet')
  const { walletClient, account } = aleo.createAleoClient({
    privateKey,
    networkUrl: NODE_URL,
    provingMode: 'delegated',
    ...(provable ?? {}),
    // The scanner is what makes private balances readable. Without it the
    // client can still read pools, but cannot find a record to spend.
    records: aleo.createRemoteScanner(),
  })

  // `.extend()` is viem's composition step: it returns a client carrying the DEX
  // actions, so everything afterwards is `client.planSwap()`, `client.swap()`,
  // and the rest hanging off one object.
  const client = walletClient.extend(publicActions).extend(shieldSwapActions({ api: {} }))

  // ── 4. The DEX session ──────────────────────────────────────────────
  // The account signs a challenge and gets a session back. Routes, balances, fee
  // tiers, and positions all refuse to answer without it. The session renews
  // itself on expiry, so this is called once.
  await client.authenticateShieldSwap()

  // ── 5. DEX access ───────────────────────────────────────────────────
  // Separate from authentication: the session proves who the account is, access
  // decides whether it may trade at all. Check before redeeming, because a code
  // is spent on use and there is no way to get it back.
  const access = await client.api.getReferralStatus()
  if (!access.has_access) {
    if (!config.inviteCode) {
      throw new Error(`${account.address} has no DEX access yet — pass an invite code to redeem one.`)
    }
    await client.api.redeemReferralCode(config.inviteCode)
  }

  return { client, account, privateKey, provable }
}

/**
 * Draws testnet tokens and waits for them to arrive.
 *
 * The faucet delivers private records, so the public balance stays at zero and a
 * balance read shows nothing until the scanner has indexed them. Testnet only —
 * there is no faucet on mainnet.
 *
 * @param client A client from {@link setupClient}.
 * @param address The account to fund.
 */
export async function fundFromFaucet(
  client: Awaited<ReturnType<typeof setupClient>>['client'],
  address: string,
) {
  const job = await client.api.airdrop(address)

  // The faucet transfers each token separately and reports progress per token,
  // so this polls the job rather than assuming one confirmation covers it.
  for (let attempt = 0; attempt < 60; attempt++) {
    const status = await client.api.getAirdropStatus(job.job_id)
    if (status.status === 'completed') return status
    if (status.status === 'failed') throw new Error(`airdrop ${job.job_id} failed`)
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }
  throw new Error(`airdrop ${job.job_id} did not finish in five minutes`)
}
