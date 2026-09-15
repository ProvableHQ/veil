#!/usr/bin/env node
/** Routes the `aleo-bridge` command to one lazily loaded subcommand. */

import { COMMANDS, usage } from './registry.js'

const [name, ...argv] = process.argv.slice(2)

if (!name || name === '--help' || name === '-h' || name === 'help') {
  console.log(usage())
  process.exit(0)
}

const command = COMMANDS[name]
if (!command) {
  console.error(`Unknown command \`${name}\`.\n\n${usage()}`)
  process.exit(64)
}

const { main } = await command.load()
try {
  await main(argv)
} catch (error) {
  console.error(`\n✗ ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
}
