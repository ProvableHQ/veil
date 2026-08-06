/**
 * Shield Swap account bootstrap — the startup gauntlet, idempotent.
 *
 * Run it as many times as needed; every step is check-then-act, so a failed
 * or interrupted run resumes where it stopped:
 *
 *   1. Key material        — reuse the stored account, import the user's
 *                            existing key, or (only with --new) generate one
 *   2. DEX authentication  — challenge/verify session with the account
 *   3. Provable API        — reuse/import credentials, else self-register a
 *                            consumer for proving + scanning
 *   4. Invite code         — check access; redeem a code when one is provided
 *   5. API token           — mint a long-lived ss_ token for later sessions
 *   6. Airdrop             — request testnet tokens when holdings are empty,
 *                            then poll until the PRIVATE records land
 *
 * Usage:
 *   shield-swap setup --new                            # brand-new account
 *   shield-swap setup --network mainnet --private-key-file <path>   # mainnet
 *   shield-swap setup --private-key-file <path>        # returning user (key in a file)
 *   shield-swap setup --invite-code CODE               # when access is locked
 *   shield-swap setup --api-url <origin>               # pin a DEX API deployment
 *
 * A private key is NEVER pasted into a conversation or command history: a
 * returning user either writes it to a file and passes the path, or exports
 * SHIELD_SWAP_PRIVATE_KEY (or SHIELD_SWAP_PRIVATE_KEY_FILE) in their own
 * shell. Other environment fallbacks: ALEO_CONSUMER_ID + ALEO_DPS_API_KEY,
 * SHIELD_SWAP_INVITE_CODE, SHIELD_SWAP_API_URL.
 *
 * Exit codes: 0 ready · 2 needs input from the user (message says what) ·
 * 3 airdrop still pending · 1 anything else.
 *
 * State lands in ./.shield-swap/<network>/state.json (private key +
 * credentials — gitignore it, treat it like a wallet file). Nothing is shared
 * between networks, including the blinded identity store, whose reservations
 * are only meaningful against the chain they were checked on.
 *
 * Mainnet moves real value, so it is never the default: pass
 * `--network mainnet` explicitly. The airdrop step is testnet-only and refuses
 * to run on mainnet rather than pretending a faucet exists.
 */
import { readFileSync } from 'node:fs'
import { ApiError, DEFAULT_API_URL } from '@provablehq/shield-swap-sdk'
import { fileCredentialStore } from '@provablehq/veil-aleo-sdk/node'
import {
  loadState,
  saveState,
  ensureKeyMaterial,
  credentialsPath,
  resolveNetwork,
  stateDir,
  NeedsConfigDecisionError,
  loadSession,
  formatAmount,
  pollUntil,
} from '../session.js'

const USAGE = `shield-swap setup — bootstrap an account and get it funded

  --new                         generate a brand-new account
  --private-key-file <path>     import an existing key, read from this file
  --consumer-id <id>            Provable API consumer id (else self-registers)
  --api-key <key>               Provable API key
  --invite-code <code>          redeem an invite code when access is locked
  --api-url <origin>            pin a DEX API deployment
  --network <testnet|mainnet>   default testnet

Every step is check-then-act, so re-running resumes where a failed run stopped.

A private key is NEVER pasted into a conversation or command history: write it
to a file and pass --private-key-file, or export SHIELD_SWAP_PRIVATE_KEY in your
own shell. Other environment fallbacks: SHIELD_SWAP_PRIVATE_KEY_FILE,
ALEO_CONSUMER_ID, ALEO_DPS_API_KEY, SHIELD_SWAP_INVITE_CODE, SHIELD_SWAP_API_URL.

Exit codes: 0 ready · 2 needs input from the user · 3 airdrop still pending ·
1 anything else.`

/**
 * Reads a `--flag value` pair out of the arguments.
 *
 * `setup` keeps its own reader rather than using the shared `flags()`: every
 * option is an optional string with an environment-variable fallback, and none
 * of them gate a transaction, so the strict unknown-flag rejection that
 * protects the spending commands would only get in the way here.
 *
 * @param argv Arguments after the subcommand name.
 * @param flag The flag to look for, leading dashes included.
 * @returns The argument that follows the flag, or undefined when it is absent.
 */
function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

/**
 * Resolves the private key to import, when the caller is restoring an account.
 *
 * The key itself never travels through a conversation or the command line: it
 * is read from a file the user wrote, or from an env var the user exported in
 * their own shell.
 *
 * @param argv Arguments after the subcommand name.
 * @returns The key to import, or undefined when this is a fresh account.
 * @throws If the named key file exists but is empty.
 */
function resolveImportKey(argv: string[]): string | undefined {
  const keyFile = argValue(argv, '--private-key-file') ?? process.env.SHIELD_SWAP_PRIVATE_KEY_FILE
  if (keyFile) {
    const key = readFileSync(keyFile, 'utf8').trim()
    if (!key) throw new Error(`private key file ${keyFile} is empty`)
    return key
  }
  return process.env.SHIELD_SWAP_PRIVATE_KEY
}

/**
 * Bootstraps the account, one idempotent step at a time.
 *
 * @param argv Arguments after the subcommand name.
 */
async function setup(argv: string[]): Promise<void> {
  const inviteCode = argValue(argv, '--invite-code') ?? process.env.SHIELD_SWAP_INVITE_CODE
  const consumerId = argValue(argv, '--consumer-id') ?? process.env.ALEO_CONSUMER_ID
  const apiKey = argValue(argv, '--api-key') ?? process.env.ALEO_DPS_API_KEY
  // Flag-only on purpose: SHIELD_SWAP_API_URL stays an ephemeral per-run
  // override (see loadSession); only an explicit --api-url pins the
  // deployment and resets deployment-scoped state.
  const network = resolveNetwork(argValue(argv, '--network'))
  const apiUrl = argValue(argv, '--api-url')?.replace(/\/$/, '')
  const credentialStore = fileCredentialStore(credentialsPath(network))
  const allowGenerate = argv.includes('--new')
  const importKey = resolveImportKey(argv)

  // ── 1 + 2: key material and Provable API credentials ────────────────
  let state = loadState(network)
  console.log(`network: ${network}  ·  state: ${stateDir(network)}`)

  // Pin the DEX API deployment. The access grant, API token, and airdrop
  // job all live in one deployment's database — switching deployments
  // invalidates them, so clear them and let the later steps re-derive.
  // Account key material and Provable API credentials are NOT touched
  // (chain- and prover-scoped, not DEX-scoped).
  if (apiUrl && apiUrl !== (state.apiUrl ?? DEFAULT_API_URL)) {
    state.apiUrl = apiUrl
    state.dexApiToken = undefined
    state.accessRedeemed = undefined
    state.airdropJobId = undefined
    saveState(state)
    console.log(`✓ DEX API pinned to ${state.apiUrl} (deployment-scoped state reset)`)
  }
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

  // Supplied credentials win over registering a new consumer, so a returning
  // user keeps theirs. Absent both, the client registers one below. Awaited
  // because ProvableCredentialStore permits async: this store happens to be
  // synchronous, but reading a promise as a value would silently skip the seed
  // and leave the write unobserved.
  if (consumerId && apiKey && !(await credentialStore.load())) {
    await credentialStore.save({ consumerId, apiKey })
  }

  // Credentials used to live in the state file. Move them rather than letting
  // the client register a replacement: an API key is issued once and cannot be
  // reissued, so a fresh consumer would abandon the old one.
  const legacy = (state as { provableApi?: { consumerId: string; apiKey: string } }).provableApi
  if (legacy && !(await credentialStore.load())) {
    await credentialStore.save(legacy)
    delete (state as { provableApi?: unknown }).provableApi
    saveState(state)
    console.log(`✓ moved Provable API credentials to ${credentialsPath(network)}`)
  }

  // ── 3: wire the client and authenticate with the DEX API ────────────
  // The network must be passed explicitly: loadSession defaults to testnet, so
  // omitting it would authenticate, register, and redeem against testnet while
  // writing the results into the network-scoped state this script resolved.
  const { client, account } = await loadSession({ network })
  console.log('✓ DEX API session established (challenge/verify)')

  // Front-loaded on purpose: registration would otherwise happen on the first
  // prove or scan, and a newly issued API key is only reportable here.
  const provable = await client.authenticateProvableApi()
  console.log(
    `✓ Provable API consumer: ${provable.credentials.consumerId}` +
      (provable.registered ? ` (registered, saved to ${credentialsPath(network)})` : ''),
  )

  // ── 4: invite-code access gate ───────────────────────────────────────
  const status = await client.api.getAccessStatus()
  if (!status.has_access) {
    if (!inviteCode) {
      console.error(
        '\nNEEDS_INVITE_CODE: this account has not redeemed an invite code, so ' +
          'the DEX API is locked. Ask the user for their invite code, then re-run:\n' +
          '  shield-swap setup --invite-code <code>\n',
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
    const balances = await client.getBalances()
    return Object.values(balances).some((b) => b.total > 0n)
  }
  if (await funded()) {
    console.log('✓ account already funded')
  } else if (network === 'mainnet') {
    // There is no mainnet faucet, and quietly skipping would leave the account
    // configured but unable to trade — a failure a user would only discover
    // when a swap could not select a record.
    throw new Error(
      `account ${account.address} holds no tokens on mainnet, and there is no faucet to draw from. ` +
        'Fund it from an exchange or another wallet, then re-run this script to verify.',
    )
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
          'Re-run `shield-swap setup` in a few minutes — it resumes this job, it does not double-request.\n',
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
          'Re-run `shield-swap setup` to request a fresh airdrop.\n',
      )
      process.exit(3)
    }
    console.log('… faucet job complete — waiting for the records to become scannable')

    const landed = await pollUntil(funded, 36, 10_000)
    if (!landed) {
      console.error(
        '\nAIRDROP_PENDING: the faucet finished but the records are not scannable ' +
          'yet (the record service indexes asynchronously). Re-run `shield-swap setup` in a ' +
          'few minutes — it resumes this job, it does not double-request.\n',
      )
      process.exit(3)
    }
    console.log('✓ airdrop landed')
  }

  // ── report ────────────────────────────────────────────────────────────
  const balances = await client.getBalances()
  console.log(`\nAccount ${account.address} is ready on ${network}:`)
  for (const entry of Object.values(balances)) {
    if (entry.total > 0n) {
      const priv = formatAmount(entry.private, entry.decimals, entry.symbol)
      const pub = formatAmount(entry.public, entry.decimals, entry.symbol)
      console.log(`  ${entry.symbol}: ${priv} private, ${pub} public`)
    }
  }
  console.log(
    '\nASK_NEXT_ACTION: setup is complete — ask the user what to do next with ONE ' +
      'user-selectable prompt (the harness\'s selection UI if it has one, a numbered ' +
      'list otherwise) offering ALL SEVEN options below, in this order. Free-form ' +
      'input stays available as the escape hatch ("Other"); map whatever the user ' +
      'types onto the runbooks before improvising against the SDK. Do not pick for ' +
      'them. Frame the setting first: Shield Swap is a private exchange on Aleo — ' +
      'what is traded, and by whom, stays hidden on the public chain. ' +
      (network === 'mainnet'
        ? 'This account is on MAINNET: every trade below moves real funds, and there ' +
          'is no faucet to recover from a mistake. Say so before the user picks.'
        : 'This account is on the test network, so trading uses test tokens.') +
      '\n\n' +
      '1. Develop on Shield Swap (developing.md). For a user building their own\n' +
      '   dApp, trading bot, or server/agent integration rather than trading\n' +
      '   here. If chosen, FIRST ask what they are building, then follow\n' +
      '   developing.md — it picks the packages by where their keys live and\n' +
      '   maps to the docs, examples, and integration caveats.\n' +
      '2. Follow their own playbook. Ask whether they have instructions of\n' +
      '   their own — a markdown strategy file, notes, or a memory store such\n' +
      '   as an Obsidian vault. Their document decides WHAT to do; the runbooks\n' +
      '   here describe HOW each step works.\n' +
      '3. Swap tokens (swapping.md). Trade one token for another. It settles\n' +
      '   in two steps — placing the trade, then collecting what was bought —\n' +
      '   and both happen in one go. The natural first move for a trader.\n' +
      '4. Several swaps at once (swapping.md, concurrency recipe). Place a\n' +
      '   handful of trades in parallel and watch them all land — the busiest\n' +
      '   way to exercise the exchange. First show the user which trades are\n' +
      '   possible right now and ask how many (and which) they want; collect\n' +
      '   each one as it lands.\n' +
      '5. Open a liquidity position (liquidity.md). Instead of trading, become\n' +
      '   the market: deposit a pair of tokens so other people can trade against\n' +
      '   them. The user picks the price range their deposit works in, and while\n' +
      '   the market price sits inside that range they earn a small cut of every\n' +
      '   trade that passes through.\n' +
      '6. Add or remove liquidity (liquidity.md). Top up a position, or take\n' +
      '   some of it back out — whatever comes out becomes earnings to collect.\n' +
      '7. Collect earnings (collecting.md). Sweep up everything the account is\n' +
      '   owed — tokens bought in earlier swaps and the fees its liquidity\n' +
      '   earned — into the wallet. Good to run after any trading session.\n',
  )
}


/**
 * Runs the `setup` subcommand.
 *
 * Failures are reported as `SETUP_FAILED: <message>` with exit 1, which
 * startup.md documents as the signal to read the message and retry once
 * before digging — the step-specific exits (`NEEDS_CONFIG_DECISION`,
 * `NEEDS_INVITE_CODE`) leave from inside {@link setup} with their own codes.
 *
 * @param argv Arguments after the subcommand name, as the dispatcher supplies them.
 */
export async function main(argv: string[]): Promise<void> {
  // Checked before anything else: setup's first act is to read and migrate the
  // state file, so a --help that fell through would bootstrap the account it
  // was only asked to describe.
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE)
    return
  }
  try {
    await setup(argv)
  } catch (error) {
    console.error('\nSETUP_FAILED:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
