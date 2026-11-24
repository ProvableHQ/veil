import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { help } from './color.js'
import { reportUsage, setJsonMode } from './shared.js'

// Source modules and bundled chunks both sit one directory below package.json.
const manifest = new URL('../package.json', import.meta.url)

/** Identifies the running CLI's package directory, resolving filesystem links. */
export const cliDirectory = realpathSync(fileURLToPath(new URL('..', import.meta.url)))

/**
 * Reads the running CLI's installed package metadata without network access.
 *
 * Reads afresh on each call so an update can verify the installed version.
 * @returns The package name and version from the adjacent package.json.
 * @throws If the package manifest is missing or invalid.
 * @example
 * const { version } = readCliPackage()
 */
export function readCliPackage(): { name: string; version: string } {
  return JSON.parse(readFileSync(manifest, 'utf8'))
}

/**
 * Parses maintenance options without accepting trading or account flags.
 *
 * @param argv Arguments following the command name.
 * @param usage Help text for the command.
 * @param update Whether to accept --check. Defaults to false for version output.
 * @returns Flags controlling JSON output and update checks.
 * @example
 * const options = maintenanceFlags(['--check'], 'shield-swap update', true)
 */
export function maintenanceFlags(argv: string[], usage: string, update = false) {
  let values
  try {
    ;({ values } = parseArgs({ args: argv, allowPositionals: false, options: {
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      'no-color': { type: 'boolean' },
      ...(update ? { check: { type: 'boolean' as const } } : {}),
    } }))
  } catch (error) {
    reportUsage((error as Error).message, usage, argv)
  }
  if (values.help) {
    console.log(help(usage))
    process.exit(0)
  }
  setJsonMode(Boolean(values.json))
  return values
}
