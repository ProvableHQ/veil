import { spawn } from 'node:child_process'

// =============================================================================
// Client-level config (defaults shared across every command)
// =============================================================================

export type LeoClientConfig = {
  /**
   * Default project root (equivalent to `--path`). Commands can still override
   * per-call via their `cwd` option.
   */
  cwd?: string
  /** Path to the leo binary. Defaults to `'leo'` (resolved on PATH). */
  leoPath?: string
  /** Default `--network`. */
  network?: 'mainnet' | 'testnet' | 'canary'
  /** Default `--endpoint` URL. */
  endpoint?: string
  /** Default `--private-key`. */
  privateKey?: string
  /** Default `--devnet` (mark target as a devnet). */
  devnet?: boolean
  /** Default `--home` (path to the Aleo program registry). */
  home?: string
  /** Default `-q`. Suppress leo CLI output. */
  quiet?: boolean
  /** Default `-d`. Print additional debug info. */
  debug?: boolean
  /** Default `--disable-update-check`. */
  disableUpdateCheck?: boolean
  /** Default `--network-retries`. */
  networkRetries?: number
  /** Default `--consensus-heights`. */
  consensusHeights?: string
  /** Default `--offline`. */
  offline?: boolean
}

// =============================================================================
// Shared option mixins
// =============================================================================

/** Compiler-phase options shared by build/deploy/synthesize. */
export type LeoCompilerOptions = {
  enableAstSpans?: boolean
  enableDce?: boolean
  conditionalBlockMaxDepth?: number
  disableConditionalBranchTypeChecking?: boolean
  enableInitialAstSnapshot?: boolean
  enableAllAstSnapshots?: boolean
  astSnapshots?: string[]
  buildTests?: boolean
  noCache?: boolean
  noLocal?: boolean
}

/** Transaction-shape options shared by deploy/synthesize. */
export type LeoTransactionOptions = {
  /** `--priority-fees` (microcredit amounts delimited by `|`). */
  priorityFees?: string
  /** `-f, --fee-records`. */
  feeRecords?: string
  /** `--print` the transaction. */
  print?: boolean
  /** `--broadcast` the transaction to the network. */
  broadcast?: boolean
  /** `--save` the transaction to the given directory. */
  save?: string
  /** `-y, --yes`. Skip confirmation prompts. */
  yes?: boolean
  /** `--consensus-version`. */
  consensusVersion?: string
  /** `--max-wait` seconds when searching for the tx. */
  maxWait?: number
  /** `--blocks-to-check` window when searching for the tx. */
  blocksToCheck?: number
}

// =============================================================================
// Per-command option types
// =============================================================================

export type LeoBuildOptions = LeoCompilerOptions & Partial<LeoClientConfig>

export type LeoAbiOptions = {
  /** Path to the `.aleo` bytecode file (required positional). */
  file: string
  /** Network context for parsing. Defaults server-side to `'testnet'`. */
  network?: 'mainnet' | 'testnet' | 'canary'
  /** `-o, --output`. Write to path instead of returning stdout. */
  output?: string
} & Partial<Omit<LeoClientConfig, 'network'>>

export type LeoDeployOptions = {
  /** `--skip` deployment of any program whose name contains these substrings. */
  skip?: string[]
} & LeoCompilerOptions &
  LeoTransactionOptions &
  Partial<LeoClientConfig>

export type LeoSynthesizeOptions = {
  /** Program name (required positional), e.g. `'helloworld.aleo'`. */
  name: string
  /** `-l, --local`. Use the local Leo project. */
  local?: boolean
  /** `-s, --skip` functions whose names contain these substrings. */
  skip?: string[]
} & LeoCompilerOptions &
  LeoTransactionOptions &
  Partial<LeoClientConfig>

// =============================================================================
// Client
// =============================================================================

export type LeoClient = {
  /** Config the client was constructed with. */
  readonly config: LeoClientConfig
  /** `leo build` — compile the current package. */
  build: (options?: LeoBuildOptions) => Promise<void>
  /** `leo abi` — generate ABI from a `.aleo` bytecode file. Returns the ABI as a string (or empty string if `output` was given). */
  abi: (options: LeoAbiOptions) => Promise<string>
  /** `leo deploy` — deploy the current package. */
  deploy: (options?: LeoDeployOptions) => Promise<void>
  /** `leo synthesize` — synthesize individual proving/verifying keys for a program. */
  synthesize: (options: LeoSynthesizeOptions) => Promise<void>
}

/**
 * Extension helper that attaches a {@link LeoClient} to any veil client under
 * the `.leo` property. Pass to `.extend()`:
 *
 * ```ts
 * const testClient = createTestClient({ transport }).extend(leoActions({ cwd }))
 * await testClient.leo.build()
 * await testClient.advanceBlock()
 * ```
 *
 * The extension ignores the host client — leo operations don't need a transport —
 * so this works equally well on publicClient, walletClient, or testClient.
 */
export function leoActions(config: LeoClientConfig = {}) {
  return (_client: unknown): { leo: LeoClient } => ({
    leo: createLeoClient(config),
  })
}

export function createLeoClient(config: LeoClientConfig = {}): LeoClient {
  const merge = <T extends Partial<LeoClientConfig>>(opts: T): T & LeoClientConfig => ({
    ...config,
    ...opts,
  })

  return {
    config,

    build: async (options = {}) => {
      const m = merge(options)
      const args = [
        'build',
        ...buildGlobalFlags(m),
        ...buildNetworkFlags(m),
        ...buildCompilerFlags(options),
      ]
      await runLeo(args, m.cwd, m.leoPath)
    },

    abi: async (options) => {
      const m = merge(options)
      const args = ['abi', options.file]
      if (options.network) args.push('--network', options.network)
      if (options.output) args.push('--output', options.output)
      args.push(...buildGlobalFlags(m))
      return runLeoCapture(args, m.cwd, m.leoPath)
    },

    deploy: async (options = {}) => {
      const m = merge(options)
      const args = [
        'deploy',
        ...buildGlobalFlags(m),
        ...buildNetworkFlags(m),
        ...buildCompilerFlags(options),
        ...buildTransactionFlags(options),
      ]
      if (options.skip) for (const s of options.skip) args.push('--skip', s)
      await runLeo(args, m.cwd, m.leoPath)
    },

    synthesize: async (options) => {
      const m = merge(options)
      const args = ['synthesize', options.name]
      if (options.local) args.push('--local')
      if (options.skip) for (const s of options.skip) args.push('--skip', s)
      args.push(
        ...buildGlobalFlags(m),
        ...buildNetworkFlags(m),
        ...buildCompilerFlags(options),
        ...buildTransactionFlags(options),
      )
      await runLeo(args, m.cwd, m.leoPath)
    },
  }
}

// =============================================================================
// Flag builders
// =============================================================================

function buildGlobalFlags(c: LeoClientConfig): string[] {
  const a: string[] = []
  if (c.debug) a.push('-d')
  if (c.quiet) a.push('-q')
  if (c.disableUpdateCheck) a.push('--disable-update-check')
  if (c.cwd) a.push('--path', c.cwd)
  if (c.home) a.push('--home', c.home)
  return a
}

function buildNetworkFlags(c: LeoClientConfig): string[] {
  const a: string[] = []
  if (c.privateKey) a.push('--private-key', c.privateKey)
  if (c.network) a.push('--network', c.network)
  if (c.endpoint) a.push('--endpoint', c.endpoint)
  if (c.devnet) a.push('--devnet')
  if (c.consensusHeights) a.push('--consensus-heights', c.consensusHeights)
  if (c.networkRetries !== undefined) a.push('--network-retries', String(c.networkRetries))
  if (c.offline) a.push('--offline')
  return a
}

function buildCompilerFlags(o: LeoCompilerOptions): string[] {
  const a: string[] = []
  if (o.enableAstSpans) a.push('--enable-ast-spans')
  if (o.enableDce) a.push('--enable-dce')
  if (o.conditionalBlockMaxDepth !== undefined) {
    a.push('--conditional-block-max-depth', String(o.conditionalBlockMaxDepth))
  }
  if (o.disableConditionalBranchTypeChecking) {
    a.push('--disable-conditional-branch-type-checking')
  }
  if (o.enableInitialAstSnapshot) a.push('--enable-initial-ast-snapshot')
  if (o.enableAllAstSnapshots) a.push('--enable-all-ast-snapshots')
  if (o.astSnapshots && o.astSnapshots.length) {
    a.push('--ast-snapshots', o.astSnapshots.join(','))
  }
  if (o.buildTests) a.push('--build-tests')
  if (o.noCache) a.push('--no-cache')
  if (o.noLocal) a.push('--no-local')
  return a
}

function buildTransactionFlags(o: LeoTransactionOptions): string[] {
  const a: string[] = []
  if (o.priorityFees) a.push('--priority-fees', o.priorityFees)
  if (o.feeRecords) a.push('--fee-records', o.feeRecords)
  if (o.print) a.push('--print')
  if (o.broadcast) a.push('--broadcast')
  if (o.save) a.push('--save', o.save)
  if (o.yes) a.push('-y')
  if (o.consensusVersion) a.push('--consensus-version', o.consensusVersion)
  if (o.maxWait !== undefined) a.push('--max-wait', String(o.maxWait))
  if (o.blocksToCheck !== undefined) a.push('--blocks-to-check', String(o.blocksToCheck))
  return a
}

// =============================================================================
// Subprocess helpers
// =============================================================================

function runLeo(args: string[], cwd?: string, leoPath = 'leo'): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(leoPath, args, { stdio: 'inherit', cwd })
    proc.on('error', (err) =>
      reject(
        new Error(
          `Failed to run ${leoPath}: ${err.message}. Ensure the Leo CLI is installed: https://developer.aleo.org/leo/installation`,
        ),
      ),
    )
    proc.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${leoPath} ${args[0]} exited with code ${code}`))
    })
  })
}

function runLeoCapture(args: string[], cwd?: string, leoPath = 'leo'): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(leoPath, args, { stdio: ['ignore', 'pipe', 'inherit'], cwd })
    let stdout = ''
    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.on('error', (err) =>
      reject(
        new Error(
          `Failed to run ${leoPath}: ${err.message}. Ensure the Leo CLI is installed: https://developer.aleo.org/leo/installation`,
        ),
      ),
    )
    proc.on('exit', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`${leoPath} ${args[0]} exited with code ${code}`))
    })
  })
}

// =============================================================================
// Standalone API
// =============================================================================

export async function build(options?: { cwd?: string }): Promise<void> {
  await runLeo(['build'], options?.cwd)
}

export async function buildBatch(projects: Array<string | { cwd?: string }>): Promise<void> {
  for (const project of projects) {
    const cwd = typeof project === 'string' ? project : project.cwd
    await runLeo(['build'], cwd)
  }
}

export async function abi(options?: { cwd?: string }): Promise<void> {
  await runLeo(['build'], options?.cwd)
}

export type LeoStartOptions = {
  /** Leo program name/path to run. */
  program: string
  /** Function name to call. */
  function: string
  /** Inputs to pass to the function. */
  inputs?: string[]
  /** Path to the Leo project directory. Defaults to the current working directory. */
  cwd?: string
}

export async function start(options: LeoStartOptions): Promise<void> {
  const args = ['run', options.function, ...(options.inputs ?? [])]
  await runLeo(args, options.cwd)
}

export type LeoCleanOptions = {
  /** Path to the Leo project directory. Defaults to the current working directory. */
  cwd?: string
}

export async function clean(options?: LeoCleanOptions): Promise<void> {
  await runLeo(['clean'], options?.cwd)
}
