import { execFile } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const exec = promisify(execFile)
const tsx = createRequire(import.meta.url).resolve('tsx/cli')
const source = fileURLToPath(new URL('../src', import.meta.url))
const packageName = '@provablehq/shield-swap-cli'
let directory: string
let packageDirectory: string
let env: NodeJS.ProcessEnv

// Run real CLI dispatch and filesystem checks, replacing only the external npm
// process so tests cannot contact a registry or change the developer's install.
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'shield-maintenance-'))
  const root = join(directory, 'global', 'node_modules')
  packageDirectory = join(root, packageName)
  cpSync(source, join(packageDirectory, 'src'), { recursive: true })
  writeFileSync(join(packageDirectory, 'package.json'), JSON.stringify({ name: packageName, version: '1.2.3', type: 'module' }))
  const bin = join(directory, 'bin')
  mkdirSync(bin)
  const npm = join(bin, 'npm.cjs')
  writeFileSync(npm, `
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.NPM_TEST_LOG, JSON.stringify(args) + '\\n');
if (process.env.NPM_TEST_FAIL === args[0]) {
  console.error('npm test failure'); process.exit(1);
}
if (args[0] === 'root') console.log(process.env.NPM_TEST_ROOT);
else if (args[0] === 'view') console.log(JSON.stringify(process.env.NPM_TEST_VERSION));
else if (args[0] === 'install') {
  if (!process.env.NPM_TEST_NO_WRITE) {
    const path = process.env.NPM_TEST_PACKAGE;
    const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
    pkg.version = process.env.NPM_TEST_VERSION;
    fs.writeFileSync(path, JSON.stringify(pkg));
  }
  console.log('npm install progress');
} else process.exit(9);
`)
  if (process.platform === 'win32') {
    writeFileSync(join(bin, 'npm.cmd'), `@"${process.execPath}" "${npm}" %*\r\n`)
  } else {
    writeFileSync(join(bin, 'npm'), `#!${process.execPath}\nrequire('./npm.cjs')\n`, { mode: 0o755 })
  }
  env = {
    PATH: [bin, dirname(process.execPath)].join(process.platform === 'win32' ? ';' : ':'),
    HOME: directory, USERPROFILE: directory, NO_COLOR: '1',
    // Windows needs its system directory to launch .cmd files.
    SystemRoot: process.env.SystemRoot,
    NPM_TEST_ROOT: root, NPM_TEST_LOG: join(directory, 'npm.log'),
    NPM_TEST_PACKAGE: join(packageDirectory, 'package.json'), NPM_TEST_VERSION: '1.3.0',
  }
})

afterEach(() => rmSync(directory, { recursive: true, force: true }))

async function cli(...args: string[]) {
  return exec(process.execPath, [tsx, join(packageDirectory, 'src/index.ts'), ...args], { env, cwd: directory })
    .then(result => ({ code: 0, ...result }), error => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }))
}

function npmCalls(): string[][] {
  const log = env.NPM_TEST_LOG!
  return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : []
}

describe('CLI version', () => {
  it.each(['version', '--version', '-v'])('reports the installed package version offline with %s', async (command) => {
    const result = await cli(command)
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe('1.2.3')
    expect(result.stderr).toBe('')
    expect(npmCalls()).toEqual([])
  })

  it('returns package identity and version as JSON', async () => {
    const result = await cli('version', '--json')
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ package: packageName, version: '1.2.3' })
  })
})

describe('CLI update', () => {
  it('checks the latest version without installing', async () => {
    const result = await cli('update', '--check', '--json')
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ currentVersion: '1.2.3', latestVersion: '1.3.0', updateAvailable: true, updated: false })
    expect(npmCalls().map(call => call[0])).toEqual(['view'])
  })

  it('updates only the current global package and keeps stdout valid JSON', async () => {
    const result = await cli('update', '--json')
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ currentVersion: '1.2.3', latestVersion: '1.3.0', updated: true })
    expect(npmCalls().find(call => call[0] === 'install')).toEqual(['install', '--global', `${packageName}@1.3.0`])
    expect(JSON.parse(readFileSync(env.NPM_TEST_PACKAGE!, 'utf8')).version).toBe('1.3.0')
  })

  it.each(['1.2.3', '1.2.2'])('does not install an equal or older release (%s)', async (latest) => {
    env.NPM_TEST_VERSION = latest
    const result = await cli('update', '--json')
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ updateAvailable: false, updated: false })
    expect(npmCalls().some(call => call[0] === 'install')).toBe(false)
  })

  it('upgrades a prerelease to the stable release of the same version', async () => {
    const path = env.NPM_TEST_PACKAGE!
    const pkg = JSON.parse(readFileSync(path, 'utf8'))
    writeFileSync(path, JSON.stringify({ ...pkg, version: '1.3.0-rc.1' }))
    const result = await cli('update', '--check', '--json')
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout).updateAvailable).toBe(true)
  })

  it.each([true, false])('guides project installs when the npm global directory exists: %s', async (exists) => {
    env.NPM_TEST_ROOT = join(directory, 'another-global')
    if (exists) mkdirSync(env.NPM_TEST_ROOT)
    const result = await cli('update', '--json')
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout).error.message).toMatch(/project|package manager/i)
    expect(npmCalls().some(call => call[0] === 'install')).toBe(false)
  })

  it('refuses to replace an npm-linked source checkout', async () => {
    const root = join(directory, 'linked-global')
    mkdirSync(join(root, '@provablehq'), { recursive: true })
    symlinkSync(packageDirectory, join(root, packageName), process.platform === 'win32' ? 'junction' : 'dir')
    env.NPM_TEST_ROOT = root
    const result = await cli('update', '--json')
    expect(result.code).toBe(1)
    expect(npmCalls().some(call => call[0] === 'install')).toBe(false)
  })

  it.each(['view', 'install'])('reports npm %s failures with a nonzero exit and JSON error', async (operation) => {
    env.NPM_TEST_FAIL = operation
    const result = await cli('update', '--json')
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout).error.message).toMatch(/npm/i)
  })

  it('does not report success when npm leaves the running installation unchanged', async () => {
    env.NPM_TEST_NO_WRITE = '1'
    const result = await cli('update', '--json')
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout).error.message).toMatch(/version|install/i)
  })

  it('rejects malformed registry versions before running an install', async () => {
    env.NPM_TEST_VERSION = '1.3.0; echo unexpected'
    const result = await cli('update', '--json')
    expect(result.code).toBe(1)
    expect(npmCalls().some(call => call[0] === 'install')).toBe(false)
  })

  it.each(['version', 'update'])('%s help works without invoking npm', async (command) => {
    const result = await cli(command, '--help')
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(`shield-swap ${command}`)
    expect(npmCalls()).toEqual([])
  })

  it.each(['version', 'update'])('%s rejects trading flags before invoking npm', async (command) => {
    const result = await cli(command, '--network', 'mainnet', '--json')
    expect(result.code).toBe(64)
    expect(JSON.parse(result.stdout).error).toBeDefined()
    expect(npmCalls()).toEqual([])
  })
})
