import { parseArgs } from 'node:util'
import { CLI_ROUTES } from '../routes.js'

const USAGE = `aleo-bridge routes — list demonstrated bridge journeys

  --json     print one machine-readable array
  -h, --help show this text`

/** Runs the `routes` subcommand. */
export async function main(argv: string[]): Promise<void> {
  let values: { help?: boolean, json?: boolean }
  try {
    ;({ values } = parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
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
  if (values.json) {
    console.log(JSON.stringify(CLI_ROUTES, null, 2))
    return
  }
  console.log('NAME               FROM       TO         ASSET           PROTOCOL')
  for (const route of CLI_ROUTES) {
    console.log(`${route.name.padEnd(18)} ${route.from.padEnd(10)} ${route.to.padEnd(10)} ${route.asset.padEnd(15)} ${route.protocol}`)
  }
}
