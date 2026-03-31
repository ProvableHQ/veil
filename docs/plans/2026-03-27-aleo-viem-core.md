# aleo-viem Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@aleo-viem/core` — a viem-like TypeScript interface for Aleo that wraps existing wallets and SDKs behind a unified, familiar API. Every action ships with its corresponding MCP tool, agent tool schema, and structured JSON output.

**Architecture:** Interface-first design mirroring viem's Client → Transport → Actions pattern. Core defines interfaces (Transport, Account) with zero hard dependencies on specific SDKs. Proving is a client configuration concern, not a standalone interface. Actions are standalone functions decorated onto clients. Uses viem method names wherever concepts map. No `Aleo` prefix on types — use import namespacing. Agent tooling (MCP server, agent tool schemas) lives in core via subpath exports (`@aleo-viem/core/mcp`, `@aleo-viem/core/agent`).

**Tech Stack:** TypeScript, vitest, pnpm workspaces, tsup (bundling)

**Agent tooling principle:** Every task that ships a new action also ships its MCP tool definition, agent tool schema, and structured output. Agent tooling is never a separate phase — it's part of the definition of done for each action.

**Spec:** `docs/specs/2026-03-27-aleo-viem-design.md`

---

## File Structure

```
packages/core/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── src/
│   ├── index.ts                          # Public API barrel export
│   ├── types/
│   │   ├── account.ts                    # Account, SignerAccount, LocalAccount, RpcAccount, ViewOnlyAccount
│   │   ├── transport.ts                  # Transport, TransportConfig, RequestFn
│   │   ├── proving.ts                    # ProvingConfig, BuildTransactionOptions
│   │   ├── records.ts                    # RecordsConfig, RecordSearchParams, Record
│   │   ├── block.ts                      # Block
│   │   ├── transaction.ts                # Transaction, Transition
│   │   └── program.ts                    # Program, MappingValue
│   ├── clients/
│   │   ├── createClient.ts               # Base client factory
│   │   ├── createPublicClient.ts         # PublicClient = base + publicActions
│   │   ├── createWalletClient.ts         # WalletClient = base + walletActions (proving config type-excluded for RPC accounts)
│   │   └── decorators/
│   │       ├── public.ts                 # publicActions decorator
│   │       └── wallet.ts                 # walletActions decorator (includes executeTransaction alias)
│   ├── accounts/
│   │   ├── rpcAccount.ts                 # rpcAccount() factory
│   │   ├── privateKeyToAccount.ts        # privateKeyToAccount() factory
│   │   ├── mnemonicToAccount.ts          # mnemonicToAccount() factory
│   │   ├── viewOnlyAccount.ts            # viewOnlyAccount() factory
│   │   └── toAccount.ts                  # toAccount() — custom account from source
│   ├── transports/
│   │   ├── createTransport.ts            # Base transport factory
│   │   ├── http.ts                       # http() — Aleo REST API transport
│   │   ├── custom.ts                     # custom() — wrap any request function
│   │   └── fallback.ts                   # fallback() — chain transports
│   ├── actions/
│   │   ├── public/
│   │   │   ├── getBlockNumber.ts         # Current chain height
│   │   │   ├── getBlock.ts              # Fetch block by height or hash
│   │   │   ├── getTransaction.ts        # Fetch transaction by ID
│   │   │   ├── getBalance.ts            # Public credits balance
│   │   │   ├── readContract.ts          # Read program mapping value
│   │   │   ├── getCode.ts              # Fetch program source
│   │   │   ├── estimateGas.ts           # Estimate execution fee
│   │   │   ├── getRecords.ts            # Fetch records (Aleo-native)
│   │   │   └── getTransitionViewKeys.ts # Transition view keys (Aleo-native)
│   │   └── wallet/
│   │       ├── sendTransaction.ts       # Submit built transaction
│   │       ├── writeContract.ts         # Execute program transition (+ executeTransaction alias)
│   │       ├── deployContract.ts        # Deploy program
│   │       ├── signMessage.ts           # Sign arbitrary message
│   │       ├── transfer.ts             # credits.aleo convenience
│   │       ├── decrypt.ts              # Decrypt ciphertext (Aleo-native)
│   │       └── requestRecords.ts       # Request records (Aleo-native)
│   ├── contract/
│   │   ├── getContract.ts               # getContract() — binds program + client(s), returns typed read/write
│   │   └── parseProgram.ts              # Parse Aleo program source into typed structure
│   ├── agent/
│   │   ├── index.ts                     # aleoAgentTools() entry point (subpath: @aleo-viem/core/agent)
│   │   ├── schemas.ts                   # JSON schemas for each agent tool
│   │   └── handlers.ts                  # Execution handlers mapping tool calls → actions
│   ├── mcp/
│   │   ├── index.ts                     # createMcpServer() entry point (subpath: @aleo-viem/core/mcp)
│   │   └── tools.ts                     # MCP tool definitions wrapping agent tool schemas
│   ├── errors/
│   │   └── errors.ts                    # Error types (actionable messages for agents)
│   └── utils/
│       ├── address.ts                   # Aleo address validation
│       ├── uid.ts                       # Unique ID generator
│       ├── credits.ts                   # Microcredits <-> credits conversion
│       └── values.ts                    # Aleo value parsing: '100u64' → { value: 100n, type: 'u64' }
└── test/
    ├── types/
    │   ├── account.test.ts
    │   └── transport.test.ts
    ├── clients/
    │   ├── createClient.test.ts
    │   ├── createPublicClient.test.ts
    │   └── createWalletClient.test.ts
    ├── accounts/
    │   ├── rpcAccount.test.ts
    │   ├── privateKeyToAccount.test.ts
    │   └── viewOnlyAccount.test.ts
    ├── transports/
    │   ├── http.test.ts
    │   ├── custom.test.ts
    │   └── fallback.test.ts
    ├── actions/
    │   ├── public/
    │   │   ├── getBlockNumber.test.ts
    │   │   ├── getBlock.test.ts
    │   │   ├── getTransaction.test.ts
    │   │   ├── getBalance.test.ts
    │   │   ├── readContract.test.ts
    │   │   ├── getCode.test.ts
    │   │   └── estimateGas.test.ts
    │   └── wallet/
    │       ├── sendTransaction.test.ts
    │       ├── writeContract.test.ts
    │       ├── deployContract.test.ts
    │       ├── signMessage.test.ts
    │       └── transfer.test.ts
    ├── contract/
    │   ├── getContract.test.ts
    │   └── parseProgram.test.ts
    ├── agent/
    │   ├── schemas.test.ts
    │   └── handlers.test.ts
    ├── mcp/
    │   └── tools.test.ts
    └── utils/
        ├── address.test.ts
        ├── credits.test.ts
        └── values.test.ts
```

---

### Task 1: Monorepo Scaffold & Tooling

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.json`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/tsup.config.ts`
- Create: `packages/core/src/index.ts`
- Create: `vitest.config.ts`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "aleo-viem",
  "private": true,
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "tsup": "^8.0.0"
  }
}
```

- [ ] **Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 3: Create root tsconfig.json**

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true
  }
}
```

- [ ] **Step 4: Create packages/core/package.json**

```json
{
  "name": "@aleo-viem/core",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./agent": {
      "import": "./dist/agent/index.js",
      "types": "./dist/agent/index.d.ts"
    },
    "./mcp": {
      "import": "./dist/mcp/index.js",
      "types": "./dist/mcp/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "files": ["dist"]
}
```

- [ ] **Step 5: Create packages/core/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 6: Create packages/core/tsup.config.ts**

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/agent/index.ts',
    'src/mcp/index.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
})
```

- [ ] **Step 7: Create vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['packages/*/test/**/*.test.ts'],
  },
})
```

- [ ] **Step 8: Create packages/core/src/index.ts (empty barrel)**

```ts
// @aleo-viem/core
```

- [ ] **Step 9: Install dependencies and verify**

Run: `cd /Users/privacydaddy/dev/aleo-viem && pnpm install`
Expected: Lockfile created, no errors.

Run: `pnpm typecheck`
Expected: No type errors.

- [ ] **Step 10: Commit**

```bash
git add .
git commit -m "chore: scaffold monorepo with core package, typescript, vitest"
```

---

### Task 2: Core Types — Account, Transport, Proving, Records

**Files:**
- Create: `packages/core/src/types/account.ts`
- Create: `packages/core/src/types/transport.ts`
- Create: `packages/core/src/types/proving.ts`
- Create: `packages/core/src/types/records.ts`
- Create: `packages/core/src/types/block.ts`
- Create: `packages/core/src/types/transaction.ts`
- Create: `packages/core/src/types/program.ts`
- Create: `packages/core/test/types/account.test.ts`
- Create: `packages/core/test/types/transport.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write account type tests**

```ts
// packages/core/test/types/account.test.ts
import { describe, it, expectTypeOf } from 'vitest'
import type {
  Account,
  SignerAccount,
  LocalAccount,
  RpcAccount,
  ViewOnlyAccount,
} from '../../src/types/account.js'

describe('Account types', () => {
  it('Account has address only, no viewKey', () => {
    expectTypeOf<Account>().toHaveProperty('address')
    expectTypeOf<Account['address']>().toBeString()
    // viewKey is NOT on the base Account interface
  })

  it('SignerAccount extends Account with sign methods', () => {
    expectTypeOf<SignerAccount>().toHaveProperty('address')
    expectTypeOf<SignerAccount>().toHaveProperty('sign')
    expectTypeOf<SignerAccount>().toHaveProperty('signMessage')
  })

  it('LocalAccount has type local, privateKey, and viewKey', () => {
    expectTypeOf<LocalAccount['type']>().toEqualTypeOf<'local'>()
    expectTypeOf<LocalAccount>().toHaveProperty('privateKey')
    expectTypeOf<LocalAccount>().toHaveProperty('viewKey')
    expectTypeOf<LocalAccount['viewKey']>().toBeString()
    expectTypeOf<LocalAccount>().toHaveProperty('sign')
    expectTypeOf<LocalAccount>().toHaveProperty('signMessage')
  })

  it('RpcAccount has type rpc and sign methods', () => {
    expectTypeOf<RpcAccount['type']>().toEqualTypeOf<'rpc'>()
    expectTypeOf<RpcAccount>().toHaveProperty('sign')
    expectTypeOf<RpcAccount>().toHaveProperty('signMessage')
  })

  it('ViewOnlyAccount has type viewOnly and required viewKey', () => {
    expectTypeOf<ViewOnlyAccount['type']>().toEqualTypeOf<'viewOnly'>()
    expectTypeOf<ViewOnlyAccount['viewKey']>().toBeString()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/privacydaddy/dev/aleo-viem && pnpm vitest run packages/core/test/types/account.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement account types**

```ts
// packages/core/src/types/account.ts

/** Base account — address only, no sensitive material */
export type Account = {
  address: string
}

/** Account that can sign — either locally or via RPC */
export type SignerAccount = Account & {
  sign(message: Uint8Array): Promise<Uint8Array>
  signMessage(message: Uint8Array): Promise<Uint8Array>
}

/** Local account — has private key material, signs locally */
export type LocalAccount<source extends string = string> = SignerAccount & {
  type: 'local'
  source: source
  privateKey: string
  viewKey: string
}

/** RPC account — signing delegated to external provider (wallet) */
export type RpcAccount = SignerAccount & {
  type: 'rpc'
}

/** View-only account — can decrypt records, cannot sign or build transactions */
export type ViewOnlyAccount = Account & {
  type: 'viewOnly'
  viewKey: string
}

/** Union of all account types */
export type AnyAccount = LocalAccount | RpcAccount | ViewOnlyAccount
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/test/types/account.test.ts`
Expected: PASS

- [ ] **Step 5: Write transport type tests**

```ts
// packages/core/test/types/transport.test.ts
import { describe, it, expectTypeOf } from 'vitest'
import type { TransportConfig, RequestFn } from '../../src/types/transport.js'

describe('Transport types', () => {
  it('TransportConfig has required fields', () => {
    expectTypeOf<TransportConfig>().toHaveProperty('key')
    expectTypeOf<TransportConfig>().toHaveProperty('name')
    expectTypeOf<TransportConfig>().toHaveProperty('request')
    expectTypeOf<TransportConfig>().toHaveProperty('type')
  })

  it('RequestFn takes method and params', () => {
    expectTypeOf<RequestFn>().toBeFunction()
    expectTypeOf<RequestFn>().parameter(0).toHaveProperty('method')
  })
})
```

- [ ] **Step 6: Implement transport types**

```ts
// packages/core/src/types/transport.ts

export type RequestFn = (args: {
  method: string
  params?: unknown
}) => Promise<unknown>

export type TransportConfig<type extends string = string> = {
  key: string
  name: string
  request: RequestFn
  type: type
  retryCount?: number | undefined
  retryDelay?: number | undefined
  timeout?: number | undefined
}

export type Transport<type extends string = string> = {
  config: TransportConfig<type>
  request: RequestFn
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm vitest run packages/core/test/types/transport.test.ts`
Expected: PASS

- [ ] **Step 8: Implement proving config and records types**

```ts
// packages/core/src/types/proving.ts
import type { Transaction } from './transaction.js'

export type BuildTransactionOptions = {
  programName: string
  functionName: string
  inputs: string[]
  fee: bigint
  privateFee?: boolean | undefined
  feeRecord?: string | undefined
}

/** Proving configuration — determines how transactions are built */
export type ProvingConfig = {
  mode: 'delegated' | 'local'
  url?: string | undefined          // Required for delegated
  apiKey?: string | undefined        // Optional for delegated
  /** Optional override for custom proving implementations */
  buildTransaction?: (options: BuildTransactionOptions) => Promise<Transaction>
}
```

```ts
// packages/core/src/types/records.ts

export type RecordSearchParams = {
  program: string
  account?: { viewKey: string } | undefined
  unspent?: boolean | undefined
}

export type Record = {
  owner: string
  data: Record<string, unknown>
  nonce: string
  programId: string
  plaintext: string
}

/** Records config — either a config object or a custom implementation */
export type RecordsConfig =
  | { mode: 'network'; url: string }
  | { mode: 'local' }
  | { getRecords: (params: RecordSearchParams) => Promise<Record[]> }
```

```ts
// packages/core/src/types/block.ts

export type Block = {
  blockHash: string
  previousHash: string
  header: Record<string, unknown>
  authority: Record<string, unknown>
  transactions?: ConfirmedTransaction[] | undefined
  height: number
  round: number
  timestamp: number
}

export type ConfirmedTransaction = {
  type: 'execute' | 'deploy' | 'fee'
  id: string
  transaction: Record<string, unknown>
}
```

```ts
// packages/core/src/types/transaction.ts

export type Transaction = {
  id: string
  type: 'execute' | 'deploy' | 'fee'
  execution?: {
    transitions: Transition[]
  } | undefined
  deployment?: Record<string, unknown> | undefined
  fee: {
    transition: Transition
    globalStateRoot: string
    proof: string
  }
}

export type Transition = {
  id: string
  program: string
  function: string
  inputs: Array<{ type: string; id: string; value?: string }>
  outputs: Array<{ type: string; id: string; value?: string }>
  tpk: string
  tcm: string
}
```

```ts
// packages/core/src/types/program.ts

export type Program = {
  id: string
  source: string
  mappings: string[]
  functions: string[]
}

export type MappingValue = {
  key: string
  value: string
}
```

- [ ] **Step 9: Run all type tests**

Run: `pnpm vitest run packages/core/test/types/`
Expected: All PASS

- [ ] **Step 10: Export types from index.ts**

```ts
// packages/core/src/index.ts
export type {
  Account,
  SignerAccount,
  LocalAccount,
  RpcAccount,
  ViewOnlyAccount,
  AnyAccount,
} from './types/account.js'

export type {
  RequestFn,
  TransportConfig,
  Transport,
} from './types/transport.js'

export type {
  ProvingConfig,
  BuildTransactionOptions,
} from './types/proving.js'

export type {
  RecordsConfig,
  RecordSearchParams,
  Record,
} from './types/records.js'

export type { Block, ConfirmedTransaction } from './types/block.js'
export type { Transaction, Transition } from './types/transaction.js'
export type { Program, MappingValue } from './types/program.js'
```

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/types/ packages/core/test/types/ packages/core/src/index.ts
git commit -m "feat: add core type definitions — account, transport, proving, records, block, transaction, program"
```

---

### Task 3: Utilities — Address Validation, Credits Conversion, UID

**Files:**
- Create: `packages/core/src/utils/address.ts`
- Create: `packages/core/src/utils/credits.ts`
- Create: `packages/core/src/utils/uid.ts`
- Create: `packages/core/test/utils/address.test.ts`
- Create: `packages/core/test/utils/credits.test.ts`

- [ ] **Step 1: Write address validation tests**

```ts
// packages/core/test/utils/address.test.ts
import { describe, it, expect } from 'vitest'
import { isAddress, assertAddress } from '../../src/utils/address.js'

describe('isAddress', () => {
  it('returns true for valid aleo address', () => {
    expect(isAddress('aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc')).toBe(true)
  })

  it('returns false for empty string', () => {
    expect(isAddress('')).toBe(false)
  })

  it('returns false for ethereum address', () => {
    expect(isAddress('0xA0Cf798816D4b9b9866b5330EEa46a18382f251e')).toBe(false)
  })

  it('returns false for missing aleo1 prefix', () => {
    expect(isAddress('qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc')).toBe(false)
  })
})

describe('assertAddress', () => {
  it('throws for invalid address', () => {
    expect(() => assertAddress('bad')).toThrow()
  })

  it('does not throw for valid address', () => {
    expect(() => assertAddress('aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc')).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/test/utils/address.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement address validation**

```ts
// packages/core/src/utils/address.ts

const ADDRESS_REGEX = /^aleo1[a-z0-9]{58}$/

export function isAddress(address: string): boolean {
  return ADDRESS_REGEX.test(address)
}

export function assertAddress(address: string): void {
  if (!isAddress(address)) {
    throw new Error(`Invalid Aleo address: ${address}`)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/test/utils/address.test.ts`
Expected: PASS

- [ ] **Step 5: Write credits conversion tests**

```ts
// packages/core/test/utils/credits.test.ts
import { describe, it, expect } from 'vitest'
import { creditsToMicrocredits, microcreditsToCredits } from '../../src/utils/credits.js'

describe('creditsToMicrocredits', () => {
  it('converts 1 credit to 1_000_000 microcredits', () => {
    expect(creditsToMicrocredits(1n)).toBe(1_000_000n)
  })

  it('converts 0 credits', () => {
    expect(creditsToMicrocredits(0n)).toBe(0n)
  })

  it('converts fractional credits from number', () => {
    expect(creditsToMicrocredits(1.5)).toBe(1_500_000n)
  })
})

describe('microcreditsToCredits', () => {
  it('converts 1_000_000 microcredits to 1', () => {
    expect(microcreditsToCredits(1_000_000n)).toBe(1)
  })

  it('converts 500_000 microcredits to 0.5', () => {
    expect(microcreditsToCredits(500_000n)).toBe(0.5)
  })
})
```

- [ ] **Step 6: Implement credits conversion**

```ts
// packages/core/src/utils/credits.ts

const MICROCREDITS_PER_CREDIT = 1_000_000n

export function creditsToMicrocredits(credits: bigint | number): bigint {
  if (typeof credits === 'number') {
    return BigInt(Math.round(credits * Number(MICROCREDITS_PER_CREDIT)))
  }
  return credits * MICROCREDITS_PER_CREDIT
}

export function microcreditsToCredits(microcredits: bigint): number {
  return Number(microcredits) / Number(MICROCREDITS_PER_CREDIT)
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm vitest run packages/core/test/utils/credits.test.ts`
Expected: PASS

- [ ] **Step 8: Create UID utility**

```ts
// packages/core/src/utils/uid.ts

let count = 0

export function uid(): string {
  return `aleo-viem-${count++}`
}
```

- [ ] **Step 9: Write Aleo value parsing tests**

```ts
// packages/core/test/utils/values.test.ts
import { describe, it, expect } from 'vitest'
import { parseValue, encodeValue } from '../../src/utils/values.js'

describe('parseValue', () => {
  it('parses u64 values', () => {
    expect(parseValue('100u64')).toEqual({ value: 100n, type: 'u64' })
  })

  it('parses u128 values', () => {
    expect(parseValue('999u128')).toEqual({ value: 999n, type: 'u128' })
  })

  it('parses field values', () => {
    expect(parseValue('42field')).toEqual({ value: 42n, type: 'field' })
  })

  it('parses boolean values', () => {
    expect(parseValue('true')).toEqual({ value: true, type: 'boolean' })
    expect(parseValue('false')).toEqual({ value: false, type: 'boolean' })
  })

  it('parses address values', () => {
    const addr = 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc'
    expect(parseValue(addr)).toEqual({ value: addr, type: 'address' })
  })

  it('returns raw string for unrecognized formats', () => {
    expect(parseValue('unknown')).toEqual({ value: 'unknown', type: 'string' })
  })
})

describe('encodeValue', () => {
  it('encodes bigint with type suffix', () => {
    expect(encodeValue(100n, 'u64')).toBe('100u64')
  })

  it('encodes boolean', () => {
    expect(encodeValue(true, 'boolean')).toBe('true')
  })
})
```

- [ ] **Step 10: Implement Aleo value parsing**

```ts
// packages/core/src/utils/values.ts

export type ParsedValue = {
  value: bigint | boolean | string
  type: string
}

const INTEGER_REGEX = /^(-?\d+)(u8|u16|u32|u64|u128|i8|i16|i32|i64|i128|field|scalar|group)$/

export function parseValue(raw: string): ParsedValue {
  if (raw === 'true') return { value: true, type: 'boolean' }
  if (raw === 'false') return { value: false, type: 'boolean' }
  if (raw.startsWith('aleo1')) return { value: raw, type: 'address' }

  const match = raw.match(INTEGER_REGEX)
  if (match) {
    return { value: BigInt(match[1]), type: match[2] }
  }

  return { value: raw, type: 'string' }
}

export function encodeValue(value: bigint | boolean | string, type: string): string {
  if (type === 'boolean') return String(value)
  if (type === 'address' || type === 'string') return String(value)
  return `${value}${type}`
}
```

- [ ] **Step 11: Export utils from index.ts**

Add to `packages/core/src/index.ts`:

```ts
export { isAddress, assertAddress } from './utils/address.js'
export { creditsToMicrocredits, microcreditsToCredits } from './utils/credits.js'
export { parseValue, encodeValue, type ParsedValue } from './utils/values.js'
```

- [ ] **Step 12: Run all tests**

Run: `pnpm vitest run`
Expected: All PASS

- [ ] **Step 13: Commit**

```bash
git add packages/core/src/utils/ packages/core/test/utils/ packages/core/src/index.ts
git commit -m "feat: add address validation, credits conversion, value parsing, and uid utilities"
```

---

### Task 4: Errors

**Files:**
- Create: `packages/core/src/errors/errors.ts`

All error messages are written as actionable instructions — an agent reading the error should know exactly what to do next.

- [ ] **Step 1: Implement error classes**

```ts
// packages/core/src/errors/errors.ts

export class BaseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BaseError'
  }
}

export class TransportError extends BaseError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TransportError'
  }
}

export class AccountNotFoundError extends BaseError {
  constructor() {
    super(
      'No account configured. To read data, use createPublicClient. ' +
      'To sign transactions, use createWalletClient with an account:\n' +
      '  createWalletClient({ account: rpcAccount(walletAdapter), transport: custom(walletAdapter) })',
    )
    this.name = 'AccountNotFoundError'
  }
}

export class ProvingNotConfiguredError extends BaseError {
  constructor() {
    super(
      'No proving configuration found. Local accounts require a proving config:\n' +
      '  createWalletClient({ account, transport, proving: { mode: \'delegated\', url: \'...\' } })\n' +
      'Or use an RPC account (wallet adapter) which handles proving internally.',
    )
    this.name = 'ProvingNotConfiguredError'
  }
}

export class InvalidAddressError extends BaseError {
  constructor(address: string) {
    super(
      `Invalid Aleo address: "${address}". ` +
      'Aleo addresses start with "aleo1" followed by 58 lowercase alphanumeric characters.',
    )
    this.name = 'InvalidAddressError'
  }
}

export class ProgramNotFoundError extends BaseError {
  constructor(program: string) {
    super(
      `Program "${program}" not found. ` +
      'Verify the program ID is correct and has been deployed. ' +
      `Check with: await client.getCode({ program: '${program}' })`,
    )
    this.name = 'ProgramNotFoundError'
  }
}

export class InvalidInputError extends BaseError {
  constructor(functionName: string, expected: string, received: string) {
    super(
      `Invalid input for function "${functionName}": expected ${expected}, received "${received}". ` +
      'Use encodeValue() to convert values, e.g. encodeValue(100n, \'u64\') → \'100u64\'.',
    )
    this.name = 'InvalidInputError'
  }
}
```

- [ ] **Step 2: Export errors from index.ts**

Add to `packages/core/src/index.ts`:

```ts
export {
  BaseError,
  TransportError,
  AccountNotFoundError,
  ProvingNotConfiguredError,
  InvalidAddressError,
} from './errors/errors.js'
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/errors/ packages/core/src/index.ts
git commit -m "feat: add error types"
```

---

### Task 5: Transport Layer — createTransport, http, custom, fallback

**Files:**
- Create: `packages/core/src/transports/createTransport.ts`
- Create: `packages/core/src/transports/http.ts`
- Create: `packages/core/src/transports/custom.ts`
- Create: `packages/core/src/transports/fallback.ts`
- Create: `packages/core/test/transports/http.test.ts`
- Create: `packages/core/test/transports/custom.test.ts`
- Create: `packages/core/test/transports/fallback.test.ts`

- [ ] **Step 1: Write http transport tests**

```ts
// packages/core/test/transports/http.test.ts
import { describe, it, expect, vi } from 'vitest'
import { http } from '../../src/transports/http.js'

describe('http transport', () => {
  it('creates a transport with type http', () => {
    const transport = http('https://api.provable.com/v2')
    expect(transport.config.type).toBe('http')
    expect(transport.config.key).toBe('http')
    expect(transport.config.name).toBe('HTTP Transport')
  })

  it('makes GET requests to aleo REST API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(100),
    })

    const transport = http('https://api.provable.com/v2', { fetchFn: mockFetch })
    const result = await transport.request({ method: 'getLatestHeight' })

    expect(result).toBe(100)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.provable.com/v2/mainnet/latest/height',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('makes GET requests with params encoded in URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ blockHash: 'ab1...' }),
    })

    const transport = http('https://api.provable.com/v2', { fetchFn: mockFetch })
    await transport.request({ method: 'getBlock', params: { height: 100 } })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.provable.com/v2/mainnet/block/100',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('throws TransportError on non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not found'),
    })

    const transport = http('https://api.provable.com/v2', { fetchFn: mockFetch })
    await expect(transport.request({ method: 'getLatestHeight' })).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/test/transports/http.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement createTransport**

```ts
// packages/core/src/transports/createTransport.ts
import type { RequestFn, Transport, TransportConfig } from '../types/transport.js'

export function createTransport<type extends string>(
  config: TransportConfig<type>,
): Transport<type> {
  return {
    config,
    request: config.request,
  }
}
```

- [ ] **Step 4: Implement http transport**

```ts
// packages/core/src/transports/http.ts
import { TransportError } from '../errors/errors.js'
import type { Transport } from '../types/transport.js'
import { createTransport } from './createTransport.js'

type HttpTransportConfig = {
  fetchFn?: typeof fetch | undefined
  headers?: Record<string, string> | undefined
  key?: string | undefined
  name?: string | undefined
  network?: 'mainnet' | 'testnet' | undefined
}

/**
 * Maps aleo-viem method names + params to Aleo REST API paths.
 * Aleo uses REST, not JSON-RPC, so each method maps to a URL path.
 */
function buildUrl(
  baseUrl: string,
  network: string,
  method: string,
  params?: Record<string, unknown>,
): { url: string; httpMethod: 'GET' | 'POST'; body?: string } {
  const base = `${baseUrl}/${network}`

  switch (method) {
    case 'getLatestHeight':
      return { url: `${base}/latest/height`, httpMethod: 'GET' }
    case 'getLatestBlock':
      return { url: `${base}/latest/block`, httpMethod: 'GET' }
    case 'getLatestBlockHash':
      return { url: `${base}/latest/hash`, httpMethod: 'GET' }
    case 'getBlock':
      return { url: `${base}/block/${params?.height}`, httpMethod: 'GET' }
    case 'getBlockByHash':
      return { url: `${base}/block/${params?.hash}`, httpMethod: 'GET' }
    case 'getTransaction':
      return { url: `${base}/transaction/${params?.id}`, httpMethod: 'GET' }
    case 'getBalance':
      return { url: `${base}/program/credits.aleo/mapping/account/${params?.address}`, httpMethod: 'GET' }
    case 'getProgram':
      return { url: `${base}/program/${params?.programId}`, httpMethod: 'GET' }
    case 'getMappingValue':
      return { url: `${base}/program/${params?.programId}/mapping/${params?.mapping}/${params?.key}`, httpMethod: 'GET' }
    case 'getMappingNames':
      return { url: `${base}/program/${params?.programId}/mappings`, httpMethod: 'GET' }
    case 'getStateRoot':
      return { url: `${base}/latest/stateRoot`, httpMethod: 'GET' }
    case 'getTransactions':
      return { url: `${base}/block/${params?.height}/transactions`, httpMethod: 'GET' }
    case 'getTransactionsInMempool':
      return { url: `${base}/memoryPool/transactions`, httpMethod: 'GET' }
    case 'getTransitionId':
      return { url: `${base}/find/transitionID/${params?.id}`, httpMethod: 'GET' }
    case 'sendTransaction':
      return { url: `${base}/transaction/broadcast`, httpMethod: 'POST', body: JSON.stringify(params?.transaction) }
    default:
      throw new TransportError(`Unknown method: ${method}`)
  }
}

export function http(
  url: string,
  config: HttpTransportConfig = {},
): Transport<'http'> {
  const {
    fetchFn = fetch,
    headers = {},
    key = 'http',
    name = 'HTTP Transport',
    network = 'mainnet',
  } = config

  return createTransport({
    key,
    name,
    type: 'http',
    request: async ({ method, params }) => {
      const { url: requestUrl, httpMethod, body } = buildUrl(
        url,
        network,
        method,
        params as Record<string, unknown> | undefined,
      )

      const response = await fetchFn(requestUrl, {
        method: httpMethod,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        ...(body ? { body } : {}),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new TransportError(`HTTP ${response.status}: ${text}`)
      }

      return response.json()
    },
  })
}
```

- [ ] **Step 5: Run http test to verify it passes**

Run: `pnpm vitest run packages/core/test/transports/http.test.ts`
Expected: PASS

- [ ] **Step 6: Write custom transport tests**

```ts
// packages/core/test/transports/custom.test.ts
import { describe, it, expect, vi } from 'vitest'
import { custom } from '../../src/transports/custom.js'

describe('custom transport', () => {
  it('creates a transport with type custom', () => {
    const requestFn = vi.fn()
    const transport = custom({ request: requestFn })
    expect(transport.config.type).toBe('custom')
  })

  it('delegates requests to the provided function', async () => {
    const requestFn = vi.fn().mockResolvedValue(42)
    const transport = custom({ request: requestFn })
    const result = await transport.request({ method: 'getLatestHeight' })

    expect(result).toBe(42)
    expect(requestFn).toHaveBeenCalledWith({ method: 'getLatestHeight' })
  })
})
```

- [ ] **Step 7: Implement custom transport**

```ts
// packages/core/src/transports/custom.ts
import type { RequestFn, Transport } from '../types/transport.js'
import { createTransport } from './createTransport.js'

type CustomTransportConfig = {
  request: RequestFn
  key?: string | undefined
  name?: string | undefined
}

export function custom(config: CustomTransportConfig): Transport<'custom'> {
  const { request, key = 'custom', name = 'Custom Transport' } = config
  return createTransport({ key, name, type: 'custom', request })
}
```

- [ ] **Step 8: Run custom test to verify it passes**

Run: `pnpm vitest run packages/core/test/transports/custom.test.ts`
Expected: PASS

- [ ] **Step 9: Write fallback transport tests**

```ts
// packages/core/test/transports/fallback.test.ts
import { describe, it, expect, vi } from 'vitest'
import { fallback } from '../../src/transports/fallback.js'
import { custom } from '../../src/transports/custom.js'

describe('fallback transport', () => {
  it('creates a transport with type fallback', () => {
    const t1 = custom({ request: vi.fn() })
    const t2 = custom({ request: vi.fn() })
    const transport = fallback([t1, t2])
    expect(transport.config.type).toBe('fallback')
  })

  it('uses first transport when it succeeds', async () => {
    const t1 = custom({ request: vi.fn().mockResolvedValue(1) })
    const t2 = custom({ request: vi.fn().mockResolvedValue(2) })
    const transport = fallback([t1, t2])

    const result = await transport.request({ method: 'getLatestHeight' })
    expect(result).toBe(1)
  })

  it('falls back to second transport when first fails', async () => {
    const t1 = custom({ request: vi.fn().mockRejectedValue(new Error('down')) })
    const t2 = custom({ request: vi.fn().mockResolvedValue(2) })
    const transport = fallback([t1, t2])

    const result = await transport.request({ method: 'getLatestHeight' })
    expect(result).toBe(2)
  })

  it('throws when all transports fail', async () => {
    const t1 = custom({ request: vi.fn().mockRejectedValue(new Error('down1')) })
    const t2 = custom({ request: vi.fn().mockRejectedValue(new Error('down2')) })
    const transport = fallback([t1, t2])

    await expect(transport.request({ method: 'getLatestHeight' })).rejects.toThrow()
  })
})
```

- [ ] **Step 10: Implement fallback transport**

```ts
// packages/core/src/transports/fallback.ts
import { TransportError } from '../errors/errors.js'
import type { Transport } from '../types/transport.js'
import { createTransport } from './createTransport.js'

export function fallback(transports: Transport[]): Transport<'fallback'> {
  return createTransport({
    key: 'fallback',
    name: 'Fallback Transport',
    type: 'fallback',
    request: async (args) => {
      let lastError: Error | undefined
      for (const transport of transports) {
        try {
          return await transport.request(args)
        } catch (error) {
          lastError = error as Error
        }
      }
      throw new TransportError('All transports failed.', { cause: lastError })
    },
  })
}
```

- [ ] **Step 11: Run all transport tests**

Run: `pnpm vitest run packages/core/test/transports/`
Expected: All PASS

- [ ] **Step 12: Export transports from index.ts**

Add to `packages/core/src/index.ts`:

```ts
export { createTransport } from './transports/createTransport.js'
export { http } from './transports/http.js'
export { custom } from './transports/custom.js'
export { fallback } from './transports/fallback.js'
```

- [ ] **Step 13: Commit**

```bash
git add packages/core/src/transports/ packages/core/test/transports/ packages/core/src/index.ts
git commit -m "feat: add transport layer — http, custom, fallback"
```

---

### Task 6: Client Layer — createClient, createPublicClient, createWalletClient

**Files:**
- Create: `packages/core/src/clients/createClient.ts`
- Create: `packages/core/src/clients/createPublicClient.ts`
- Create: `packages/core/src/clients/createWalletClient.ts`
- Create: `packages/core/src/clients/decorators/public.ts`
- Create: `packages/core/src/clients/decorators/wallet.ts`
- Create: `packages/core/test/clients/createClient.test.ts`
- Create: `packages/core/test/clients/createPublicClient.test.ts`
- Create: `packages/core/test/clients/createWalletClient.test.ts`

- [ ] **Step 1: Write createClient tests**

```ts
// packages/core/test/clients/createClient.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createClient } from '../../src/clients/createClient.js'
import { custom } from '../../src/transports/custom.js'

describe('createClient', () => {
  it('creates a client with transport', () => {
    const transport = custom({ request: vi.fn() })
    const client = createClient({ transport })

    expect(client.transport).toBe(transport)
    expect(client.uid).toBeDefined()
    expect(client.request).toBeTypeOf('function')
  })

  it('stores account if provided', () => {
    const transport = custom({ request: vi.fn() })
    const mockAccount = { type: 'rpc' as const, address: 'aleo1abc', sign: vi.fn(), signMessage: vi.fn() }
    const client = createClient({ transport, account: mockAccount })

    expect(client.account).toBe(mockAccount)
  })

  it('stores proving and records config if provided', () => {
    const transport = custom({ request: vi.fn() })
    const proving = { mode: 'delegated' as const, url: 'https://prover.example.com' }
    const records = { mode: 'network' as const, url: 'https://records.example.com' }
    const client = createClient({ transport, proving, records })

    expect(client.proving).toBe(proving)
    expect(client.records).toBe(records)
  })

  it('extends client with additional actions', () => {
    const transport = custom({ request: vi.fn() })
    const client = createClient({ transport })
    const extended = client.extend((base) => ({
      doStuff: () => 'done',
    }))

    expect(extended.doStuff()).toBe('done')
    expect(extended.transport).toBe(transport)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/test/clients/createClient.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement createClient**

```ts
// packages/core/src/clients/createClient.ts
import type { AnyAccount } from '../types/account.js'
import type { ProvingConfig } from '../types/proving.js'
import type { RecordsConfig } from '../types/records.js'
import type { Transport } from '../types/transport.js'
import { uid as createUid } from '../utils/uid.js'

export type ClientConfig = {
  account?: AnyAccount | undefined
  key?: string | undefined
  name?: string | undefined
  proving?: ProvingConfig | undefined
  records?: RecordsConfig | undefined
  transport: Transport
}

export type Client = {
  account: AnyAccount | undefined
  key: string
  name: string
  proving: ProvingConfig | undefined
  records: RecordsConfig | undefined
  request: Transport['request']
  transport: Transport
  uid: string
  extend: <extended extends Record<string, unknown>>(
    fn: (client: Client) => extended,
  ) => Client & extended
}

export function createClient(config: ClientConfig): Client {
  const {
    account,
    key = 'base',
    name = 'Client',
    proving,
    records,
    transport,
  } = config

  const uid = createUid()

  const client: Client = {
    account,
    key,
    name,
    proving,
    records,
    request: transport.request,
    transport,
    uid,
    extend(fn) {
      return Object.assign(Object.create(client), fn(client)) as any
    },
  }

  return client
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/test/clients/createClient.test.ts`
Expected: PASS

- [ ] **Step 5: Write createPublicClient tests**

```ts
// packages/core/test/clients/createPublicClient.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createPublicClient } from '../../src/clients/createPublicClient.js'
import { custom } from '../../src/transports/custom.js'

describe('createPublicClient', () => {
  it('creates a public client with public actions', () => {
    const transport = custom({ request: vi.fn() })
    const client = createPublicClient({ transport })

    expect(client.key).toBe('public')
    expect(client.name).toBe('Public Client')
    expect(client.getBlockNumber).toBeTypeOf('function')
    expect(client.getBlock).toBeTypeOf('function')
    expect(client.getBalance).toBeTypeOf('function')
    expect(client.getTransaction).toBeTypeOf('function')
    expect(client.readContract).toBeTypeOf('function')
    expect(client.getCode).toBeTypeOf('function')
    expect(client.estimateGas).toBeTypeOf('function')
  })
})
```

- [ ] **Step 6: Create public actions decorator (stub)**

```ts
// packages/core/src/clients/decorators/public.ts
import type { Client } from '../createClient.js'

export type PublicActions = {
  getBlockNumber: () => Promise<bigint>
  getBlock: (params: { height?: number; hash?: string }) => Promise<unknown>
  getTransaction: (params: { id: string }) => Promise<unknown>
  getBalance: (params: { address: string }) => Promise<bigint>
  readContract: (params: { program: string; mapping: string; key: string }) => Promise<unknown>
  getCode: (params: { program: string }) => Promise<string>
  estimateGas: (params: { program: string; function: string; inputs: string[] }) => Promise<bigint>
  getRecords: (params: { program: string }) => Promise<unknown[]>
  getTransitionViewKeys: (params: { transactionId: string }) => Promise<string[]>
}

export function publicActions(client: Client): PublicActions {
  return {
    getBlockNumber: () =>
      client.request({ method: 'getLatestHeight' }).then((h) => BigInt(h as number)),
    getBlock: (params) =>
      client.request({
        method: params.hash ? 'getBlockByHash' : 'getBlock',
        params: params.hash ? { hash: params.hash } : { height: params.height },
      }),
    getTransaction: (params) =>
      client.request({ method: 'getTransaction', params: { id: params.id } }),
    getBalance: (params) =>
      client.request({ method: 'getBalance', params: { address: params.address } })
        .then((v) => BigInt(v as number)),
    readContract: (params) =>
      client.request({
        method: 'getMappingValue',
        params: { programId: params.program, mapping: params.mapping, key: params.key },
      }),
    getCode: (params) =>
      client.request({ method: 'getProgram', params: { programId: params.program } }) as Promise<string>,
    estimateGas: (_params) =>
      Promise.resolve(0n),
    getRecords: (_params) =>
      Promise.resolve([]),
    getTransitionViewKeys: (params) =>
      client.request({ method: 'getTransitionViewKeys', params: { id: params.transactionId } }) as Promise<string[]>,
  }
}
```

- [ ] **Step 7: Implement createPublicClient**

```ts
// packages/core/src/clients/createPublicClient.ts
import { createClient, type ClientConfig, type Client } from './createClient.js'
import { publicActions, type PublicActions } from './decorators/public.js'

export type PublicClientConfig = Omit<ClientConfig, 'account' | 'key' | 'name' | 'proving'> & {
  key?: string | undefined
  name?: string | undefined
}

export type PublicClient = Client & PublicActions

export function createPublicClient(config: PublicClientConfig): PublicClient {
  const { key = 'public', name = 'Public Client', ...rest } = config
  const client = createClient({ ...rest, key, name })
  return client.extend(publicActions) as PublicClient
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run packages/core/test/clients/createPublicClient.test.ts`
Expected: PASS

- [ ] **Step 9: Write createWalletClient tests**

```ts
// packages/core/test/clients/createWalletClient.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createWalletClient } from '../../src/clients/createWalletClient.js'
import { custom } from '../../src/transports/custom.js'

describe('createWalletClient', () => {
  it('creates a wallet client with wallet actions', () => {
    const transport = custom({ request: vi.fn() })
    const mockAccount = { type: 'rpc' as const, address: 'aleo1abc', sign: vi.fn(), signMessage: vi.fn() }
    const client = createWalletClient({ account: mockAccount, transport })

    expect(client.key).toBe('wallet')
    expect(client.name).toBe('Wallet Client')
    expect(client.sendTransaction).toBeTypeOf('function')
    expect(client.writeContract).toBeTypeOf('function')
    expect(client.executeTransaction).toBeTypeOf('function')
    expect(client.deployContract).toBeTypeOf('function')
    expect(client.signMessage).toBeTypeOf('function')
    expect(client.transfer).toBeTypeOf('function')
  })

  it('executeTransaction is an alias for writeContract', () => {
    const transport = custom({ request: vi.fn() })
    const mockAccount = { type: 'rpc' as const, address: 'aleo1abc', sign: vi.fn(), signMessage: vi.fn() }
    const client = createWalletClient({ account: mockAccount, transport })

    // Both should be functions that exist on the client
    expect(client.executeTransaction).toBeTypeOf('function')
    expect(client.writeContract).toBeTypeOf('function')
  })
})
```

- [ ] **Step 10: Create wallet actions decorator**

```ts
// packages/core/src/clients/decorators/wallet.ts
import { AccountNotFoundError } from '../../errors/errors.js'
import type { SignerAccount } from '../../types/account.js'
import type { Client } from '../createClient.js'

export type WalletActions = {
  sendTransaction: (params: { transaction: string }) => Promise<string>
  writeContract: (params: {
    program: string
    function: string
    inputs: string[]
    fee: bigint
    privateFee?: boolean
  }) => Promise<string>
  /** Alias for writeContract — consistent with Aleo wallet adapter terminology */
  executeTransaction: (params: {
    program: string
    function: string
    inputs: string[]
    fee: bigint
    privateFee?: boolean
  }) => Promise<string>
  deployContract: (params: { program: string; fee: bigint }) => Promise<string>
  signMessage: (params: { message: Uint8Array }) => Promise<Uint8Array>
  transfer: (params: { to: string; amount: bigint; privateFee?: boolean }) => Promise<string>
  decrypt: (params: { ciphertext: string }) => Promise<string>
  requestRecords: (params: { program: string }) => Promise<unknown[]>
}

function getSignerAccount(client: Client): SignerAccount {
  if (!client.account || !('sign' in client.account)) {
    throw new AccountNotFoundError()
  }
  return client.account as SignerAccount
}

export function walletActions(client: Client): WalletActions {
  const writeContractFn = async (params: {
    program: string
    function: string
    inputs: string[]
    fee: bigint
    privateFee?: boolean
  }): Promise<string> => {
    const account = getSignerAccount(client)

    // If client has proving config with a custom buildTransaction, use it
    if (client.proving?.buildTransaction) {
      const tx = await client.proving.buildTransaction({
        programName: params.program,
        functionName: params.function,
        inputs: params.inputs,
        fee: params.fee,
        privateFee: params.privateFee,
      })
      return client.request({
        method: 'sendTransaction',
        params: { transaction: JSON.stringify(tx) },
      }) as Promise<string>
    }

    // For RPC accounts or when proving mode handles it, delegate to the transport
    return client.request({
      method: 'executeTransaction',
      params: {
        programName: params.program,
        functionName: params.function,
        inputs: params.inputs,
        fee: params.fee,
        privateFee: params.privateFee,
      },
    }) as Promise<string>
  }

  return {
    sendTransaction: (params) =>
      client.request({
        method: 'sendTransaction',
        params: { transaction: params.transaction },
      }) as Promise<string>,

    writeContract: writeContractFn,
    executeTransaction: writeContractFn,

    deployContract: (params) =>
      client.request({
        method: 'deployProgram',
        params: { program: params.program, fee: params.fee },
      }) as Promise<string>,

    signMessage: async (params) => {
      const account = getSignerAccount(client)
      return account.signMessage(params.message)
    },

    transfer: (params) =>
      writeContractFn({
        program: 'credits.aleo',
        function: params.privateFee ? 'transfer_private' : 'transfer_public',
        inputs: [params.to, `${params.amount}u64`],
        fee: 0n,
        privateFee: params.privateFee,
      }),

    decrypt: (params) =>
      client.request({
        method: 'decrypt',
        params: { ciphertext: params.ciphertext },
      }) as Promise<string>,

    requestRecords: (params) =>
      client.request({
        method: 'requestRecords',
        params: { program: params.program },
      }) as Promise<unknown[]>,
  }
}
```

- [ ] **Step 11: Implement createWalletClient**

```ts
// packages/core/src/clients/createWalletClient.ts
import type { SignerAccount } from '../types/account.js'
import type { ProvingConfig } from '../types/proving.js'
import type { RecordsConfig } from '../types/records.js'
import type { Transport } from '../types/transport.js'
import { createClient, type Client } from './createClient.js'
import { walletActions, type WalletActions } from './decorators/wallet.js'

/** Config for RPC account — proving is excluded, wallet handles it */
export type RpcWalletClientConfig = {
  account: SignerAccount & { type: 'rpc' }
  transport: Transport
  records?: RecordsConfig | undefined
  key?: string | undefined
  name?: string | undefined
}

/** Config for local account — must provide proving config */
export type LocalWalletClientConfig = {
  account: SignerAccount & { type: 'local' }
  transport: Transport
  proving: ProvingConfig
  records?: RecordsConfig | undefined
  key?: string | undefined
  name?: string | undefined
}

export type WalletClientConfig = RpcWalletClientConfig | LocalWalletClientConfig

export type WalletClient = Client & WalletActions

export function createWalletClient(config: WalletClientConfig): WalletClient {
  const { key = 'wallet', name = 'Wallet Client', ...rest } = config
  const client = createClient({
    ...rest,
    proving: 'proving' in rest ? rest.proving : undefined,
    key,
    name,
  })
  return client.extend(walletActions) as WalletClient
}
```

- [ ] **Step 12: Run all client tests**

Run: `pnpm vitest run packages/core/test/clients/`
Expected: All PASS

- [ ] **Step 13: Export clients from index.ts**

Add to `packages/core/src/index.ts`:

```ts
export { createClient, type Client, type ClientConfig } from './clients/createClient.js'
export { createPublicClient, type PublicClient, type PublicClientConfig } from './clients/createPublicClient.js'
export { createWalletClient, type WalletClient, type WalletClientConfig, type RpcWalletClientConfig, type LocalWalletClientConfig } from './clients/createWalletClient.js'
export type { PublicActions } from './clients/decorators/public.js'
export type { WalletActions } from './clients/decorators/wallet.js'
```

- [ ] **Step 14: Commit**

```bash
git add packages/core/src/clients/ packages/core/test/clients/ packages/core/src/index.ts
git commit -m "feat: add client layer — createClient, createPublicClient, createWalletClient with proving config and executeTransaction alias"
```

---

### Task 7: Account Factories — rpcAccount, privateKeyToAccount, viewOnlyAccount

**Files:**
- Create: `packages/core/src/accounts/toAccount.ts`
- Create: `packages/core/src/accounts/rpcAccount.ts`
- Create: `packages/core/src/accounts/privateKeyToAccount.ts`
- Create: `packages/core/src/accounts/mnemonicToAccount.ts`
- Create: `packages/core/src/accounts/viewOnlyAccount.ts`
- Create: `packages/core/test/accounts/rpcAccount.test.ts`
- Create: `packages/core/test/accounts/privateKeyToAccount.test.ts`
- Create: `packages/core/test/accounts/viewOnlyAccount.test.ts`

- [ ] **Step 1: Write rpcAccount tests**

```ts
// packages/core/test/accounts/rpcAccount.test.ts
import { describe, it, expect, vi } from 'vitest'
import { rpcAccount } from '../../src/accounts/rpcAccount.js'

describe('rpcAccount', () => {
  it('creates an RpcAccount from a provider', () => {
    const provider = {
      address: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
      sign: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      signMessage: vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6])),
    }
    const account = rpcAccount(provider)

    expect(account.type).toBe('rpc')
    expect(account.address).toBe(provider.address)
  })

  it('delegates sign to the provider', async () => {
    const provider = {
      address: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
      sign: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      signMessage: vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6])),
    }
    const account = rpcAccount(provider)
    const msg = new Uint8Array([7, 8, 9])
    await account.signMessage(msg)

    expect(provider.signMessage).toHaveBeenCalledWith(msg)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/test/accounts/rpcAccount.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement toAccount (base factory)**

```ts
// packages/core/src/accounts/toAccount.ts
import type { LocalAccount, RpcAccount, ViewOnlyAccount } from '../types/account.js'

export type ToAccountSource = {
  address: string
  sign?: (message: Uint8Array) => Promise<Uint8Array>
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>
}

export function toAccount(source: ToAccountSource & { type: 'rpc' }): RpcAccount
export function toAccount(source: ToAccountSource & { type: 'viewOnly'; viewKey: string }): ViewOnlyAccount
export function toAccount(source: ToAccountSource & { type: 'local'; privateKey: string; viewKey: string; source: string }): LocalAccount
export function toAccount(source: any): any {
  return source
}
```

- [ ] **Step 4: Implement rpcAccount**

```ts
// packages/core/src/accounts/rpcAccount.ts
import type { RpcAccount } from '../types/account.js'

type RpcAccountSource = {
  address: string
  sign: (message: Uint8Array) => Promise<Uint8Array>
  signMessage: (message: Uint8Array) => Promise<Uint8Array>
}

export function rpcAccount(source: RpcAccountSource): RpcAccount {
  return {
    type: 'rpc',
    address: source.address,
    sign: source.sign,
    signMessage: source.signMessage,
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/core/test/accounts/rpcAccount.test.ts`
Expected: PASS

- [ ] **Step 6: Write privateKeyToAccount tests**

```ts
// packages/core/test/accounts/privateKeyToAccount.test.ts
import { describe, it, expect } from 'vitest'
import { privateKeyToAccount } from '../../src/accounts/privateKeyToAccount.js'

describe('privateKeyToAccount', () => {
  it('creates a LocalAccount with type local and source privateKey', () => {
    const account = privateKeyToAccount({
      privateKey: 'APrivateKey1zkpFakeKeyForTesting123456789abcdef',
      address: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
      viewKey: 'AViewKey1fakeViewKeyForTesting123456789',
    })

    expect(account.type).toBe('local')
    expect(account.source).toBe('privateKey')
    expect(account.privateKey).toBe('APrivateKey1zkpFakeKeyForTesting123456789abcdef')
    expect(account.address).toBe('aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc')
    expect(account.viewKey).toBe('AViewKey1fakeViewKeyForTesting123456789')
    expect(account.sign).toBeTypeOf('function')
    expect(account.signMessage).toBeTypeOf('function')
  })
})
```

- [ ] **Step 7: Implement privateKeyToAccount**

```ts
// packages/core/src/accounts/privateKeyToAccount.ts
import type { LocalAccount } from '../types/account.js'

type PrivateKeyAccountSource = {
  privateKey: string
  address: string
  viewKey: string
  sign?: (message: Uint8Array) => Promise<Uint8Array>
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>
}

/**
 * Creates a LocalAccount from a private key.
 *
 * Since aleo-viem has no hard dependency on any SDK, the caller must provide
 * the derived address and viewKey. SDK adapter packages (e.g. @aleo-viem/provable)
 * will provide convenience wrappers that derive these automatically.
 */
export function privateKeyToAccount(source: PrivateKeyAccountSource): LocalAccount<'privateKey'> {
  const defaultSign = async (_message: Uint8Array): Promise<Uint8Array> => {
    throw new Error(
      'sign() not implemented. Provide a sign function or use an SDK adapter that implements signing.',
    )
  }

  return {
    type: 'local',
    source: 'privateKey',
    address: source.address,
    privateKey: source.privateKey,
    viewKey: source.viewKey,
    sign: source.sign ?? defaultSign,
    signMessage: source.signMessage ?? defaultSign,
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run packages/core/test/accounts/privateKeyToAccount.test.ts`
Expected: PASS

- [ ] **Step 9: Implement mnemonicToAccount (same pattern)**

```ts
// packages/core/src/accounts/mnemonicToAccount.ts
import type { LocalAccount } from '../types/account.js'

type MnemonicAccountSource = {
  mnemonic: string
  address: string
  privateKey: string
  viewKey: string
  sign?: (message: Uint8Array) => Promise<Uint8Array>
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>
}

/**
 * Creates a LocalAccount from a mnemonic phrase.
 *
 * Like privateKeyToAccount, the caller must provide derived values.
 * SDK adapter packages will provide convenience wrappers.
 */
export function mnemonicToAccount(source: MnemonicAccountSource): LocalAccount<'mnemonic'> {
  const defaultSign = async (_message: Uint8Array): Promise<Uint8Array> => {
    throw new Error(
      'sign() not implemented. Provide a sign function or use an SDK adapter that implements signing.',
    )
  }

  return {
    type: 'local',
    source: 'mnemonic',
    address: source.address,
    privateKey: source.privateKey,
    viewKey: source.viewKey,
    sign: source.sign ?? defaultSign,
    signMessage: source.signMessage ?? defaultSign,
  }
}
```

- [ ] **Step 10: Implement viewOnlyAccount**

```ts
// packages/core/src/accounts/viewOnlyAccount.ts
import type { ViewOnlyAccount } from '../types/account.js'

type ViewOnlyAccountSource = {
  address: string
  viewKey: string
}

export function viewOnlyAccount(source: ViewOnlyAccountSource): ViewOnlyAccount {
  return {
    type: 'viewOnly',
    address: source.address,
    viewKey: source.viewKey,
  }
}
```

- [ ] **Step 11: Write viewOnlyAccount test**

```ts
// packages/core/test/accounts/viewOnlyAccount.test.ts
import { describe, it, expect } from 'vitest'
import { viewOnlyAccount } from '../../src/accounts/viewOnlyAccount.js'

describe('viewOnlyAccount', () => {
  it('creates a ViewOnlyAccount', () => {
    const account = viewOnlyAccount({
      address: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
      viewKey: 'AViewKey1fakeViewKeyForTesting123456789',
    })

    expect(account.type).toBe('viewOnly')
    expect(account.viewKey).toBe('AViewKey1fakeViewKeyForTesting123456789')
    expect(account).not.toHaveProperty('sign')
  })
})
```

- [ ] **Step 12: Run all account tests**

Run: `pnpm vitest run packages/core/test/accounts/`
Expected: All PASS

- [ ] **Step 13: Export accounts from index.ts**

Add to `packages/core/src/index.ts`:

```ts
export { rpcAccount } from './accounts/rpcAccount.js'
export { privateKeyToAccount } from './accounts/privateKeyToAccount.js'
export { mnemonicToAccount } from './accounts/mnemonicToAccount.js'
export { viewOnlyAccount } from './accounts/viewOnlyAccount.js'
export { toAccount } from './accounts/toAccount.js'
```

- [ ] **Step 14: Commit**

```bash
git add packages/core/src/accounts/ packages/core/test/accounts/ packages/core/src/index.ts
git commit -m "feat: add account factories — rpcAccount, privateKeyToAccount, mnemonicToAccount, viewOnlyAccount"
```

---

### Task 8: Public Actions — Individual Action Files

**Files:**
- Create: `packages/core/src/actions/public/getBlockNumber.ts`
- Create: `packages/core/src/actions/public/getBlock.ts`
- Create: `packages/core/src/actions/public/getTransaction.ts`
- Create: `packages/core/src/actions/public/getBalance.ts`
- Create: `packages/core/src/actions/public/readContract.ts`
- Create: `packages/core/src/actions/public/getCode.ts`
- Create: `packages/core/src/actions/public/estimateGas.ts`
- Create: `packages/core/src/actions/public/getRecords.ts`
- Create: `packages/core/src/actions/public/getTransitionViewKeys.ts`
- Create: `packages/core/test/actions/public/getBlockNumber.test.ts`
- Create: `packages/core/test/actions/public/getBalance.test.ts`
- Create: `packages/core/test/actions/public/readContract.test.ts`
- Modify: `packages/core/src/clients/decorators/public.ts`

This task extracts each action into its own file (matching viem's pattern) and wires them into the decorator.

- [ ] **Step 1: Write getBlockNumber test**

```ts
// packages/core/test/actions/public/getBlockNumber.test.ts
import { describe, it, expect, vi } from 'vitest'
import { getBlockNumber } from '../../../src/actions/public/getBlockNumber.js'

describe('getBlockNumber', () => {
  it('returns the latest height as bigint', async () => {
    const client = {
      request: vi.fn().mockResolvedValue(12345),
    } as any

    const result = await getBlockNumber(client)
    expect(result).toBe(12345n)
    expect(client.request).toHaveBeenCalledWith({ method: 'getLatestHeight' })
  })
})
```

- [ ] **Step 2: Implement getBlockNumber**

```ts
// packages/core/src/actions/public/getBlockNumber.ts
import type { Client } from '../../clients/createClient.js'

export type GetBlockNumberReturnType = bigint

export async function getBlockNumber(client: Client): Promise<GetBlockNumberReturnType> {
  const height = await client.request({ method: 'getLatestHeight' })
  return BigInt(height as number)
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `pnpm vitest run packages/core/test/actions/public/getBlockNumber.test.ts`
Expected: PASS

- [ ] **Step 4: Implement remaining public actions**

```ts
// packages/core/src/actions/public/getBlock.ts
import type { Client } from '../../clients/createClient.js'
import type { Block } from '../../types/block.js'

export type GetBlockParameters = { height?: number; hash?: string }
export type GetBlockReturnType = Block

export async function getBlock(client: Client, params: GetBlockParameters): Promise<GetBlockReturnType> {
  if (params.hash) {
    return client.request({ method: 'getBlockByHash', params: { hash: params.hash } }) as Promise<GetBlockReturnType>
  }
  return client.request({ method: 'getBlock', params: { height: params.height } }) as Promise<GetBlockReturnType>
}
```

```ts
// packages/core/src/actions/public/getTransaction.ts
import type { Client } from '../../clients/createClient.js'
import type { Transaction } from '../../types/transaction.js'

export type GetTransactionParameters = { id: string }
export type GetTransactionReturnType = Transaction

export async function getTransaction(client: Client, params: GetTransactionParameters): Promise<GetTransactionReturnType> {
  return client.request({ method: 'getTransaction', params: { id: params.id } }) as Promise<GetTransactionReturnType>
}
```

```ts
// packages/core/src/actions/public/getBalance.ts
import type { Client } from '../../clients/createClient.js'

export type GetBalanceParameters = { address: string }
export type GetBalanceReturnType = bigint

export async function getBalance(client: Client, params: GetBalanceParameters): Promise<GetBalanceReturnType> {
  const value = await client.request({ method: 'getBalance', params: { address: params.address } })
  return BigInt(value as number)
}
```

```ts
// packages/core/src/actions/public/readContract.ts
import type { Client } from '../../clients/createClient.js'

export type ReadContractParameters = { program: string; mapping: string; key: string }
export type ReadContractReturnType = unknown

export async function readContract(client: Client, params: ReadContractParameters): Promise<ReadContractReturnType> {
  return client.request({
    method: 'getMappingValue',
    params: { programId: params.program, mapping: params.mapping, key: params.key },
  })
}
```

```ts
// packages/core/src/actions/public/getCode.ts
import type { Client } from '../../clients/createClient.js'

export type GetCodeParameters = { program: string }
export type GetCodeReturnType = string

export async function getCode(client: Client, params: GetCodeParameters): Promise<GetCodeReturnType> {
  return client.request({ method: 'getProgram', params: { programId: params.program } }) as Promise<string>
}
```

```ts
// packages/core/src/actions/public/estimateGas.ts
import type { Client } from '../../clients/createClient.js'

export type EstimateGasParameters = { program: string; function: string; inputs: string[] }
export type EstimateGasReturnType = bigint

export async function estimateGas(_client: Client, _params: EstimateGasParameters): Promise<EstimateGasReturnType> {
  // Fee estimation on Aleo requires building an authorization first.
  // This will be implemented when proving integration is built out.
  // For now, returns 0n — callers should specify fees explicitly.
  return 0n
}
```

```ts
// packages/core/src/actions/public/getRecords.ts
import type { Client } from '../../clients/createClient.js'
import type { Record } from '../../types/records.js'

export type GetRecordsParameters = { program: string }
export type GetRecordsReturnType = Record[]

export async function getRecords(_client: Client, _params: GetRecordsParameters): Promise<GetRecordsReturnType> {
  return []
}
```

```ts
// packages/core/src/actions/public/getTransitionViewKeys.ts
import type { Client } from '../../clients/createClient.js'

export type GetTransitionViewKeysParameters = { transactionId: string }
export type GetTransitionViewKeysReturnType = string[]

export async function getTransitionViewKeys(
  client: Client,
  params: GetTransitionViewKeysParameters,
): Promise<GetTransitionViewKeysReturnType> {
  return client.request({
    method: 'getTransitionViewKeys',
    params: { id: params.transactionId },
  }) as Promise<string[]>
}
```

- [ ] **Step 5: Write tests for getBalance and readContract**

```ts
// packages/core/test/actions/public/getBalance.test.ts
import { describe, it, expect, vi } from 'vitest'
import { getBalance } from '../../../src/actions/public/getBalance.js'

describe('getBalance', () => {
  it('returns balance as bigint', async () => {
    const client = {
      request: vi.fn().mockResolvedValue(5000000),
    } as any

    const result = await getBalance(client, { address: 'aleo1abc' })
    expect(result).toBe(5000000n)
  })
})
```

```ts
// packages/core/test/actions/public/readContract.test.ts
import { describe, it, expect, vi } from 'vitest'
import { readContract } from '../../../src/actions/public/readContract.js'

describe('readContract', () => {
  it('reads a program mapping value', async () => {
    const client = {
      request: vi.fn().mockResolvedValue('100u64'),
    } as any

    const result = await readContract(client, {
      program: 'credits.aleo',
      mapping: 'account',
      key: 'aleo1abc',
    })

    expect(result).toBe('100u64')
    expect(client.request).toHaveBeenCalledWith({
      method: 'getMappingValue',
      params: { programId: 'credits.aleo', mapping: 'account', key: 'aleo1abc' },
    })
  })
})
```

- [ ] **Step 6: Update public decorator to use individual action files**

Replace `packages/core/src/clients/decorators/public.ts` with:

```ts
// packages/core/src/clients/decorators/public.ts
import { getBlockNumber, type GetBlockNumberReturnType } from '../../actions/public/getBlockNumber.js'
import { getBlock, type GetBlockParameters, type GetBlockReturnType } from '../../actions/public/getBlock.js'
import { getTransaction, type GetTransactionParameters, type GetTransactionReturnType } from '../../actions/public/getTransaction.js'
import { getBalance, type GetBalanceParameters, type GetBalanceReturnType } from '../../actions/public/getBalance.js'
import { readContract, type ReadContractParameters, type ReadContractReturnType } from '../../actions/public/readContract.js'
import { getCode, type GetCodeParameters, type GetCodeReturnType } from '../../actions/public/getCode.js'
import { estimateGas, type EstimateGasParameters, type EstimateGasReturnType } from '../../actions/public/estimateGas.js'
import { getRecords, type GetRecordsParameters, type GetRecordsReturnType } from '../../actions/public/getRecords.js'
import { getTransitionViewKeys, type GetTransitionViewKeysParameters, type GetTransitionViewKeysReturnType } from '../../actions/public/getTransitionViewKeys.js'
import type { Client } from '../createClient.js'

export type PublicActions = {
  getBlockNumber: () => Promise<GetBlockNumberReturnType>
  getBlock: (params: GetBlockParameters) => Promise<GetBlockReturnType>
  getTransaction: (params: GetTransactionParameters) => Promise<GetTransactionReturnType>
  getBalance: (params: GetBalanceParameters) => Promise<GetBalanceReturnType>
  readContract: (params: ReadContractParameters) => Promise<ReadContractReturnType>
  getCode: (params: GetCodeParameters) => Promise<GetCodeReturnType>
  estimateGas: (params: EstimateGasParameters) => Promise<EstimateGasReturnType>
  getRecords: (params: GetRecordsParameters) => Promise<GetRecordsReturnType>
  getTransitionViewKeys: (params: GetTransitionViewKeysParameters) => Promise<GetTransitionViewKeysReturnType>
}

export function publicActions(client: Client): PublicActions {
  return {
    getBlockNumber: () => getBlockNumber(client),
    getBlock: (params) => getBlock(client, params),
    getTransaction: (params) => getTransaction(client, params),
    getBalance: (params) => getBalance(client, params),
    readContract: (params) => readContract(client, params),
    getCode: (params) => getCode(client, params),
    estimateGas: (params) => estimateGas(client, params),
    getRecords: (params) => getRecords(client, params),
    getTransitionViewKeys: (params) => getTransitionViewKeys(client, params),
  }
}
```

- [ ] **Step 7: Run all tests**

Run: `pnpm vitest run`
Expected: All PASS

- [ ] **Step 8: Export actions from index.ts**

Add to `packages/core/src/index.ts`:

```ts
export { getBlockNumber } from './actions/public/getBlockNumber.js'
export { getBlock } from './actions/public/getBlock.js'
export { getTransaction } from './actions/public/getTransaction.js'
export { getBalance } from './actions/public/getBalance.js'
export { readContract } from './actions/public/readContract.js'
export { getCode } from './actions/public/getCode.js'
export { estimateGas } from './actions/public/estimateGas.js'
export { getRecords } from './actions/public/getRecords.js'
export { getTransitionViewKeys } from './actions/public/getTransitionViewKeys.js'
```

- [ ] **Step 9: Add agent tool schemas and handlers for public actions**

Create agent tool schemas for each public action. Each schema describes the tool for AI agents with rich descriptions that explain Aleo concepts via Ethereum analogies.

```ts
// packages/core/src/agent/schemas/public.ts
import type { AgentToolSchema } from '../types.js'

export const publicToolSchemas: AgentToolSchema[] = [
  {
    name: 'aleo_get_block_number',
    description: 'Get the current Aleo chain height. Equivalent to viem\'s getBlockNumber / eth_blockNumber.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'aleo_get_balance',
    description: 'Get the public credits balance for an Aleo address. Equivalent to viem\'s getBalance. Returns structured JSON with the balance in microcredits.',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Aleo address (starts with aleo1...)' },
      },
      required: ['address'],
    },
  },
  {
    name: 'aleo_read_mapping',
    description: 'Read a value from an Aleo program\'s public mapping. Equivalent to viem\'s readContract, but Aleo programs are identified by name (e.g. \'credits.aleo\') not by address. Returns structured JSON with parsed Aleo values.',
    inputSchema: {
      type: 'object',
      properties: {
        program: { type: 'string', description: 'Program ID, e.g. \'credits.aleo\'' },
        mapping: { type: 'string', description: 'Mapping name within the program' },
        key: { type: 'string', description: 'Key to look up' },
      },
      required: ['program', 'mapping', 'key'],
    },
  },
  {
    name: 'aleo_get_block',
    description: 'Fetch an Aleo block by height or hash. Equivalent to viem\'s getBlock.',
    inputSchema: {
      type: 'object',
      properties: {
        height: { type: 'number', description: 'Block height' },
        hash: { type: 'string', description: 'Block hash' },
      },
    },
  },
  {
    name: 'aleo_get_transaction',
    description: 'Fetch an Aleo transaction by ID. Equivalent to viem\'s getTransaction.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Transaction ID (starts with at1...)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'aleo_get_program_source',
    description: 'Fetch the source code of a deployed Aleo program. Equivalent to viem\'s getCode, but returns Leo/Aleo source rather than bytecode.',
    inputSchema: {
      type: 'object',
      properties: {
        program: { type: 'string', description: 'Program ID, e.g. \'token.aleo\'' },
      },
      required: ['program'],
    },
  },
  {
    name: 'aleo_describe_program',
    description: 'Fetch and parse an Aleo program, returning its functions (with input types) and mappings (with key/value types). Use this to discover what a program can do before calling it.',
    inputSchema: {
      type: 'object',
      properties: {
        program: { type: 'string', description: 'Program ID, e.g. \'token.aleo\'' },
      },
      required: ['program'],
    },
  },
]
```

```ts
// packages/core/src/agent/handlers/public.ts
import type { Client } from '../../clients/createClient.js'
import type { PublicClient } from '../../clients/createPublicClient.js'
import { parseValue } from '../../utils/values.js'
import { parseProgram } from '../../contract/parseProgram.js'

export function createPublicHandlers(client: PublicClient) {
  return {
    aleo_get_block_number: async () => {
      const height = await client.getBlockNumber()
      return { height: Number(height) }
    },
    aleo_get_balance: async (params: { address: string }) => {
      const balance = await client.getBalance({ address: params.address })
      return { address: params.address, balance: Number(balance), unit: 'microcredits' }
    },
    aleo_read_mapping: async (params: { program: string; mapping: string; key: string }) => {
      const raw = await client.readContract(params)
      const parsed = parseValue(String(raw))
      return { raw: String(raw), ...parsed }
    },
    aleo_get_block: async (params: { height?: number; hash?: string }) => {
      return client.getBlock(params)
    },
    aleo_get_transaction: async (params: { id: string }) => {
      return client.getTransaction(params)
    },
    aleo_get_program_source: async (params: { program: string }) => {
      const source = await client.getCode(params)
      return { program: params.program, source }
    },
    aleo_describe_program: async (params: { program: string }) => {
      const source = await client.getCode(params)
      const parsed = parseProgram(source)
      return {
        id: parsed.id,
        functions: parsed.functions.map((fn) => ({
          name: fn,
          inputs: parsed.functionInputs[fn] ?? [],
        })),
        mappings: parsed.mappings.map((m) => ({
          name: m,
          ...(parsed.mappingTypes[m] ?? {}),
        })),
      }
    },
  }
}
```

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/actions/public/ packages/core/test/actions/ packages/core/src/clients/decorators/public.ts packages/core/src/agent/ packages/core/src/index.ts
git commit -m "feat: add public actions with agent tool schemas — getBlockNumber, getBalance, readContract, getBlock, getTransaction, getCode, describeProgram"
```

---

### Task 9: Wallet Actions — Individual Action Files

**Files:**
- Create: `packages/core/src/actions/wallet/sendTransaction.ts`
- Create: `packages/core/src/actions/wallet/writeContract.ts`
- Create: `packages/core/src/actions/wallet/deployContract.ts`
- Create: `packages/core/src/actions/wallet/signMessage.ts`
- Create: `packages/core/src/actions/wallet/transfer.ts`
- Create: `packages/core/src/actions/wallet/decrypt.ts`
- Create: `packages/core/src/actions/wallet/requestRecords.ts`
- Create: `packages/core/test/actions/wallet/sendTransaction.test.ts`
- Create: `packages/core/test/actions/wallet/writeContract.test.ts`
- Create: `packages/core/test/actions/wallet/signMessage.test.ts`
- Create: `packages/core/test/actions/wallet/transfer.test.ts`
- Modify: `packages/core/src/clients/decorators/wallet.ts`

- [ ] **Step 1: Write sendTransaction test**

```ts
// packages/core/test/actions/wallet/sendTransaction.test.ts
import { describe, it, expect, vi } from 'vitest'
import { sendTransaction } from '../../../src/actions/wallet/sendTransaction.js'

describe('sendTransaction', () => {
  it('broadcasts a raw transaction string', async () => {
    const client = {
      request: vi.fn().mockResolvedValue('at1txid123'),
    } as any

    const result = await sendTransaction(client, { transaction: '{"id":"at1..."}' })
    expect(result).toBe('at1txid123')
    expect(client.request).toHaveBeenCalledWith({
      method: 'sendTransaction',
      params: { transaction: '{"id":"at1..."}' },
    })
  })
})
```

- [ ] **Step 2: Implement sendTransaction**

```ts
// packages/core/src/actions/wallet/sendTransaction.ts
import type { Client } from '../../clients/createClient.js'

export type SendTransactionParameters = { transaction: string }
export type SendTransactionReturnType = string

export async function sendTransaction(
  client: Client,
  params: SendTransactionParameters,
): Promise<SendTransactionReturnType> {
  return client.request({
    method: 'sendTransaction',
    params: { transaction: params.transaction },
  }) as Promise<string>
}
```

- [ ] **Step 3: Write writeContract test**

```ts
// packages/core/test/actions/wallet/writeContract.test.ts
import { describe, it, expect, vi } from 'vitest'
import { writeContract } from '../../../src/actions/wallet/writeContract.js'

describe('writeContract', () => {
  it('uses custom buildTransaction when proving config has one', async () => {
    const mockTx = { id: 'at1built' }
    const client = {
      account: { type: 'local', sign: vi.fn(), signMessage: vi.fn() },
      proving: { mode: 'delegated', buildTransaction: vi.fn().mockResolvedValue(mockTx) },
      request: vi.fn().mockResolvedValue('at1sent'),
    } as any

    const result = await writeContract(client, {
      program: 'my_program.aleo',
      function: 'transfer',
      inputs: ['aleo1abc', '100u64'],
      fee: 1000n,
    })

    expect(client.proving.buildTransaction).toHaveBeenCalledWith({
      programName: 'my_program.aleo',
      functionName: 'transfer',
      inputs: ['aleo1abc', '100u64'],
      fee: 1000n,
      privateFee: undefined,
    })
    expect(result).toBe('at1sent')
  })

  it('delegates to RPC when no proving config', async () => {
    const client = {
      account: { type: 'rpc', sign: vi.fn(), signMessage: vi.fn() },
      proving: undefined,
      request: vi.fn().mockResolvedValue('at1rpc'),
    } as any

    const result = await writeContract(client, {
      program: 'my_program.aleo',
      function: 'transfer',
      inputs: ['aleo1abc', '100u64'],
      fee: 1000n,
    })

    expect(client.request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({ programName: 'my_program.aleo' }),
    })
    expect(result).toBe('at1rpc')
  })
})
```

- [ ] **Step 4: Implement writeContract (with executeTransaction alias export)**

```ts
// packages/core/src/actions/wallet/writeContract.ts
import type { Client } from '../../clients/createClient.js'
import { AccountNotFoundError } from '../../errors/errors.js'

export type WriteContractParameters = {
  program: string
  function: string
  inputs: string[]
  fee: bigint
  privateFee?: boolean | undefined
}
export type WriteContractReturnType = string

export async function writeContract(
  client: Client,
  params: WriteContractParameters,
): Promise<WriteContractReturnType> {
  if (!client.account || !('sign' in client.account)) {
    throw new AccountNotFoundError()
  }

  // If proving config has a custom buildTransaction, use it
  if (client.proving?.buildTransaction) {
    const tx = await client.proving.buildTransaction({
      programName: params.program,
      functionName: params.function,
      inputs: params.inputs,
      fee: params.fee,
      privateFee: params.privateFee,
    })
    return client.request({
      method: 'sendTransaction',
      params: { transaction: JSON.stringify(tx) },
    }) as Promise<string>
  }

  // Delegate to the transport (wallet handles proving)
  return client.request({
    method: 'executeTransaction',
    params: {
      programName: params.program,
      functionName: params.function,
      inputs: params.inputs,
      fee: params.fee,
      privateFee: params.privateFee,
    },
  }) as Promise<string>
}

/** Alias for writeContract — consistent with Aleo wallet adapter terminology */
export const executeTransaction = writeContract
```

- [ ] **Step 5: Implement remaining wallet actions**

```ts
// packages/core/src/actions/wallet/deployContract.ts
import type { Client } from '../../clients/createClient.js'

export type DeployContractParameters = { program: string; fee: bigint }
export type DeployContractReturnType = string

export async function deployContract(
  client: Client,
  params: DeployContractParameters,
): Promise<DeployContractReturnType> {
  return client.request({
    method: 'deployProgram',
    params: { program: params.program, fee: params.fee },
  }) as Promise<string>
}
```

```ts
// packages/core/src/actions/wallet/signMessage.ts
import type { Client } from '../../clients/createClient.js'
import { AccountNotFoundError } from '../../errors/errors.js'
import type { SignerAccount } from '../../types/account.js'

export type SignMessageParameters = { message: Uint8Array }
export type SignMessageReturnType = Uint8Array

export async function signMessage(
  client: Client,
  params: SignMessageParameters,
): Promise<SignMessageReturnType> {
  if (!client.account || !('signMessage' in client.account)) {
    throw new AccountNotFoundError()
  }
  return (client.account as SignerAccount).signMessage(params.message)
}
```

```ts
// packages/core/src/actions/wallet/transfer.ts
import type { Client } from '../../clients/createClient.js'
import { writeContract } from './writeContract.js'

export type TransferParameters = {
  to: string
  amount: bigint
  privateFee?: boolean | undefined
  fee?: bigint | undefined
}
export type TransferReturnType = string

export async function transfer(
  client: Client,
  params: TransferParameters,
): Promise<TransferReturnType> {
  return writeContract(client, {
    program: 'credits.aleo',
    function: params.privateFee ? 'transfer_private' : 'transfer_public',
    inputs: [params.to, `${params.amount}u64`],
    fee: params.fee ?? 0n,
    privateFee: params.privateFee,
  })
}
```

```ts
// packages/core/src/actions/wallet/decrypt.ts
import type { Client } from '../../clients/createClient.js'

export type DecryptParameters = { ciphertext: string }
export type DecryptReturnType = string

export async function decrypt(
  client: Client,
  params: DecryptParameters,
): Promise<DecryptReturnType> {
  return client.request({
    method: 'decrypt',
    params: { ciphertext: params.ciphertext },
  }) as Promise<string>
}
```

```ts
// packages/core/src/actions/wallet/requestRecords.ts
import type { Client } from '../../clients/createClient.js'
import type { Record } from '../../types/records.js'

export type RequestRecordsParameters = { program: string }
export type RequestRecordsReturnType = Record[]

export async function requestRecords(
  client: Client,
  params: RequestRecordsParameters,
): Promise<RequestRecordsReturnType> {
  return client.request({
    method: 'requestRecords',
    params: { program: params.program },
  }) as Promise<Record[]>
}
```

- [ ] **Step 6: Write signMessage and transfer tests**

```ts
// packages/core/test/actions/wallet/signMessage.test.ts
import { describe, it, expect, vi } from 'vitest'
import { signMessage } from '../../../src/actions/wallet/signMessage.js'

describe('signMessage', () => {
  it('delegates to account signMessage', async () => {
    const sig = new Uint8Array([1, 2, 3])
    const client = {
      account: { type: 'local', signMessage: vi.fn().mockResolvedValue(sig), sign: vi.fn() },
    } as any

    const result = await signMessage(client, { message: new Uint8Array([7, 8, 9]) })
    expect(result).toBe(sig)
  })

  it('throws when no account', async () => {
    const client = { account: undefined } as any
    await expect(signMessage(client, { message: new Uint8Array() })).rejects.toThrow()
  })
})
```

```ts
// packages/core/test/actions/wallet/transfer.test.ts
import { describe, it, expect, vi } from 'vitest'
import { transfer } from '../../../src/actions/wallet/transfer.js'

describe('transfer', () => {
  it('calls writeContract with credits.aleo transfer_public', async () => {
    const client = {
      account: { type: 'rpc', sign: vi.fn(), signMessage: vi.fn() },
      proving: undefined,
      request: vi.fn().mockResolvedValue('at1tx'),
    } as any

    await transfer(client, { to: 'aleo1dest', amount: 1000000n })

    expect(client.request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        programName: 'credits.aleo',
        functionName: 'transfer_public',
      }),
    })
  })
})
```

- [ ] **Step 7: Update wallet decorator to use individual action files**

Replace `packages/core/src/clients/decorators/wallet.ts` with:

```ts
// packages/core/src/clients/decorators/wallet.ts
import { sendTransaction, type SendTransactionParameters, type SendTransactionReturnType } from '../../actions/wallet/sendTransaction.js'
import { writeContract, type WriteContractParameters, type WriteContractReturnType } from '../../actions/wallet/writeContract.js'
import { deployContract, type DeployContractParameters, type DeployContractReturnType } from '../../actions/wallet/deployContract.js'
import { signMessage, type SignMessageParameters, type SignMessageReturnType } from '../../actions/wallet/signMessage.js'
import { transfer, type TransferParameters, type TransferReturnType } from '../../actions/wallet/transfer.js'
import { decrypt, type DecryptParameters, type DecryptReturnType } from '../../actions/wallet/decrypt.js'
import { requestRecords, type RequestRecordsParameters, type RequestRecordsReturnType } from '../../actions/wallet/requestRecords.js'
import type { Client } from '../createClient.js'

export type WalletActions = {
  sendTransaction: (params: SendTransactionParameters) => Promise<SendTransactionReturnType>
  writeContract: (params: WriteContractParameters) => Promise<WriteContractReturnType>
  /** Alias for writeContract — consistent with Aleo wallet adapter terminology */
  executeTransaction: (params: WriteContractParameters) => Promise<WriteContractReturnType>
  deployContract: (params: DeployContractParameters) => Promise<DeployContractReturnType>
  signMessage: (params: SignMessageParameters) => Promise<SignMessageReturnType>
  transfer: (params: TransferParameters) => Promise<TransferReturnType>
  decrypt: (params: DecryptParameters) => Promise<DecryptReturnType>
  requestRecords: (params: RequestRecordsParameters) => Promise<RequestRecordsReturnType>
}

export function walletActions(client: Client): WalletActions {
  const writeContractFn = (params: WriteContractParameters) => writeContract(client, params)

  return {
    sendTransaction: (params) => sendTransaction(client, params),
    writeContract: writeContractFn,
    executeTransaction: writeContractFn,
    deployContract: (params) => deployContract(client, params),
    signMessage: (params) => signMessage(client, params),
    transfer: (params) => transfer(client, params),
    decrypt: (params) => decrypt(client, params),
    requestRecords: (params) => requestRecords(client, params),
  }
}
```

- [ ] **Step 8: Export wallet actions from index.ts**

Add to `packages/core/src/index.ts`:

```ts
export { sendTransaction } from './actions/wallet/sendTransaction.js'
export { writeContract, executeTransaction } from './actions/wallet/writeContract.js'
export { deployContract } from './actions/wallet/deployContract.js'
export { signMessage } from './actions/wallet/signMessage.js'
export { transfer } from './actions/wallet/transfer.js'
export { decrypt } from './actions/wallet/decrypt.js'
export { requestRecords } from './actions/wallet/requestRecords.js'
```

- [ ] **Step 9: Run all tests**

Run: `pnpm vitest run`
Expected: All PASS

- [ ] **Step 10: Add agent tool schemas and handlers for wallet actions**

```ts
// packages/core/src/agent/schemas/wallet.ts
import type { AgentToolSchema } from '../types.js'

export const walletToolSchemas: AgentToolSchema[] = [
  {
    name: 'aleo_execute',
    description: 'Execute a transition on an Aleo program. Equivalent to viem\'s writeContract. Requires a connected wallet. The wallet handles proving internally. Returns a transaction ID.',
    inputSchema: {
      type: 'object',
      properties: {
        program: { type: 'string', description: 'Program ID, e.g. \'token.aleo\'' },
        function: { type: 'string', description: 'Function name to execute' },
        inputs: { type: 'array', items: { type: 'string' }, description: 'Function inputs as Aleo-encoded strings, e.g. [\'aleo1...\', \'100u64\']' },
        fee: { type: 'number', description: 'Fee in microcredits. If omitted, uses a default estimate.' },
      },
      required: ['program', 'function', 'inputs'],
    },
  },
  {
    name: 'aleo_deploy',
    description: 'Deploy an Aleo program to the network. Equivalent to viem\'s deployContract. Requires a connected wallet.',
    inputSchema: {
      type: 'object',
      properties: {
        program: { type: 'string', description: 'Program source code to deploy' },
        fee: { type: 'number', description: 'Fee in microcredits' },
      },
      required: ['program', 'fee'],
    },
  },
  {
    name: 'aleo_transfer',
    description: 'Transfer Aleo credits to an address. Convenience wrapper around credits.aleo/transfer_public. Equivalent to a simple ETH transfer in viem.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient Aleo address' },
        amount: { type: 'number', description: 'Amount in microcredits' },
      },
      required: ['to', 'amount'],
    },
  },
  {
    name: 'aleo_send_transaction',
    description: 'Broadcast an already-built transaction to the network. Equivalent to viem\'s sendRawTransaction.',
    inputSchema: {
      type: 'object',
      properties: {
        transaction: { type: 'string', description: 'Serialized transaction JSON' },
      },
      required: ['transaction'],
    },
  },
  {
    name: 'aleo_wait_for_transaction',
    description: 'Wait for a transaction to be confirmed or rejected. Equivalent to viem\'s waitForTransactionReceipt. Polls until the transaction appears in a block.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Transaction ID to wait for' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 60000)' },
      },
      required: ['id'],
    },
  },
]
```

```ts
// packages/core/src/agent/handlers/wallet.ts
import type { WalletClient } from '../../clients/createWalletClient.js'
import type { PublicClient } from '../../clients/createPublicClient.js'

export function createWalletHandlers(walletClient: WalletClient, publicClient?: PublicClient) {
  return {
    aleo_execute: async (params: { program: string; function: string; inputs: string[]; fee?: number }) => {
      const txId = await walletClient.writeContract({
        program: params.program,
        function: params.function,
        inputs: params.inputs,
        fee: BigInt(params.fee ?? 0),
      })
      return { transactionId: txId }
    },
    aleo_deploy: async (params: { program: string; fee: number }) => {
      const txId = await walletClient.deployContract({
        program: params.program,
        fee: BigInt(params.fee),
      })
      return { transactionId: txId }
    },
    aleo_transfer: async (params: { to: string; amount: number }) => {
      const txId = await walletClient.transfer({
        to: params.to,
        amount: BigInt(params.amount),
      })
      return { transactionId: txId }
    },
    aleo_send_transaction: async (params: { transaction: string }) => {
      const txId = await walletClient.sendTransaction(params)
      return { transactionId: txId }
    },
    aleo_wait_for_transaction: async (params: { id: string; timeout?: number }) => {
      // Poll getTransaction until found or timeout
      const timeout = params.timeout ?? 60_000
      const start = Date.now()
      while (Date.now() - start < timeout) {
        try {
          if (!publicClient) throw new Error('Public client required for waitForTransaction')
          const tx = await publicClient.getTransaction({ id: params.id })
          if (tx) return { status: 'confirmed', transaction: tx }
        } catch {
          // Not found yet, keep polling
        }
        await new Promise((r) => setTimeout(r, 3000))
      }
      return { status: 'timeout', transactionId: params.id }
    },
  }
}
```

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/actions/wallet/ packages/core/test/actions/wallet/ packages/core/src/clients/decorators/wallet.ts packages/core/src/agent/ packages/core/src/index.ts
git commit -m "feat: add wallet actions with agent tool schemas — writeContract/executeTransaction, deploy, transfer, sendTransaction, waitForTransaction"
```

---

### Task 10: Contract Instance — getContract & parseProgram

**Files:**
- Create: `packages/core/src/contract/parseProgram.ts`
- Create: `packages/core/src/contract/getContract.ts`
- Create: `packages/core/test/contract/parseProgram.test.ts`
- Create: `packages/core/test/contract/getContract.test.ts`

- [ ] **Step 1: Write parseProgram tests**

```ts
// packages/core/test/contract/parseProgram.test.ts
import { describe, it, expect } from 'vitest'
import { parseProgram } from '../../src/contract/parseProgram.js'

const SAMPLE_PROGRAM = `
program token.aleo;

mapping balances:
    key as address.public;
    value as u64.public;

mapping metadata:
    key as field.public;
    value as u128.public;

function transfer:
    input r0 as address.private;
    input r1 as u64.private;

function mint:
    input r0 as address.private;
    input r1 as u64.private;

function burn:
    input r0 as u64.private;
`

describe('parseProgram', () => {
  it('extracts program id', () => {
    const parsed = parseProgram(SAMPLE_PROGRAM)
    expect(parsed.id).toBe('token.aleo')
  })

  it('extracts mapping names', () => {
    const parsed = parseProgram(SAMPLE_PROGRAM)
    expect(parsed.mappings).toEqual(['balances', 'metadata'])
  })

  it('extracts function names', () => {
    const parsed = parseProgram(SAMPLE_PROGRAM)
    expect(parsed.functions).toEqual(['transfer', 'mint', 'burn'])
  })

  it('extracts function input types', () => {
    const parsed = parseProgram(SAMPLE_PROGRAM)
    expect(parsed.functionInputs['transfer']).toEqual([
      { name: 'r0', type: 'address', visibility: 'private' },
      { name: 'r1', type: 'u64', visibility: 'private' },
    ])
  })

  it('extracts mapping key/value types', () => {
    const parsed = parseProgram(SAMPLE_PROGRAM)
    expect(parsed.mappingTypes['balances']).toEqual({
      key: { type: 'address', visibility: 'public' },
      value: { type: 'u64', visibility: 'public' },
    })
  })
})
```

- [ ] **Step 2: Implement parseProgram**

```ts
// packages/core/src/contract/parseProgram.ts

export type FunctionInput = {
  name: string
  type: string
  visibility: 'public' | 'private'
}

export type MappingType = {
  key: { type: string; visibility: string }
  value: { type: string; visibility: string }
}

export type ParsedProgram = {
  id: string
  source: string
  mappings: string[]
  functions: string[]
  functionInputs: Record<string, FunctionInput[]>
  mappingTypes: Record<string, MappingType>
}

export function parseProgram(source: string): ParsedProgram {
  const lines = source.split('\n').map((l) => l.trim())

  // Extract program ID
  const programLine = lines.find((l) => l.startsWith('program '))
  const id = programLine?.replace('program ', '').replace(';', '') ?? ''

  // Extract mappings
  const mappings: string[] = []
  const mappingTypes: Record<string, MappingType> = {}
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^mapping (\w+):$/)
    if (match) {
      const name = match[1]
      mappings.push(name)
      const keyLine = lines[i + 1]?.match(/key as (\w+)\.(\w+);/)
      const valueLine = lines[i + 2]?.match(/value as (\w+)\.(\w+);/)
      if (keyLine && valueLine) {
        mappingTypes[name] = {
          key: { type: keyLine[1], visibility: keyLine[2] },
          value: { type: valueLine[1], visibility: valueLine[2] },
        }
      }
    }
  }

  // Extract functions and their inputs
  const functions: string[] = []
  const functionInputs: Record<string, FunctionInput[]> = {}
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^function (\w+):$/)
    if (match) {
      const name = match[1]
      functions.push(name)
      const inputs: FunctionInput[] = []
      for (let j = i + 1; j < lines.length; j++) {
        const inputMatch = lines[j].match(/^input (\w+) as (\w+)\.(\w+);$/)
        if (inputMatch) {
          inputs.push({
            name: inputMatch[1],
            type: inputMatch[2],
            visibility: inputMatch[3] as 'public' | 'private',
          })
        } else if (lines[j] && !lines[j].startsWith('input ')) {
          break
        }
      }
      functionInputs[name] = inputs
    }
  }

  return { id, source, mappings, functions, functionInputs, mappingTypes }
}
```

- [ ] **Step 3: Run parseProgram test**

Run: `pnpm vitest run packages/core/test/contract/parseProgram.test.ts`
Expected: PASS

- [ ] **Step 4: Write getContract tests**

```ts
// packages/core/test/contract/getContract.test.ts
import { describe, it, expect, vi } from 'vitest'
import { getContract } from '../../src/contract/getContract.js'

const SAMPLE_PROGRAM = `
program token.aleo;

mapping balances:
    key as address.public;
    value as u64.public;

function transfer:
    input r0 as address.private;
    input r1 as u64.private;

function mint:
    input r0 as address.private;
    input r1 as u64.private;
`

describe('getContract', () => {
  it('creates a contract instance with read methods from public client', () => {
    const publicClient = {
      request: vi.fn().mockResolvedValue('100u64'),
      readContract: vi.fn().mockResolvedValue('100u64'),
    } as any

    const contract = getContract({
      programSource: SAMPLE_PROGRAM,
      client: publicClient,
    })

    expect(contract.read.balances).toBeTypeOf('function')
    expect(contract.program.id).toBe('token.aleo')
  })

  it('creates a contract instance with write methods from wallet client', () => {
    const walletClient = {
      request: vi.fn().mockResolvedValue('at1tx'),
      writeContract: vi.fn().mockResolvedValue('at1tx'),
    } as any

    const contract = getContract({
      programSource: SAMPLE_PROGRAM,
      client: { wallet: walletClient },
    })

    expect(contract.write.transfer).toBeTypeOf('function')
    expect(contract.write.mint).toBeTypeOf('function')
  })

  it('creates a contract with both read and write from keyed clients', () => {
    const publicClient = {
      readContract: vi.fn().mockResolvedValue('100u64'),
    } as any
    const walletClient = {
      writeContract: vi.fn().mockResolvedValue('at1tx'),
    } as any

    const contract = getContract({
      programSource: SAMPLE_PROGRAM,
      client: { public: publicClient, wallet: walletClient },
    })

    expect(contract.read.balances).toBeTypeOf('function')
    expect(contract.write.transfer).toBeTypeOf('function')
  })

  it('read calls readContract on the public client', async () => {
    const publicClient = {
      readContract: vi.fn().mockResolvedValue('100u64'),
    } as any

    const contract = getContract({
      programSource: SAMPLE_PROGRAM,
      client: publicClient,
    })

    const result = await contract.read.balances({ key: 'aleo1abc' })
    expect(result).toBe('100u64')
    expect(publicClient.readContract).toHaveBeenCalledWith({
      program: 'token.aleo',
      mapping: 'balances',
      key: 'aleo1abc',
    })
  })

  it('write calls writeContract on the wallet client', async () => {
    const walletClient = {
      writeContract: vi.fn().mockResolvedValue('at1tx'),
    } as any

    const contract = getContract({
      programSource: SAMPLE_PROGRAM,
      client: { wallet: walletClient },
    })

    await contract.write.transfer({ inputs: ['aleo1abc', '100u64'], fee: 1000n })
    expect(walletClient.writeContract).toHaveBeenCalledWith({
      program: 'token.aleo',
      function: 'transfer',
      inputs: ['aleo1abc', '100u64'],
      fee: 1000n,
    })
  })
})
```

- [ ] **Step 5: Implement getContract**

```ts
// packages/core/src/contract/getContract.ts
import { parseProgram, type ParsedProgram } from './parseProgram.js'

type ReadMethods = Record<string, (params: { key: string }) => Promise<unknown>>
type WriteMethods = Record<string, (params: { inputs: string[]; fee: bigint; privateFee?: boolean }) => Promise<string>>

type PublicClientLike = {
  readContract: (params: { program: string; mapping: string; key: string }) => Promise<unknown>
}

type WalletClientLike = {
  writeContract: (params: { program: string; function: string; inputs: string[]; fee: bigint; privateFee?: boolean }) => Promise<string>
}

type ClientParam =
  | PublicClientLike
  | WalletClientLike
  | { public?: PublicClientLike; wallet?: WalletClientLike }

type ContractInstance = {
  program: ParsedProgram
  read: ReadMethods
  write: WriteMethods
}

export type GetContractParameters = {
  programSource: string
  client: ClientParam
}

function isPublicClient(client: ClientParam): client is PublicClientLike {
  return 'readContract' in client
}

function isWalletClient(client: ClientParam): client is WalletClientLike {
  return 'writeContract' in client
}

function isKeyedClient(client: ClientParam): client is { public?: PublicClientLike; wallet?: WalletClientLike } {
  return 'public' in client || 'wallet' in client
}

export function getContract(params: GetContractParameters): ContractInstance {
  const program = parseProgram(params.programSource)
  const { client } = params

  let publicClient: PublicClientLike | undefined
  let walletClient: WalletClientLike | undefined

  if (isKeyedClient(client)) {
    publicClient = client.public
    walletClient = client.wallet
  } else if (isPublicClient(client)) {
    publicClient = client
  } else if (isWalletClient(client)) {
    walletClient = client
  }

  // Build read methods from mappings
  const read: ReadMethods = {}
  if (publicClient) {
    for (const mapping of program.mappings) {
      read[mapping] = (readParams: { key: string }) =>
        publicClient!.readContract({
          program: program.id,
          mapping,
          key: readParams.key,
        })
    }
  }

  // Build write methods from functions
  const write: WriteMethods = {}
  if (walletClient) {
    for (const fn of program.functions) {
      write[fn] = (writeParams: { inputs: string[]; fee: bigint; privateFee?: boolean }) =>
        walletClient!.writeContract({
          program: program.id,
          function: fn,
          inputs: writeParams.inputs,
          fee: writeParams.fee,
          privateFee: writeParams.privateFee,
        })
    }
  }

  return { program, read, write }
}
```

- [ ] **Step 6: Run all contract tests**

Run: `pnpm vitest run packages/core/test/contract/`
Expected: All PASS

- [ ] **Step 7: Export from index.ts**

Add to `packages/core/src/index.ts`:

```ts
export { getContract } from './contract/getContract.js'
export { parseProgram } from './contract/parseProgram.js'
```

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/contract/ packages/core/test/contract/ packages/core/src/index.ts
git commit -m "feat: add getContract and parseProgram — typed contract instances from program source"
```

---

### Task 11: Agent Tooling — Entry Points, MCP Server, aleoAgentTools

**Files:**
- Create: `packages/core/src/agent/types.ts`
- Create: `packages/core/src/agent/index.ts`
- Create: `packages/core/src/mcp/index.ts`
- Create: `packages/core/src/mcp/tools.ts`
- Create: `packages/core/test/agent/schemas.test.ts`
- Create: `packages/core/test/agent/handlers.test.ts`
- Create: `packages/core/test/mcp/tools.test.ts`

This task wires together all the agent tool schemas and handlers from Tasks 8-10 into the `@aleo-viem/core/agent` and `@aleo-viem/core/mcp` subpath exports.

- [ ] **Step 1: Create agent tool types**

```ts
// packages/core/src/agent/types.ts

export type AgentToolSchema = {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export type AgentToolHandler = (params: any) => Promise<unknown>

export type AgentTool = {
  schema: AgentToolSchema
  handler: AgentToolHandler
}
```

- [ ] **Step 2: Create agent entry point**

```ts
// packages/core/src/agent/index.ts
import type { PublicClient } from '../clients/createPublicClient.js'
import type { WalletClient } from '../clients/createWalletClient.js'
import type { AgentTool, AgentToolSchema } from './types.js'
import { publicToolSchemas } from './schemas/public.js'
import { walletToolSchemas } from './schemas/wallet.js'
import { createPublicHandlers } from './handlers/public.js'
import { createWalletHandlers } from './handlers/wallet.js'

export type AleoAgentToolsConfig = {
  client?: PublicClient
  walletClient?: WalletClient
}

/**
 * Returns agent tool definitions with execution handlers.
 * Framework-agnostic — works with LangChain, Vercel AI SDK, or any tool-calling system.
 */
export function aleoAgentTools(config: AleoAgentToolsConfig): AgentTool[] {
  const tools: AgentTool[] = []

  if (config.client) {
    const handlers = createPublicHandlers(config.client)
    for (const schema of publicToolSchemas) {
      const handler = handlers[schema.name as keyof typeof handlers]
      if (handler) tools.push({ schema, handler })
    }
  }

  if (config.walletClient) {
    const handlers = createWalletHandlers(config.walletClient, config.client)
    for (const schema of walletToolSchemas) {
      const handler = handlers[schema.name as keyof typeof handlers]
      if (handler) tools.push({ schema, handler })
    }
  }

  return tools
}

/** Export all schemas for consumers that only need the definitions */
export function aleoAgentToolSchemas(): AgentToolSchema[] {
  return [...publicToolSchemas, ...walletToolSchemas]
}

export type { AgentTool, AgentToolSchema, AgentToolHandler } from './types.js'
```

- [ ] **Step 3: Create MCP server entry point**

```ts
// packages/core/src/mcp/index.ts
import type { PublicClient } from '../clients/createPublicClient.js'
import type { WalletClient } from '../clients/createWalletClient.js'
import { aleoAgentTools } from '../agent/index.js'

export type McpServerConfig = {
  client?: PublicClient
  walletClient?: WalletClient
}

/**
 * Creates an MCP server that exposes aleo-viem actions as tools.
 * MCP SDK is imported lazily to keep it out of the main bundle.
 */
export async function createMcpServer(config: McpServerConfig) {
  // Dynamic import — MCP SDK is only loaded when this subpath is used
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')

  const server = new McpServer({
    name: 'aleo-viem',
    version: '0.0.1',
  })

  const tools = aleoAgentTools(config)

  for (const tool of tools) {
    server.tool(
      tool.schema.name,
      tool.schema.description,
      tool.schema.inputSchema.properties,
      async (params: any) => {
        const result = await tool.handler(params)
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      },
    )
  }

  const transport = new StdioServerTransport()
  await server.connect(transport)
  return server
}
```

- [ ] **Step 4: Write agent tools integration test**

```ts
// packages/core/test/agent/handlers.test.ts
import { describe, it, expect, vi } from 'vitest'
import { aleoAgentTools } from '../../src/agent/index.js'

describe('aleoAgentTools', () => {
  it('creates public tools when client is provided', () => {
    const client = {
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getBalance: vi.fn().mockResolvedValue(5000000n),
      readContract: vi.fn().mockResolvedValue('100u64'),
      getBlock: vi.fn(),
      getTransaction: vi.fn(),
      getCode: vi.fn().mockResolvedValue('program test.aleo;'),
      estimateGas: vi.fn(),
      getRecords: vi.fn(),
      getTransitionViewKeys: vi.fn(),
    } as any

    const tools = aleoAgentTools({ client })
    const names = tools.map((t) => t.schema.name)

    expect(names).toContain('aleo_get_block_number')
    expect(names).toContain('aleo_get_balance')
    expect(names).toContain('aleo_read_mapping')
    expect(names).toContain('aleo_describe_program')
  })

  it('creates wallet tools when walletClient is provided', () => {
    const walletClient = {
      writeContract: vi.fn().mockResolvedValue('at1tx'),
      deployContract: vi.fn(),
      transfer: vi.fn(),
      sendTransaction: vi.fn(),
    } as any

    const tools = aleoAgentTools({ walletClient })
    const names = tools.map((t) => t.schema.name)

    expect(names).toContain('aleo_execute')
    expect(names).toContain('aleo_transfer')
    expect(names).toContain('aleo_deploy')
  })

  it('handlers return structured JSON', async () => {
    const client = {
      getBlockNumber: vi.fn().mockResolvedValue(12345n),
      getBalance: vi.fn().mockResolvedValue(5000000n),
      readContract: vi.fn().mockResolvedValue('100u64'),
      getBlock: vi.fn(),
      getTransaction: vi.fn(),
      getCode: vi.fn(),
      estimateGas: vi.fn(),
      getRecords: vi.fn(),
      getTransitionViewKeys: vi.fn(),
    } as any

    const tools = aleoAgentTools({ client })
    const getBalance = tools.find((t) => t.schema.name === 'aleo_get_balance')!
    const result = await getBalance.handler({ address: 'aleo1abc' })

    expect(result).toEqual({
      address: 'aleo1abc',
      balance: 5000000,
      unit: 'microcredits',
    })
  })
})
```

- [ ] **Step 5: Run all tests**

Run: `pnpm vitest run`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agent/ packages/core/src/mcp/ packages/core/test/agent/ packages/core/test/mcp/
git commit -m "feat: add agent tooling — aleoAgentTools entry point, MCP server, structured JSON output"
```

---

### Task 12: Integration Tests — Full Client Usage

**Files:**
- Create: `packages/core/test/integration/publicClient.test.ts`
- Create: `packages/core/test/integration/walletClient.test.ts`
- Create: `packages/core/test/integration/contract.test.ts`

- [ ] **Step 1: Write public client integration test**

```ts
// packages/core/test/integration/publicClient.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createPublicClient } from '../../src/clients/createPublicClient.js'
import { custom } from '../../src/transports/custom.js'

describe('PublicClient integration', () => {
  it('creates a client and calls public actions', async () => {
    const mockRequest = vi.fn()
      .mockResolvedValueOnce(12345)       // getBlockNumber -> getLatestHeight
      .mockResolvedValueOnce(5000000)     // getBalance
      .mockResolvedValueOnce('100u64')    // readContract -> getMappingValue

    const client = createPublicClient({
      transport: custom({ request: mockRequest }),
    })

    const height = await client.getBlockNumber()
    expect(height).toBe(12345n)

    const balance = await client.getBalance({ address: 'aleo1abc' })
    expect(balance).toBe(5000000n)

    const value = await client.readContract({
      program: 'credits.aleo',
      mapping: 'account',
      key: 'aleo1abc',
    })
    expect(value).toBe('100u64')
  })

  it('extends with custom actions', async () => {
    const client = createPublicClient({
      transport: custom({ request: vi.fn().mockResolvedValue('ok') }),
    })

    const extended = client.extend(() => ({
      customAction: () => 'hello',
    }))

    expect(extended.customAction()).toBe('hello')
    expect(extended.getBlockNumber).toBeTypeOf('function')
  })
})
```

- [ ] **Step 2: Write wallet client integration test**

```ts
// packages/core/test/integration/walletClient.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createWalletClient } from '../../src/clients/createWalletClient.js'
import { custom } from '../../src/transports/custom.js'
import { rpcAccount } from '../../src/accounts/rpcAccount.js'

describe('WalletClient integration', () => {
  it('creates a wallet client with RPC account and executes actions', async () => {
    const mockRequest = vi.fn().mockResolvedValue('at1txid')
    const account = rpcAccount({
      address: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
      sign: vi.fn().mockResolvedValue(new Uint8Array([1])),
      signMessage: vi.fn().mockResolvedValue(new Uint8Array([2])),
    })

    const client = createWalletClient({
      account,
      transport: custom({ request: mockRequest }),
    })

    const txId = await client.writeContract({
      program: 'my_program.aleo',
      function: 'do_stuff',
      inputs: ['aleo1abc', '42u64'],
      fee: 500n,
    })
    expect(txId).toBe('at1txid')

    // executeTransaction is an alias — same result
    const txId2 = await client.executeTransaction({
      program: 'my_program.aleo',
      function: 'do_stuff',
      inputs: ['aleo1abc', '42u64'],
      fee: 500n,
    })
    expect(txId2).toBe('at1txid')

    const sig = await client.signMessage({ message: new Uint8Array([3, 4, 5]) })
    expect(sig).toEqual(new Uint8Array([2]))
  })

  it('creates a wallet client with local account and proving config', async () => {
    const mockTx = { id: 'at1built' }
    const mockRequest = vi.fn().mockResolvedValue('at1broadcasted')

    const client = createWalletClient({
      account: {
        type: 'local',
        source: 'privateKey',
        address: 'aleo1abc',
        privateKey: 'APrivateKey1...',
        viewKey: 'AViewKey1...',
        sign: vi.fn(),
        signMessage: vi.fn(),
      },
      transport: custom({ request: mockRequest }),
      proving: {
        mode: 'delegated',
        url: 'https://prover.example.com',
        buildTransaction: vi.fn().mockResolvedValue(mockTx),
      },
    })

    await client.writeContract({
      program: 'test.aleo',
      function: 'run',
      inputs: ['1u64'],
      fee: 100n,
    })

    expect(client.proving?.buildTransaction).toHaveBeenCalled()
    expect(mockRequest).toHaveBeenCalledWith({
      method: 'sendTransaction',
      params: { transaction: JSON.stringify(mockTx) },
    })
  })
})
```

- [ ] **Step 3: Write contract integration test**

```ts
// packages/core/test/integration/contract.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createPublicClient } from '../../src/clients/createPublicClient.js'
import { createWalletClient } from '../../src/clients/createWalletClient.js'
import { custom } from '../../src/transports/custom.js'
import { rpcAccount } from '../../src/accounts/rpcAccount.js'
import { getContract } from '../../src/contract/getContract.js'

const TOKEN_PROGRAM = `
program token.aleo;

mapping balances:
    key as address.public;
    value as u64.public;

function transfer:
    input r0 as address.private;
    input r1 as u64.private;
`

describe('getContract integration', () => {
  it('reads a mapping and writes a function through contract instance', async () => {
    const publicClient = createPublicClient({
      transport: custom({ request: vi.fn().mockResolvedValue('500u64') }),
    })

    const walletClient = createWalletClient({
      account: rpcAccount({
        address: 'aleo1abc',
        sign: vi.fn(),
        signMessage: vi.fn(),
      }),
      transport: custom({ request: vi.fn().mockResolvedValue('at1tx') }),
    })

    const contract = getContract({
      programSource: TOKEN_PROGRAM,
      client: { public: publicClient, wallet: walletClient },
    })

    const balance = await contract.read.balances({ key: 'aleo1abc' })
    expect(balance).toBe('500u64')

    const txId = await contract.write.transfer({
      inputs: ['aleo1dest', '100u64'],
      fee: 1000n,
    })
    expect(txId).toBe('at1tx')
  })
})
```

- [ ] **Step 4: Run all tests**

Run: `pnpm vitest run`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/test/integration/
git commit -m "test: add integration tests for PublicClient, WalletClient, and getContract"
```

---

### Task 13: Build Verification & Final Barrel Export

**Files:**
- Modify: `packages/core/src/index.ts` (verify completeness)

- [ ] **Step 1: Verify the full barrel export is complete**

Read `packages/core/src/index.ts` and ensure every public type, function, and class is exported. The final file should export:

- All types from `types/` (Account, SignerAccount, LocalAccount, RpcAccount, ViewOnlyAccount, AnyAccount, Transport, TransportConfig, RequestFn, ProvingConfig, BuildTransactionOptions, RecordsConfig, RecordSearchParams, Record, Block, ConfirmedTransaction, Transaction, Transition, Program, MappingValue)
- All errors from `errors/`
- All utilities from `utils/`
- All transports: `createTransport`, `http`, `custom`, `fallback`
- All clients: `createClient`, `createPublicClient`, `createWalletClient`
- All account factories: `rpcAccount`, `privateKeyToAccount`, `mnemonicToAccount`, `viewOnlyAccount`, `toAccount`
- All public actions individually
- All wallet actions individually (including `executeTransaction` alias)
- `getContract`, `parseProgram`
- `parseValue`, `encodeValue`
- `PublicActions` and `WalletActions` types
- Subpath `@aleo-viem/core/agent` exports: `aleoAgentTools`, `aleoAgentToolSchemas`, `AgentTool`, `AgentToolSchema`
- Subpath `@aleo-viem/core/mcp` exports: `createMcpServer`

- [ ] **Step 2: Run the build**

Run: `cd /Users/privacydaddy/dev/aleo-viem && pnpm build`
Expected: Build succeeds, `packages/core/dist/` contains `index.js`, `index.d.ts`, `agent/index.js`, `agent/index.d.ts`, `mcp/index.js`, `mcp/index.d.ts`.

- [ ] **Step 3: Run type check**

Run: `pnpm typecheck`
Expected: No type errors.

- [ ] **Step 4: Run full test suite**

Run: `pnpm vitest run`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "chore: verify build, types, and full test suite pass"
```

---

## Summary

| Task | What it builds | Depends on |
|------|---------------|------------|
| 1 | Monorepo scaffold, tooling | — |
| 2 | Core types (Account, Transport, ProvingConfig, RecordsConfig, Block, Transaction, Program) | 1 |
| 3 | Utilities (address, credits, uid) | 1 |
| 4 | Error types | 1 |
| 5 | Transport layer (http, custom, fallback) | 2, 4 |
| 6 | Client layer (createClient, createPublicClient, createWalletClient with proving config) | 2, 3, 4, 5 |
| 7 | Account factories (rpcAccount, privateKeyToAccount, mnemonicToAccount, viewOnlyAccount) | 2 |
| 8 | Public actions (9 actions + agent tool schemas/handlers) | 2, 3, 6 |
| 9 | Wallet actions (7 actions + executeTransaction alias + agent tool schemas/handlers) | 2, 3, 4, 6, 7 |
| 10 | Contract instance (getContract, parseProgram) | 6, 8, 9 |
| 11 | Agent tooling entry points (aleoAgentTools, MCP server, subpath exports) | 8, 9, 10 |
| 12 | Integration tests | All above |
| 13 | Build verification (including agent/mcp subpath exports) | All above |
