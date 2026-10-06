/** Redeems referral codes or requests a shareable code for the saved account. */
import { loadSession, saveState } from '../session.js'
import { confirmed, done, fail, flags, output, run, step } from '../shared.js'

const USAGE = `shield-swap redeem — redeem a referral code or generate a shareable code

  --code <code>                 referral code to redeem (or --generate)
  --generate                    get or create the account's shareable referral code
  --network <testnet|mainnet>   default testnet
  --execute                     redeem or generate; otherwise preview only
  --json                        machine-readable output

Requires an account saved by shield-swap setup. Authenticates with the DEX API,
then redeems or generates only with --execute. No funds are spent or requested.
--generate and --code cannot be combined. Generation returns the existing
personal code when one is already issued; it does not redeem a code.

Examples:
  shield-swap redeem --code REF123 --execute
  shield-swap redeem --generate --execute`

/**
 * Runs referral-code redemption or generation for the saved account.
 *
 * Authenticates with the DEX API and previews the requested action. With
 * `--execute`, redeems and saves access, or gets/creates a shareable code.
 *
 * @param argv Arguments after the subcommand name; requires `--code` or
 *   `--generate` and defaults to a preview unless `--execute` is present.
 * @returns Resolves after printing the plan, referral result, or API error.
 * @throws When argument parsing or validation exits the process; API and state
 *   errors are printed and set exit code 1.
 * @example
 * await main(['--code', 'REF123', '--execute'])
 */
export async function main(argv: string[]): Promise<void> {
  const args = flags({ code: { type: 'string' }, generate: { type: 'boolean' } }, USAGE, argv)
  if (args.generate && args.code !== undefined) fail('--generate and --code cannot be combined.')
  // Reject empty codes before authentication and preserve the code's casing.
  const code = ((args.code as string | undefined) ?? '').trim()
  if (!args.generate && !code) fail(`--code requires a non-empty referral code, or use --generate.\n\n${USAGE}`)

  await run(async () => {
    const { client, account, state, network } = await loadSession({ network: args.network })
    done(`session on ${network} for ${account.address}`)

    // The personal-code GET can create a code, so it needs the same execution
    // guard as redemption. It does not change the account's access grant.
    if (args.generate) {
      if (!confirmed({
        execute: args.execute,
        network,
        plan: [['account', account.address], ['action', 'get or create a shareable referral code']],
      })) {
        output({ network, address: account.address, submitted: false, action: 'generate' }, () => {})
        return
      }
      step('requesting the account\'s shareable referral code')
      const result = await client.api.getMyReferralCode()
      if (!result.code) throw new Error('No shareable referral code is available for this account; code issuance may be disabled.')
      output(
        { network, address: account.address, submitted: true, action: 'generate', code: result.code },
        (data) => done(`shareable referral code: ${data.code}`),
      )
      return
    }

    if (!confirmed({
      execute: args.execute,
      network,
      plan: [['account', account.address], ['referral code', code]],
    })) {
      output({ network, address: account.address, submitted: false, code }, () => {})
      return
    }

    step('redeeming the referral code')
    const result = await client.api.redeemReferralCode(code)
    // Persist only after the server accepts the code, retaining the saved key
    // and all other session credentials.
    state.accessRedeemed = true
    saveState(state)

    output(
      { network, address: account.address, submitted: true, code: result.code, status: result.status },
      (data) => done(`referral code ${data.code}: ${data.status}`),
    )
  })
}
