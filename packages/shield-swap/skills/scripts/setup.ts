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
 *   npx tsx setup.ts --new                            # brand-new account
 *   npx tsx setup.ts --private-key-file <path>        # returning user (key in a file)
 *   npx tsx setup.ts --invite-code CODE               # when access is locked
 *
 * A private key is NEVER pasted into a conversation or command history: a
 * returning user either writes it to a file and passes the path, or exports
 * SHIELD_SWAP_PRIVATE_KEY (or SHIELD_SWAP_PRIVATE_KEY_FILE) in their own
 * shell. Other environment fallbacks: ALEO_CONSUMER_ID + ALEO_DPS_API_KEY,
 * SHIELD_SWAP_INVITE_CODE.
 *
 * Exit codes: 0 ready · 2 needs input from the user (message says what) ·
 * 3 airdrop still pending · 1 anything else.
 *
 * State lands in ./.shield-swap/state.json (private key + credentials —
 * gitignore it, treat it like a wallet file).
 */
import { readFileSync } from 'node:fs'
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
const consumerId = argValue('--consumer-id') ?? process.env.ALEO_CONSUMER_ID
const apiKey = argValue('--api-key') ?? process.env.ALEO_DPS_API_KEY
const allowGenerate = process.argv.includes('--new')

// The key itself never travels through a conversation or the command line:
// it is read from a file the user wrote, or from an env var the user
// exported in their own shell.
function resolveImportKey(): string | undefined {
  const keyFile = argValue('--private-key-file') ?? process.env.SHIELD_SWAP_PRIVATE_KEY_FILE
  if (keyFile) {
    const key = readFileSync(keyFile, 'utf8').trim()
    if (!key) throw new Error(`private key file ${keyFile} is empty`)
    return key
  }
  return process.env.SHIELD_SWAP_PRIVATE_KEY
}
const importKey = resolveImportKey()

async function main() {
  // ── 1 + 2: key material and Provable API credentials ────────────────
  let state = loadState()
  try {
    state = await ensureKeyMaterial(state, { importKey, allowGenerate })
  } catch (err) {
    if (err instanceof NeedsConfigDecisionError) {
      console.error(
        '\nNEEDS_CONFIG_DECISION: no shield-swap account is configured here. Ask the user ' +
          'whether they already have one before creating anything. NEVER ask them to paste ' +
          'a private key into the conversation:\n' +
          '  - existing account → the user saves their key to a file themselves, then re-run\n' +
          '    with --private-key-file <path> (or they export SHIELD_SWAP_PRIVATE_KEY in\n' +
          '    their own shell). Add --consumer-id/--api-key if they have Provable API\n' +
          '    credentials.\n' +
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
    // Distributed codes come in two kinds with one purpose: access codes
    // (/access/redeem) and referral codes (/referral/redeem) both unlock
    // the account. Try both before rejecting the code.
    let redeemed = false
    for (const attempt of [
      () => client.api.redeemAccessCode(inviteCode),
      () => client.api.redeemReferralCode(inviteCode),
    ]) {
      try {
        await attempt()
        redeemed = true
        break
      } catch (err) {
        if (err instanceof ApiError && err.status === 400) continue
        throw err
      }
    }
    if (!redeemed) {
      console.error(
        `\nINVALID_INVITE_CODE: the server rejected "${inviteCode}" as both an access ` +
          'code and a referral code. Ask the user for a valid, unused code and re-run.\n',
      )
      process.exit(2)
    }
    state.accessRedeemed = true
    saveState(state)
    console.log('✓ code redeemed — access unlocked')
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
    // Request the faucet at most once per account: the job id persists in
    // the state file, so a re-run resumes polling instead of double-drawing.
    if (!state.airdropJobId) {
      const job = await client.api.airdrop(account.address)
      state.airdropJobId = job.job_id
      saveState(state)
      console.log(`… airdrop started (job ${job.job_id})`)
    } else {
      console.log(`… resuming airdrop job ${state.airdropJobId}`)
    }

    // Two phases: the faucet job finishing (fast), then the record service
    // indexing the new private records (slower, asynchronous).
    let job: Awaited<ReturnType<typeof client.api.getAirdropStatus>> | null = null
    const jobDone = await pollUntil(async () => {
      job = await client.api.getAirdropStatus(state.airdropJobId!).catch(() => null)
      return job?.status === 'complete'
    }, 24, 5_000)
    if (!jobDone) {
      console.error(
        `\nAIRDROP_PENDING: faucet job ${state.airdropJobId} has not completed yet ` +
          `(last status: ${job ? (job as { status?: string }).status : 'unknown'}). ` +
          'Re-run setup.ts in a few minutes — it resumes this job, it does not double-request.\n',
      )
      process.exit(3)
    }
    const rejected = (job!.results ?? []).filter((r: { status?: string }) => r.status !== 'accepted')
    if (rejected.length > 0) {
      // The job finished but some transfers failed — surface it and allow a
      // fresh request next run instead of resuming a dead job forever.
      state.airdropJobId = undefined
      saveState(state)
      console.error(
        `\nAIRDROP_FAILED: faucet job finished with rejected transfers: ` +
          `${rejected.map((r: { symbol?: string; status?: string }) => `${r.symbol}:${r.status}`).join(', ')}. ` +
          'Re-run setup.ts to request a fresh airdrop.\n',
      )
      process.exit(3)
    }
    console.log('… faucet job complete — waiting for the records to become scannable')

    const landed = await pollUntil(funded, 36, 10_000)
    if (!landed) {
      console.error(
        '\nAIRDROP_PENDING: the faucet finished but the records are not scannable ' +
          'yet (the record service indexes asynchronously). Re-run setup.ts in a ' +
          'few minutes — it resumes this job, it does not double-request.\n',
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
