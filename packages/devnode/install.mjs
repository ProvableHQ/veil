#!/usr/bin/env node
/**
 * Install aleo-devnode from the latest GitHub release.
 *
 * Usage:
 *   node install.mjs                            # installs to ~/.local/bin (mac/linux) or %LOCALAPPDATA%\Programs\aleo-devnode (windows)
 *   VERSION=v0.1.1 node install.mjs             # pin a specific release
 *   INSTALL_DIR=/usr/local/bin node install.mjs # custom install directory
 *
 * Requires Node 18+.
 */

import { createWriteStream, mkdirSync, chmodSync, readdirSync, lstatSync, copyFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { platform, arch, homedir, tmpdir } from 'node:os'
import { pipeline } from 'node:stream/promises'
import { execFileSync } from 'node:child_process'

// ── Node version guard ─────────────────────────────────────────────────────────

const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 18) {
  console.error(`error: Node 18+ required (current: ${process.versions.node})`)
  process.exit(1)
}

const REPO = 'ProvableHQ/aleo-devnode'
const IS_WINDOWS = platform() === 'win32'
const BINARY_NAME = IS_WINDOWS ? 'aleo-devnode.exe' : 'aleo-devnode'

// ── Resolve version ────────────────────────────────────────────────────────────

let tag = process.env.VERSION
if (!tag) {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/releases/latest`,
    { headers: { Accept: 'application/vnd.github+json' } },
  )
  if (!res.ok) {
    console.error(`error: could not fetch latest release (${res.status} ${res.statusText})`)
    process.exit(1)
  }
  tag = (await res.json()).tag_name
}

if (!tag) {
  console.error('error: could not determine latest release version')
  process.exit(1)
}
console.log(`Installing aleo-devnode ${tag}...`)

// ── Detect platform ────────────────────────────────────────────────────────────

// NOTE: Linux ARM64 (aarch64-unknown-linux-gnu) is not yet published upstream.
const PLATFORMS = {
  darwin: { arm64: 'aarch64-apple-darwin', x64: 'x86_64-apple-darwin' },
  linux:  { x64:   'x86_64-unknown-linux-gnu' },
  win32:  { x64:   'x86_64-pc-windows-msvc' },
}

const osPlatforms = PLATFORMS[platform()]
if (!osPlatforms) {
  console.error(`error: unsupported OS: ${platform()}`)
  process.exit(1)
}
const platformStr = osPlatforms[arch()]
if (!platformStr) {
  console.error(`error: unsupported architecture: ${arch()} on ${platform()}`)
  process.exit(1)
}

// ── Resolve install directory ──────────────────────────────────────────────────

const defaultInstallDir = IS_WINDOWS
  ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Programs', 'aleo-devnode')
  : join(homedir(), '.local', 'bin')

const installDir = resolve(
  (process.env.INSTALL_DIR ?? defaultInstallDir).replace(/^~(?=\/|$)/, homedir()),
)

// ── Download ───────────────────────────────────────────────────────────────────

const archive = `aleo-devnode-${tag}-${platformStr}.zip`
const url = `https://github.com/${REPO}/releases/download/${tag}/${archive}`
const tmpDir = join(tmpdir(), `aleo-devnode-install-${Date.now()}`)
const archivePath = join(tmpDir, archive)

// NOTE: no SHA256 verification — the aleo-devnode releases do not publish
// checksum files. Add verification here once checksums are available upstream.

mkdirSync(tmpDir, { recursive: true })

try {
  console.log(`Downloading ${url}...`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`)
  await pipeline(res.body, createWriteStream(archivePath))

  // ── Extract ──────────────────────────────────────────────────────────────────

  const extractDir = join(tmpDir, 'extracted')
  mkdirSync(extractDir, { recursive: true })

  if (IS_WINDOWS) {
    execFileSync('powershell.exe', [
      '-NoProfile', '-Command',
      `Expand-Archive -Path "${archivePath}" -DestinationPath "${extractDir}" -Force`,
    ])
  } else {
    // Try unzip first, fall back to python3 -m zipfile (available on most systems).
    let extracted = false
    for (const [cmd, args] of [
      ['unzip',   ['-q', archivePath, '-d', extractDir]],
      ['python3', ['-m', 'zipfile', '-e', archivePath, extractDir]],
    ]) {
      try {
        execFileSync(cmd, args)
        extracted = true
        break
      } catch (err) {
        if (err.code !== 'ENOENT') throw err
      }
    }
    if (!extracted) {
      throw new Error('Could not extract archive — install unzip or python3 and try again')
    }
  }

  // ── Find binary ───────────────────────────────────────────────────────────────

  // Uses lstatSync (not statSync) to avoid following symlinks during traversal.
  function findBinary(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const stat = lstatSync(full)
      if (stat.isDirectory()) {
        const found = findBinary(full)
        if (found) return found
      } else if (stat.isFile() && entry === BINARY_NAME) {
        return full
      }
    }
    return null
  }

  const binary = findBinary(extractDir)
  if (!binary) throw new Error(`Could not find '${BINARY_NAME}' in the downloaded archive`)

  // ── Install ───────────────────────────────────────────────────────────────────

  mkdirSync(installDir, { recursive: true })
  const dest = join(installDir, BINARY_NAME)
  copyFileSync(binary, dest)
  if (!IS_WINDOWS) chmodSync(dest, 0o755)

  console.log(`Installed ${dest} (${tag})`)

  // Warn if the install directory is not on PATH
  const pathDirs = (process.env.PATH ?? '').split(IS_WINDOWS ? ';' : ':')
  const onPath = IS_WINDOWS
    ? pathDirs.some(d => d.toLowerCase() === installDir.toLowerCase())
    : pathDirs.includes(installDir)

  if (!onPath) {
    console.log()
    console.log(`Note: ${installDir} is not in your PATH.`)
    if (IS_WINDOWS) {
      console.log('Add it via System Properties → Environment Variables → Path.')
    } else {
      console.log('Add the following to your shell profile:')
      console.log(`  export PATH="${installDir}:$PATH"`)
    }
  }
} finally {
  rmSync(tmpDir, { recursive: true, force: true })
}
