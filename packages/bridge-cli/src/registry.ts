/** Describes one bridge CLI subcommand. */
export type Command = {
  summary: string
  load: () => Promise<{ main: (argv: string[]) => Promise<void> }>
}

/** Lists every bridge CLI subcommand in display order. */
export const COMMANDS: Record<string, Command> = {
  routes: {
    summary: 'List the reviewed bridge journeys exposed by this command.',
    load: () => import('./commands/routes.js'),
  },
  transfer: {
    summary: 'Preview or execute one reviewed bridge journey.',
    load: () => import('./commands/transfer.js'),
  },
}

/** Builds the top-level bridge CLI help. */
export function usage(): string {
  const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length))
  const commands = Object.entries(COMMANDS)
    .map(([name, command]) => `  ${name.padEnd(width)}  ${command.summary}`)
    .join('\n')
  return `aleo-bridge — move assets across reviewed Aleo bridge routes

Usage: aleo-bridge <command> [options]

${commands}

Transfers preview by default and submit only with --execute.
Run \`aleo-bridge <command> --help\` for command-specific flags.`
}
