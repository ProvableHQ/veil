/**
 * Regenerate all committed generated TypeScript files from their source ABIs.
 * Run: npx tsx scripts/regen-all.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAbi } from '../packages/core/src/index.js'
import { generate } from '../packages/codegen/src/generate.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const targets = [
  // packages/codegen sample output
  {
    abi: 'packages/codegen/test/fixtures/loyalty_token_abi.json',
    out: 'packages/codegen/loyalty_token.ts',
  },
  // loyalty-node generated bindings
  {
    abi: 'apps/loyalty-node/loyalty_token/build/abi.json',
    out: 'apps/loyalty-node/src/generated/loyalty_token.ts',
  },
  {
    abi: 'apps/loyalty-node/loyalty_rewards/build/abi.json',
    out: 'apps/loyalty-node/src/generated/loyalty_rewards.ts',
  },
  // arc-0020 generated bindings
  ...['token_registry', 'wrapped_credits', 'wrapped_token_registry', 'dummy_exchange'].map((name) => ({
    abi: `examples/arc-0020/${name}/build/abi.json`,
    out: `examples/arc-0020/generated/${name}.ts`,
  })),
]

async function main() {
  for (const { abi: abiPath, out: outPath } of targets) {
    const raw = JSON.parse(readFileSync(join(root, abiPath), 'utf-8'))
    const abi = parseAbi(raw)
    const source = generate({ abi, coreImport: '@provablehq/veil-core' })
    writeFileSync(join(root, outPath), source, 'utf-8')
    console.log(`Generated ${outPath}`)
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
