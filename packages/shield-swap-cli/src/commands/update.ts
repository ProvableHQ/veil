import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { cliDirectory, maintenanceFlags, readCliPackage } from '../maintenance.js'
import { output, run, step } from '../shared.js'

const exec = promisify(execFile)
const PACKAGE = '@provablehq/shield-swap-cli'
const MANUAL = `For a project install, update ${PACKAGE} with the project's package manager (npm install --save-dev ${PACKAGE}@latest, pnpm add -D ${PACKAGE}@latest, or yarn add -D ${PACKAGE}@latest). For a source checkout, update the checkout and rebuild. For other global installs, use the package manager that installed the CLI.`
const USAGE = `Usage: shield-swap update [--check] [--json] [--no-color]

Install the latest stable release for the running global npm installation.
Uses npm's configured registry. Requires npm on PATH; needs no account or setup.
Project installs, source checkouts, and other package managers require a manual update.

  --check      check for a release without installing; works for any install
  --json       print one JSON result, suppressing npm progress
  --no-color   disable terminal colors
  -h, --help   show this help`

/** Runs npm with bounded waits and captures progress to preserve JSON output. */
async function npm(args: string[]): Promise<string> {
  try {
    const { stdout } = await exec(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
      // Windows command shims require a shell. All arguments are fixed strings
      // except the release version, which is restricted to digits and dots.
      shell: process.platform === 'win32',
      timeout: args[0] === 'install' ? 300_000 : 30_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    })
    return stdout.trim()
  } catch (error) {
    const err = error as Error & { code?: string; stderr?: string }
    if (err.code === 'ENOENT') throw new Error('npm was not found on PATH. Install npm or update the CLI with its package manager.')
    throw new Error(`npm ${args[0]} failed: ${err.stderr?.trim() || err.message}`)
  }
}

/** Compares a stable release to an installed stable or prerelease version. */
function isNewer(latest: string, current: string): boolean {
  const installed = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(current)
  if (!installed) throw new Error(`Cannot compare installed version ${current}. Update the CLI manually.`)
  const release = latest.split('.')
  for (let i = 0; i < 3; i++) {
    const difference = BigInt(release[i]!) - BigInt(installed[i + 1]!)
    if (difference !== 0n) return difference > 0n
  }
  return Boolean(installed[4])
}

/**
 * Checks for a stable CLI release and updates the active global npm install.
 *
 * Contacts npm's configured registry. Without --check, installs the newer
 * release only when npm's global directory contains the running package.
 * @param argv Command flags; --check skips installation and --json emits one object.
 * @returns Resolves after reporting the check, installation, or failure.
 * @example
 * await main(['--check', '--json'])
 */
export async function main(argv: string[]): Promise<void> {
  const options = maintenanceFlags(argv, USAGE, true)
  await run(async () => {
    const { version: currentVersion } = readCliPackage()
    if (!options.check) {
      const root = await npm(['root', '--global'])
      let globalRoot: string | undefined
      try {
        globalRoot = realpathSync(root)
      } catch (error) {
        // npm can report a directory that does not exist until the first
        // global install. Treat that as a different installation, too.
        if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      }
      // Resolve the root, but not the package symlink: npm link must never
      // replace a source checkout or a package installed by another manager.
      if (!globalRoot || cliDirectory !== join(globalRoot, PACKAGE)) {
        throw new Error(`This CLI is not the active global npm installation. ${MANUAL}`)
      }
    }

    step('Checking the latest Shield Swap CLI release…')
    const latestVersion: unknown = JSON.parse(await npm(['view', `${PACKAGE}@latest`, 'version', '--json', '--global']))
    if (typeof latestVersion !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(latestVersion)) {
      throw new Error('npm did not return a stable release version. Update the CLI manually.')
    }
    const updateAvailable = isNewer(latestVersion, currentVersion)
    let updated = false
    if (updateAvailable && !options.check) {
      step(`Updating Shield Swap CLI from ${currentVersion} to ${latestVersion}…`)
      // Pin the version just checked so a concurrent dist-tag change cannot
      // install a different release from the one reported to the caller.
      await npm(['install', '--global', `${PACKAGE}@${latestVersion}`])
      if (readCliPackage().version !== latestVersion) {
        throw new Error('npm finished, but the running installation has a different version. Check the installation path and update manually.')
      }
      updated = true
    }
    output({ package: PACKAGE, currentVersion, latestVersion, updateAvailable, updated }, result => {
      if (result.updated) console.log(`Updated shield-swap from ${currentVersion} to ${latestVersion}.`)
      else if (result.updateAvailable) console.log(`Update available: ${currentVersion} → ${latestVersion}. Run shield-swap update for a global npm install, or use the original package manager.`)
      else console.log(`shield-swap ${currentVersion} is up to date (latest stable release: ${latestVersion}).`)
    })
  })
}
