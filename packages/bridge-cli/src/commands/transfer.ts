import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { runAleoHyperlaneExample } from '../../../../examples/bridge/aleo-hyperlane.js'
import { runArcToAleoExample } from '../../../../examples/bridge/arc-to-aleo.js'
import { runEthereumHyperlaneExample } from '../../../../examples/bridge/ethereum-hyperlane.js'
import { runSolanaHyperlaneExample } from '../../../../examples/bridge/sol-to-aleo.js'
import { runUsdcToUsdcxExample } from '../../../../examples/bridge/usdc-to-usdcx.js'
import { runUsdcxToUsdcExample } from '../../../../examples/bridge/usdcx-to-usdc.js'
import { CLI_ROUTES } from '../routes.js'

const EXECUTION_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_MOVES_REAL_FUNDS'
const PRIVATE_MINT_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_SUBMITS_AN_ALEO_PRIVATE_MINT'
const BURN_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_BURNS_USDCX'

const EXECUTION_ENVIRONMENT_VARIABLES = [
  'EXECUTE_XRESERVE_DEPOSIT',
  'EXECUTE_XRESERVE_PRIVATE_MINT',
  'EXECUTE_XRESERVE_BURN',
  'EXECUTE_HYPERLANE_ETH',
  'EXECUTE_HYPERLANE_WBTC',
  'EXECUTE_HYPERLANE_SOL',
  'EXECUTE_HYPERLANE_ETH_RETURN',
  'EXECUTE_HYPERLANE_WBTC_RETURN',
  'EXECUTE_HYPERLANE_SOL_RETURN',
] as const

const USAGE = `aleo-bridge transfer — preview or execute a demonstrated bridge journey

  --route <name|id>                 route from aleo-bridge routes       (required)
  --amount <decimal>                source amount in human units        (required)
  --recipient <address>             destination-chain address           (required)
  --rpc-url <url>                   source-chain RPC URL
  --private-key-file <path>         source signer key; never pass a raw key
  --sender <address>                Solana read-only sender without a key
  --aleo-private-key-file <path>    Aleo destination signer for private mint
  --mint-mode <public|record|private> xReserve Aleo delivery; default public
  --burn-mode <public|private>       Aleo USDCx withdrawal; default private
  --secret-nonce-file <path>        private-mint nonce file
  --consumer-id <id>                existing Provable API consumer
  --api-key-file <path>             Provable API key file
  --proving-mode <delegated|local>  Aleo proving mode; default delegated
  --resume-message-hash <hash>      resume an xReserve private mint
  --execute                         submit transactions; otherwise preview
  --verbose                         print protocol and transaction diagnostics
  -h, --help                        show this text

Private keys and API keys MUST come from files or the caller's environment.`

type Values = Record<string, string | boolean | undefined>

function readSecret(path: string | undefined, label: string): string | undefined {
  if (!path) return undefined
  const value = readFileSync(path, 'utf8').trim()
  if (!value) throw new Error(`${label} file ${path} is empty`)
  return value
}

function assign(name: string, value: string | undefined): void {
  if (value !== undefined) process.env[name] = value
}

function required(values: Values, name: string): string {
  const value = values[name]
  if (typeof value !== 'string' || !value) throw new Error(`--${name} is required`)
  return value
}

function configureAleo(values: Values, key: string | undefined): void {
  assign('ALEO_PRIVATE_KEY', key)
  assign('ALEO_CONSUMER_ID', values['consumer-id'] as string | undefined)
  assign('ALEO_DPS_API_KEY', readSecret(values['api-key-file'] as string | undefined, 'Provable API key'))
  assign('ALEO_PROVING_MODE', values['proving-mode'] as string | undefined)
}

/** Runs the `transfer` subcommand. */
export async function main(argv: string[]): Promise<void> {
  let values: Values
  try {
    ;({ values } = parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        route: { type: 'string' },
        amount: { type: 'string' },
        recipient: { type: 'string' },
        'rpc-url': { type: 'string' },
        'private-key-file': { type: 'string' },
        sender: { type: 'string' },
        'aleo-private-key-file': { type: 'string' },
        'mint-mode': { type: 'string' },
        'burn-mode': { type: 'string' },
        'secret-nonce-file': { type: 'string' },
        'consumer-id': { type: 'string' },
        'api-key-file': { type: 'string' },
        'proving-mode': { type: 'string' },
        'resume-message-hash': { type: 'string' },
        execute: { type: 'boolean' },
        verbose: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    }))
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${USAGE}`)
    process.exit(64)
  }
  if (values.help) {
    console.log(USAGE)
    return
  }

  const requested = required(values, 'route')
  const route = CLI_ROUTES.find((candidate) => candidate.name === requested || candidate.routeId === requested)
  if (!route) throw new Error(`Unknown route ${requested}; run \`aleo-bridge routes\`.`)
  const recipient = required(values, 'recipient')
  const resumeMessageHash = values['resume-message-hash'] as string | undefined
  const amount = values.amount as string | undefined
  if (!amount && !resumeMessageHash) throw new Error('--amount is required')
  if (resumeMessageHash && route.name !== 'arc-to-aleo' && route.name !== 'usdc-to-usdcx') {
    throw new Error('--resume-message-hash applies only to an inbound xReserve route')
  }
  const transferAmount = (): string => {
    if (!amount) throw new Error('--amount is required unless resuming a private mint')
    return amount
  }
  const sourceKey = readSecret(values['private-key-file'] as string | undefined, 'private key')
  const aleoKey = readSecret(values['aleo-private-key-file'] as string | undefined, 'Aleo private key')
  const execute = values.execute === true

  // The example runners use acknowledgement environment variables. Clear any
  // inherited values so only this invocation's --execute flag can submit.
  for (const name of EXECUTION_ENVIRONMENT_VARIABLES) delete process.env[name]

  assign('USDCX_MINT_MODE', (values['mint-mode'] as string | undefined) ?? 'public')
  assign('USDCX_BURN_MODE', values['burn-mode'] as string | undefined)
  assign('USDCX_SECRET_NONCE', readSecret(values['secret-nonce-file'] as string | undefined, 'private-mint nonce'))
  assign('XRESERVE_RESUME_MESSAGE_HASH', resumeMessageHash)

  switch (route.name) {
    case 'arc-to-aleo':
      assign('ARC_RPC_URL', values['rpc-url'] as string | undefined)
      assign('EVM_PRIVATE_KEY', sourceKey)
      assign('ALEO_RECIPIENT', recipient)
      assign('USDC_AMOUNT', amount)
      configureAleo(values, aleoKey)
      if (execute) {
        process.env.EXECUTE_XRESERVE_DEPOSIT = EXECUTION_ACKNOWLEDGEMENT
        process.env.EXECUTE_XRESERVE_PRIVATE_MINT = PRIVATE_MINT_ACKNOWLEDGEMENT
      }
      await runArcToAleoExample()
      return
    case 'usdc-to-usdcx':
      assign('ETHEREUM_RPC_URL', values['rpc-url'] as string | undefined)
      assign('EVM_PRIVATE_KEY', sourceKey)
      assign('ALEO_RECIPIENT', recipient)
      assign('USDC_AMOUNT', amount)
      configureAleo(values, aleoKey)
      if (execute) {
        process.env.EXECUTE_XRESERVE_DEPOSIT = EXECUTION_ACKNOWLEDGEMENT
        process.env.EXECUTE_XRESERVE_PRIVATE_MINT = PRIVATE_MINT_ACKNOWLEDGEMENT
      }
      await runUsdcToUsdcxExample()
      return
    case 'usdcx-to-usdc':
      assign('USDCX_AMOUNT', transferAmount())
      assign('ETHEREUM_RECIPIENT', recipient)
      configureAleo(values, sourceKey)
      if (execute) process.env.EXECUTE_XRESERVE_BURN = BURN_ACKNOWLEDGEMENT
      await runUsdcxToUsdcExample()
      return
    case 'eth-to-aleo':
    case 'wbtc-to-aleo': {
      const asset = route.name === 'eth-to-aleo' ? 'ETH' : 'WBTC'
      assign('ETHEREUM_RPC_URL', values['rpc-url'] as string | undefined)
      assign('EVM_PRIVATE_KEY', sourceKey)
      assign('ALEO_RECIPIENT', recipient)
      assign(`${asset}_AMOUNT`, transferAmount())
      if (execute) process.env[`EXECUTE_HYPERLANE_${asset}`] = EXECUTION_ACKNOWLEDGEMENT
      await runEthereumHyperlaneExample(asset)
      return
    }
    case 'eth-to-ethereum':
    case 'wbtc-to-ethereum':
    case 'sol-to-solana': {
      const asset = route.name === 'eth-to-ethereum' ? 'ETH' : route.name === 'wbtc-to-ethereum' ? 'WBTC' : 'SOL'
      assign(`${asset}_AMOUNT`, transferAmount())
      assign(asset === 'SOL' ? 'SOLANA_RECIPIENT' : 'ETHEREUM_RECIPIENT', recipient)
      assign('ALEO_RPC_URL', values['rpc-url'] as string | undefined)
      configureAleo(values, sourceKey)
      if (execute) process.env[`EXECUTE_HYPERLANE_${asset}_RETURN`] = EXECUTION_ACKNOWLEDGEMENT
      await runAleoHyperlaneExample(asset)
      return
    }
    case 'sol-to-aleo':
      assign('SOLANA_RPC_URL', values['rpc-url'] as string | undefined)
      assign('SOLANA_PRIVATE_KEY', sourceKey)
      assign('SOLANA_SENDER', values.sender as string | undefined)
      assign('ALEO_RECIPIENT', recipient)
      assign('SOL_AMOUNT', transferAmount())
      if (execute) process.env.EXECUTE_HYPERLANE_SOL = EXECUTION_ACKNOWLEDGEMENT
      await runSolanaHyperlaneExample()
  }
}
