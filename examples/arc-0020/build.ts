import { createLeoClient } from '@veil/leo'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const programs = [
  'token_registry',
  'wrapped_credits',
  'wrapped_token_registry',
  'dummy_exchange',
]

async function main() {
  for (const name of programs) {
    const cwd = join(__dirname, name)
    const leo = createLeoClient({ cwd, leoPath: 'leo_view', disableUpdateCheck: true })
    console.log(`Building ${name}...`)
    await leo.build()
    console.log(`  ✓ ${name}`)
  }
  console.log('All programs built.')
}

main().catch((err) => { console.error(err); process.exit(1) })
