/**
 * Shield Swap account bootstrap — the startup gauntlet, idempotent.
 *
 * Run it as many times as needed; every step is check-then-act, so a failed
 * or interrupted run resumes where it stopped:
 *
 *   1. Key material        — reuse the stored account, import the user's
 *                            existing key, or (only with --new) generate one
 *   2. Provable API        — reuse/import credentials, else self-register a
 *                            consumer for proving + scanning
 *   3. DEX authentication  — challenge/verify session with the account
 *   4. Invite code         — check access; redeem a code when one is provided
 *   5. API token           — mint a long-lived ss_ token for later sessions
 *   6. Airdrop             — request testnet tokens when holdings are empty,
 *                            then poll until the PRIVATE records land
 *
 * Usage:
 *   npx tsx setup.ts --new                          # brand-new account
 *   npx tsx setup.ts --private-key APrivateKey1...  # returning user
 *   npx tsx setup.ts --invite-code CODE             # when access is locked
 *
 * Environment fallbacks: SHIELD_SWAP_PRIVATE_KEY, ALEO_CONSUMER_ID +
 * ALEO_DPS_API_KEY, SHIELD_SWAP_INVITE_CODE.
 *
 * Exit codes: 0 ready · 2 needs input from the user (message says what) ·
 * 3 airdrop still pending · 1 anything else.
 *
 * State lands in ./.shield-swap/state.json (private key + credentials —
 * gitignore it, treat it like a wallet file).
 */
import { ApiError } from '@provablehq/shield-swap-sdk'
import {
  loadState,
  saveState,
  ensureKeyMaterial,
  ensureProvableApiCredentials,
  NeedsConfigDecisionError,
  loadSession,
  getHoldings,
  pollUntil,
} from './session.js'

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const inviteCode = argValue('--invite-code') ?? process.env.SHIELD_SWAP_INVITE_CODE
const importKey = argValue('--private-key') ?? process.env.SHIELD_SWAP_PRIVATE_KEY
const consumerId = argValue('--consumer-id') ?? process.env.ALEO_CONSUMER_ID
const apiKey = argValue('--api-key') ?? process.env.ALEO_DPS_API_KEY
const allowGenerate = process.argv.includes('--new')

async function main() {
  // ── 1 + 2: key material and Provable API credentials ────────────────
  let state = loadState()
  try {
    state = await ensureKeyMaterial(state, { importKey, allowGenerate })
  } catch (err) {
    if (err instanceof NeedsConfigDecisionError) {
      console.error(
        '\nNEEDS_CONFIG_DECISION: no shield-swap account is configured here. Ask the user ' +
          'whether they already have one before creating anything:\n' +
          '  - existing account → re-run with --private-key <APrivateKey1...>\n' +
          '    (add --consumer-id/--api-key if they have Provable API credentials)\n' +
          '  - brand new       → re-run with --new\n',
      )
      process.exit(2)
    }
    throw err
  }
  console.log(`✓ account: ${state.address}`)

  state = await ensureProvableApiCredentials(state, consumerId && apiKey ? { consumerId, apiKey } : undefined)
  console.log(`✓ Provable API consumer: ${state.provableApi!.consumerId}`)

  // ── 3: wire the client and authenticate with the DEX API ────────────
  const { client, account } = await loadSession()
  console.log('✓ DEX API session established (challenge/verify)')

  // ── 4: invite-code access gate ───────────────────────────────────────
  const status = await client.api.getAccessStatus()
  if (!status.has_access) {
    if (!inviteCode) {
      console.error(
        '\nNEEDS_INVITE_CODE: this account has not redeemed an invite code, so ' +
          'the DEX API is locked. Ask the user for their invite code, then re-run:\n' +
          '  npx tsx setup.ts --invite-code <code>\n',
      )
      process.exit(2)
    }
    try {
      await client.api.redeemAccessCode(inviteCode)
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        console.error(
          `\nINVALID_INVITE_CODE: the server rejected "${inviteCode}" (${err.message}). ` +
            'Ask the user for a valid, unused code and re-run.\n',
        )
        process.exit(2)
      }
      throw err
    }
    state.accessRedeemed = true
    saveState(state)
    console.log('✓ invite code redeemed — access unlocked')
  } else {
    state.accessRedeemed = true
    saveState(state)
    console.log('✓ access already granted')
  }

  // ── 5: long-lived API token for later sessions ───────────────────────
  if (!state.dexApiToken) {
    const created = await client.api.createApiToken({ name: `ss-agent-${account.address.slice(5, 17)}` })
    state.dexApiToken = created.token
    saveState(state)
    console.log(`✓ minted DEX API token (${created.token_prefix}…, stored in state file)`)
  } else {
    console.log('✓ DEX API token already on file')
  }

  // ── 6: airdrop when the account holds nothing ────────────────────────
  // The faucet delivers PRIVATE records, so the check must scan the private
  // side; a fresh account's public balances stay zero even after funding.
  const funded = async () => {
    const holdings = await getHoldings(client, account.address)
    return holdings.some((h) => h.publicAmount > 0n || h.privateAmount > 0n)
  }
  if (await funded()) {
    console.log('✓ account already funded')
  } else {
    const job = await client.api.airdrop(account.address)
    console.log(`… airdrop started (job ${job.job_id})`)

    // Two phases: the faucet job finishing (fast), then the record service
    // indexing the new private records (slower, asynchronous).
    await pollUntil(async () => {
      const s = await client.api.getAirdropStatus(job.job_id).catch(() => null)
      return s?.status === 'complete'
    }, 24, 5_000)
    console.log('… faucet job complete — waiting for the records to become scannable')

    const landed = await pollUntil(funded, 36, 10_000)
    if (!landed) {
      console.error(
        '\nAIRDROP_PENDING: the faucet finished but the records are not scannable ' +
          'yet (the record service indexes asynchronously). Re-run setup.ts in a ' +
          'few minutes — it will not double-request.\n',
      )
      process.exit(3)
    }
    console.log('✓ airdrop landed')
  }

  // ── report ────────────────────────────────────────────────────────────
  const holdings = await getHoldings(client, account.address)
  console.log(`\nAccount ${account.address} is ready:`)
  for (const h of holdings) {
    if (h.publicAmount > 0n || h.privateAmount > 0n) {
      console.log(`  ${h.symbol}: public ${h.publicAmount}, private ${h.privateAmount} (${h.wrapperProgram ?? 'no wrapper'})`)
    }
  }
  console.log('\nNext: read swapping.md or liquidity.md to trade.')
}

main().catch((err) => {
  console.error('\nSETUP_FAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
})
