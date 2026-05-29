#!/usr/bin/env node

// CLI entry point for @veil/codegen.
//
// Usage:
//   veil-codegen --abi loyalty_token/build/abi.json --out src/generated/loyalty_token.ts
//   veil-codegen --config veil.config.json

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { parseAbi } from '@veil/core'
import { generate } from './generate.js'

interface ProgramConfig {
  abi: string
  out: string
}

interface Config {
  programs: ProgramConfig[]
  coreImport?: string
}

function main() {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log(`
Usage:
  veil-codegen --abi <path> --out <path>     Generate from a single ABI
  veil-codegen --config <path>               Generate from a config file

Options:
  --abi <path>       Path to abi.json file
  --out <path>       Output .ts file path
  --config <path>    Path to config JSON (default: veil.config.json)
  --core-import      Import path for @veil/core (default: '@veil/core')
  --help, -h         Show this help

Config file format (veil.config.json):
  {
    "programs": [
      { "abi": "./loyalty_token/build/abi.json", "out": "./src/generated/loyalty_token.ts" }
    ],
    "coreImport": "@veil/core"
  }
`)
    process.exit(0)
  }

  const configIndex = args.indexOf('--config')
  const abiIndex = args.indexOf('--abi')
  const outIndex = args.indexOf('--out')
  const coreImportIndex = args.indexOf('--core-import')

  const coreImport = coreImportIndex !== -1 ? args[coreImportIndex + 1] : undefined

  if (configIndex !== -1) {
    // Config mode
    const configPath = resolve(args[configIndex + 1] ?? 'veil.config.json')
    const config: Config = JSON.parse(readFileSync(configPath, 'utf-8'))
    const resolvedCoreImport = coreImport ?? config.coreImport

    for (const program of config.programs) {
      const abiPath = resolve(dirname(configPath), program.abi)
      const outPath = resolve(dirname(configPath), program.out)
      generateOne(abiPath, outPath, resolvedCoreImport)
    }
  } else if (abiIndex !== -1 && outIndex !== -1) {
    // Single file mode
    const abiPath = resolve(args[abiIndex + 1]!)
    const outPath = resolve(args[outIndex + 1]!)
    generateOne(abiPath, outPath, coreImport)
  } else {
    console.error('Error: provide either --abi + --out or --config')
    process.exit(1)
  }
}

function generateOne(abiPath: string, outPath: string, coreImport?: string) {
  const raw = JSON.parse(readFileSync(abiPath, 'utf-8'))
  const abi = parseAbi(raw)

  const source = generate({ abi, coreImport })

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, source, 'utf-8')

  console.log(`Generated ${outPath} from ${abi.program}`)
}

main()
