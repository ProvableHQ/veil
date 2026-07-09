import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAbi } from '../../packages/core/src/index.js'
import { generate } from '../../packages/codegen/src/generate.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, 'generated')

const programs = [
  'token_registry',
  'wrapped_credits',
  'wrapped_token_registry',
  'dummy_exchange',
]

async function main() {
  mkdirSync(outDir, { recursive: true })

  for (const name of programs) {
    const abiPath = join(__dirname, name, 'build', 'abi.json')
    const outPath = join(outDir, `${name}.ts`)

    const raw = JSON.parse(readFileSync(abiPath, 'utf-8'))
    const abi = parseAbi(raw)
    const source = generate({ abi, coreImport: '@provablehq/veil-core' })

    writeFileSync(outPath, source, 'utf-8')
    console.log(`Generated ${outPath}`)
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
