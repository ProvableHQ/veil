import { maintenanceFlags, readCliPackage } from '../maintenance.js'
import { output, run } from '../shared.js'

const USAGE = `Usage: shield-swap version [--json] [--no-color]

Print the installed CLI version without contacting a network or loading an account.
Aliases: shield-swap --version, shield-swap -v

  --json       print the package name and version as one JSON object
  --no-color   disable terminal colors
  -h, --help   show this help`

/**
 * Prints the installed CLI version without loading a trading session.
 *
 * @param argv Command flags; --json includes the package name.
 * @returns Resolves after printing the version or reporting a manifest error.
 * @example
 * await main(['--json'])
 */
export async function main(argv: string[]): Promise<void> {
  maintenanceFlags(argv, USAGE)
  await run(async () => {
    const { name, version } = readCliPackage()
    output({ package: name, version }, result => console.log(result.version))
  })
}
