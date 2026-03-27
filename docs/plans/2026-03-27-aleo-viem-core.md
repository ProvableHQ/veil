# aleo-viem Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@aleo-viem/core` — a viem-like TypeScript interface for Aleo that wraps existing wallets and SDKs behind a unified, familiar API.

**Architecture:** Interface-first design mirroring viem's Client → Transport → Actions pattern. Core defines interfaces (Transport, Account, Prover, RecordScanner) with zero hard dependencies on specific SDKs. Actions are standalone functions decorated onto clients. Uses viem method names wherever concepts map.

**Tech Stack:** TypeScript, vitest, pnpm workspaces, tsup (bundling)

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
│   │   ├── account.ts                    # AleoAccount, AleoLocalAccount, AleoRpcAccount, AleoViewOnlyAccount
│   │   ├── transport.ts                  # AleoTransport, AleoTransportConfig
│   │   ├── prover.ts                     # AleoProver, BuildTransactionOptions
│   │   ├── recordScanner.ts              # AleoRecordScanner, RecordSearchParams, AleoRecord
│   │   ├── block.ts                      # AleoBlock
│   │   ├── transaction.ts                # AleoTransaction, AleoTransition
│   │   └── program.ts                    # AleoProgram, MappingValue
│   ├── clients/
│   │   ├── createClient.ts               # Base client factory
│   │   ├── createPublicClient.ts         # PublicClient = base + publicActions
│   │   ├── createWalletClient.ts         # WalletClient = base + walletActions
│   │   └── decorators/
│   │       ├── public.ts                 # publicActions decorator
│   │       └── wallet.ts                 # walletActions decorator
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
│   │       ├── writeContract.ts         # Execute program transition
│   │       ├── deployContract.ts        # Deploy program
│   │       ├── signMessage.ts           # Sign arbitrary message
│   │       ├── transfer.ts             # credits.aleo convenience
│   │       ├── decrypt.ts              # Decrypt ciphertext (Aleo-native)
│   │       └── requestRecords.ts       # Request records (Aleo-native)
│   ├── errors/
│   │   └── errors.ts                    # Error types
│   └── utils/
│       ├── address.ts                   # Aleo address validation
│       ├── uid.ts                       # Unique ID generator
│       └── credits.ts                   # Microcredits <-> credits conversion
└── test/
    ├── types/
    │   ├── account.test.ts
    │   ├── transport.test.ts
    │   ├── prover.test.ts
    │   └── recordScanner.test.ts
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
    └── utils/
        ├── address.test.ts
        └── credits.test.ts
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
  entry: ['src/index.ts'],
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

### Task 2: Core Types — Account, Transport, Prover, RecordScanner

**Files:**
- Create: `packages/core/src/types/account.ts`
- Create: `packages/core/src/types/transport.ts`
- Create: `packages/core/src/types/prover.ts`
- Create: `packages/core/src/types/recordScanner.ts`
- Create: `packages/core/src/types/block.ts`
- Create: `packages/core/src/types/transaction.ts`
- Create: `packages/core/src/types/program.ts`
- Create: `packages/core/test/types/account.test.ts`
- Create: `packages/core/test/types/transport.test.ts`
- Create: `packages/core/test/types/prover.test.ts`
- Create: `packages/core/test/types/recordScanner.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write account type tests**

```ts
// packages/core/test/types/account.test.ts
import { describe, it, expectTypeOf } from 'vitest'
import type {
  AleoAccount,
  AleoLocalAccount,
  AleoRpcAccount,
  AleoViewOnlyAccount,
} from '../../src/types/account.js'

describe('Account types', () => {
  it('AleoAccount has address and optional viewKey', () => {
    expectTypeOf<AleoAccount>().toHaveProperty('address')
    expectTypeOf<AleoAccount['address']>().toBeString()
    expectTypeOf<AleoAccount>().toHaveProperty('viewKey')
  })

  it('AleoLocalAccount has type local and privateKey', () => {
    expectTypeOf<AleoLocalAccount['type']>().toEqualTypeOf<'local'>()
    expectTypeOf<AleoLocalAccount>().toHaveProperty('privateKey')
    expectTypeOf<AleoLocalAccount>().toHaveProperty('viewKey')
    expectTypeOf<AleoLocalAccount['viewKey']>().toBeString()
    expectTypeOf<AleoLocalAccount>().toHaveProperty('sign')
    expectTypeOf<AleoLocalAccount>().toHaveProperty('signMessage')
  })

  it('AleoRpcAccount has type rpc', () => {
    expectTypeOf<AleoRpcAccount['type']>().toEqualTypeOf<'rpc'>()
    expectTypeOf<AleoRpcAccount>().toHaveProperty('sign')
    expectTypeOf<AleoRpcAccount>().toHaveProperty('signMessage')
  })

  it('AleoViewOnlyAccount has type viewOnly and required viewKey', () => {
    expectTypeOf<AleoViewOnlyAccount['type']>().toEqualTypeOf<'viewOnly'>()
    expectTypeOf<AleoViewOnlyAccount['viewKey']>().toBeString()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/privacydaddy/dev/aleo-viem && pnpm vitest run packages/core/test/types/account.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement account types**

```ts
// packages/core/src/types/account.ts

/** Base account — all accounts have an address */
export type AleoAccount = {
  address: string
  viewKey?: string | undefined
}

/** Account that can sign — either locally or via RPC */
export type AleoSignableAccount = AleoAccount & {
  sign(message: Uint8Array): Promise<Uint8Array>
  signMessage(message: Uint8Array): Promise<Uint8Array>
}

/** Local account — has private key material, signs locally */
export type AleoLocalAccount<source extends string = string> = AleoSignableAccount & {
  type: 'local'
  source: source
  privateKey: string
  viewKey: string
}

/** RPC account — signing delegated to external provider */
export type AleoRpcAccount = AleoSignableAccount & {
  type: 'rpc'
}

/** View-only account — can decrypt records, cannot sign */
export type AleoViewOnlyAccount = AleoAccount & {
  type: 'viewOnly'
  viewKey: string
}

/** Union of all account types */
export type Account = AleoLocalAccount | AleoRpcAccount | AleoViewOnlyAccount
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/test/types/account.test.ts`
Expected: PASS

- [ ] **Step 5: Write transport type tests**

```ts
// packages/core/test/types/transport.test.ts
import { describe, it, expectTypeOf } from 'vitest'
import type { AleoTransportConfig, AleoRequestFn } from '../../src/types/transport.js'

describe('Transport types', () => {
  it('AleoTransportConfig has required fields', () => {
    expectTypeOf<AleoTransportConfig>().toHaveProperty('key')
    expectTypeOf<AleoTransportConfig>().toHaveProperty('name')
    expectTypeOf<AleoTransportConfig>().toHaveProperty('request')
    expectTypeOf<AleoTransportConfig>().toHaveProperty('type')
  })

  it('AleoRequestFn takes method and params', () => {
    expectTypeOf<AleoRequestFn>().toBeFunction()
    expectTypeOf<AleoRequestFn>().parameter(0).toHaveProperty('method')
  })
})
```

- [ ] **Step 6: Implement transport types**

```ts
// packages/core/src/types/transport.ts

export type AleoRequestFn = (args: {
  method: string
  params?: unknown
}) => Promise<unknown>

export type AleoTransportConfig<type extends string = string> = {
  key: string
  name: string
  request: AleoRequestFn
  type: type
  retryCount?: number | undefined
  retryDelay?: number | undefined
  timeout?: number | undefined
}

export type AleoTransport<type extends string = string> = {
  config: AleoTransportConfig<type>
  request: AleoRequestFn
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm vitest run packages/core/test/types/transport.test.ts`
Expected: PASS

- [ ] **Step 8: Write prover and record scanner type tests**

```ts
// packages/core/test/types/prover.test.ts
import { describe, it, expectTypeOf } from 'vitest'
import type { AleoProver } from '../../src/types/prover.js'

describe('Prover types', () => {
  it('AleoProver has buildTransaction method', () => {
    expectTypeOf<AleoProver>().toHaveProperty('buildTransaction')
  })
})
```

```ts
// packages/core/test/types/recordScanner.test.ts
import { describe, it, expectTypeOf } from 'vitest'
import type { AleoRecordScanner } from '../../src/types/recordScanner.js'

describe('RecordScanner types', () => {
  it('AleoRecordScanner has getRecords method', () => {
    expectTypeOf<AleoRecordScanner>().toHaveProperty('getRecords')
  })
})
```

- [ ] **Step 9: Implement prover, recordScanner, and data types**

```ts
// packages/core/src/types/prover.ts
import type { AleoTransaction } from './transaction.js'

export type BuildTransactionOptions = {
  programName: string
  functionName: string
  inputs: string[]
  fee: bigint
  privateFee?: boolean | undefined
  feeRecord?: string | undefined
}

export type AleoProver = {
  buildTransaction(options: BuildTransactionOptions): Promise<AleoTransaction>
}
```

```ts
// packages/core/src/types/recordScanner.ts

export type RecordSearchParams = {
  program: string
  account?: { viewKey: string } | undefined
  unspent?: boolean | undefined
}

export type AleoRecord = {
  owner: string
  data: Record<string, unknown>
  nonce: string
  programId: string
  plaintext: string
}

export type AleoRecordScanner = {
  getRecords(params: RecordSearchParams): Promise<AleoRecord[]>
}
```

```ts
// packages/core/src/types/block.ts

export type AleoBlock = {
  blockHash: string
  previousHash: string
  header: Record<string, unknown>
  authority: Record<string, unknown>
  transactions?: AleoConfirmedTransaction[] | undefined
  height: number
  round: number
  timestamp: number
}

export type AleoConfirmedTransaction = {
  type: 'execute' | 'deploy' | 'fee'
  id: string
  transaction: Record<string, unknown>
}
```

```ts
// packages/core/src/types/transaction.ts

export type AleoTransaction = {
  id: string
  type: 'execute' | 'deploy' | 'fee'
  execution?: {
    transitions: AleoTransition[]
  } | undefined
  deployment?: Record<string, unknown> | undefined
  fee: {
    transition: AleoTransition
    globalStateRoot: string
    proof: string
  }
}

export type AleoTransition = {
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

export type AleoProgram = {
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

- [ ] **Step 10: Run all type tests**

Run: `pnpm vitest run packages/core/test/types/`
Expected: All PASS

- [ ] **Step 11: Export types from index.ts**

```ts
// packages/core/src/index.ts
export type {
  AleoAccount,
  AleoSignableAccount,
  AleoLocalAccount,
  AleoRpcAccount,
  AleoViewOnlyAccount,
  Account,
} from './types/account.js'

export type {
  AleoRequestFn,
  AleoTransportConfig,
  AleoTransport,
} from './types/transport.js'

export type {
  AleoProver,
  BuildTransactionOptions,
} from './types/prover.js'

export type {
  AleoRecordScanner,
  RecordSearchParams,
  AleoRecord,
} from './types/recordScanner.js'

export type { AleoBlock, AleoConfirmedTransaction } from './types/block.js'
export type { AleoTransaction, AleoTransition } from './types/transaction.js'
export type { AleoProgram, MappingValue } from './types/program.js'
```

- [ ] **Step 12: Commit**

```bash
git add packages/core/src/types/ packages/core/test/types/ packages/core/src/index.ts
git commit -m "feat: add core type definitions for account, transport, prover, recordScanner, block, transaction, program"
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
import { isAleoAddress, assertAleoAddress } from '../../src/utils/address.js'

describe('isAleoAddress', () => {
  it('returns true for valid aleo address', () => {
    // Aleo addresses are "aleo1" + 58 lowercase alphanumeric chars
    expect(isAleoAddress('aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc')).toBe(true)
  })

  it('returns false for empty string', () => {
    expect(isAleoAddress('')).toBe(false)
  })

  it('returns false for ethereum address', () => {
    expect(isAleoAddress('0xA0Cf798816D4b9b9866b5330EEa46a18382f251e')).toBe(false)
  })

  it('returns false for missing aleo1 prefix', () => {
    expect(isAleoAddress('qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc')).toBe(false)
  })
})

describe('assertAleoAddress', () => {
  it('throws for invalid address', () => {
    expect(() => assertAleoAddress('bad')).toThrow()
  })

  it('does not throw for valid address', () => {
    expect(() => assertAleoAddress('aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc')).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/test/utils/address.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement address validation**

```ts
// packages/core/src/utils/address.ts

const ALEO_ADDRESS_REGEX = /^aleo1[a-z0-9]{58}$/

export function isAleoAddress(address: string): boolean {
  return ALEO_ADDRESS_REGEX.test(address)
}

export function assertAleoAddress(address: string): void {
  if (!isAleoAddress(address)) {
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

- [ ] **Step 9: Export utils from index.ts**

Add to `packages/core/src/index.ts`:

```ts
export { isAleoAddress, assertAleoAddress } from './utils/address.js'
export { creditsToMicrocredits, microcreditsToCredits } from './utils/credits.js'
```

- [ ] **Step 10: Run all tests**

Run: `pnpm vitest run`
Expected: All PASS

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/utils/ packages/core/test/utils/ packages/core/src/index.ts
git commit -m "feat: add address validation, credits conversion, and uid utilities"
```

---

### Task 4: Errors

**Files:**
- Create: `packages/core/src/errors/errors.ts`

- [ ] **Step 1: Implement error classes**

```ts
// packages/core/src/errors/errors.ts

export class AleoError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AleoError'
  }
}

export class TransportError extends AleoError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TransportError'
  }
}

export class AccountNotFoundError extends AleoError {
  constructor() {
    super('No account found. Pass an account to the client or to the action directly.')
    this.name = 'AccountNotFoundError'
  }
}

export class ProverNotFoundError extends AleoError {
  constructor() {
    super('No prover configured. Pass a prover to the client or use a wallet-backed account.')
    this.name = 'ProverNotFoundError'
  }
}

export class InvalidAddressError extends AleoError {
  constructor(address: string) {
    super(`Invalid Aleo address: ${address}`)
    this.name = 'InvalidAddressError'
  }
}
```

- [ ] **Step 2: Export errors from index.ts**

Add to `packages/core/src/index.ts`:

```ts
export {
  AleoError,
  TransportError,
  AccountNotFoundError,
  ProverNotFoundError,
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
import type { AleoRequestFn, AleoTransport, AleoTransportConfig } from '../types/transport.js'

export function createTransport<type extends string>(
  config: AleoTransportConfig<type>,
): AleoTransport<type> {
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
import type { AleoTransport } from '../types/transport.js'
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
): AleoTransport<'http'> {
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
import type { AleoRequestFn, AleoTransport } from '../types/transport.js'
import { createTransport } from './createTransport.js'

type CustomTransportConfig = {
  request: AleoRequestFn
  key?: string | undefined
  name?: string | undefined
}

export function custom(config: CustomTransportConfig): AleoTransport<'custom'> {
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
import type { AleoTransport } from '../types/transport.js'
import { createTransport } from './createTransport.js'

export function fallback(transports: AleoTransport[]): AleoTransport<'fallback'> {
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

  it('stores prover and records if provided', () => {
    const transport = custom({ request: vi.fn() })
    const mockProver = { buildTransaction: vi.fn() }
    const mockRecords = { getRecords: vi.fn() }
    const client = createClient({ transport, prover: mockProver, records: mockRecords })

    expect(client.prover).toBe(mockProver)
    expect(client.records).toBe(mockRecords)
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
import type { Account } from '../types/account.js'
import type { AleoProver } from '../types/prover.js'
import type { AleoRecordScanner } from '../types/recordScanner.js'
import type { AleoTransport } from '../types/transport.js'
import { uid as createUid } from '../utils/uid.js'

export type ClientConfig = {
  account?: Account | undefined
  key?: string | undefined
  name?: string | undefined
  prover?: AleoProver | undefined
  records?: AleoRecordScanner | undefined
  transport: AleoTransport
}

export type Client = {
  account: Account | undefined
  key: string
  name: string
  prover: AleoProver | undefined
  records: AleoRecordScanner | undefined
  request: AleoTransport['request']
  transport: AleoTransport
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
    prover,
    records,
    transport,
  } = config

  const uid = createUid()

  const client: Client = {
    account,
    key,
    name,
    prover,
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
      // Fee estimation requires an authorization — this is a placeholder that
      // will be refined when the prover integration is built out.
      // For now, returns 0n to satisfy the interface.
      Promise.resolve(0n),
    getRecords: (params) =>
      client.records
        ? client.records.getRecords({ program: params.program })
        : Promise.resolve([]),
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

export type PublicClientConfig = Omit<ClientConfig, 'account' | 'key' | 'name'> & {
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
    expect(client.deployContract).toBeTypeOf('function')
    expect(client.signMessage).toBeTypeOf('function')
    expect(client.transfer).toBeTypeOf('function')
  })
})
```

- [ ] **Step 10: Create wallet actions decorator (stub)**

```ts
// packages/core/src/clients/decorators/wallet.ts
import { AccountNotFoundError } from '../../errors/errors.js'
import type { AleoSignableAccount } from '../../types/account.js'
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
  deployContract: (params: { program: string; fee: bigint }) => Promise<string>
  signMessage: (params: { message: Uint8Array }) => Promise<Uint8Array>
  transfer: (params: { to: string; amount: bigint; privateFee?: boolean }) => Promise<string>
  decrypt: (params: { ciphertext: string }) => Promise<string>
  requestRecords: (params: { program: string }) => Promise<unknown[]>
}

function getSignableAccount(client: Client): AleoSignableAccount {
  if (!client.account || !('sign' in client.account)) {
    throw new AccountNotFoundError()
  }
  return client.account as AleoSignableAccount
}

export function walletActions(client: Client): WalletActions {
  return {
    sendTransaction: (params) =>
      client.request({
        method: 'sendTransaction',
        params: { transaction: params.transaction },
      }) as Promise<string>,

    writeContract: (params) => {
      const account = getSignableAccount(client)
      // If client has a prover, use it to build then send
      if (client.prover) {
        return client.prover
          .buildTransaction({
            programName: params.program,
            functionName: params.function,
            inputs: params.inputs,
            fee: params.fee,
            privateFee: params.privateFee,
          })
          .then((tx) =>
            client.request({
              method: 'sendTransaction',
              params: { transaction: JSON.stringify(tx) },
            }) as Promise<string>,
          )
      }
      // For RPC accounts, delegate to the wallet
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
    },

    deployContract: (params) =>
      client.request({
        method: 'deployProgram',
        params: { program: params.program, fee: params.fee },
      }) as Promise<string>,

    signMessage: async (params) => {
      const account = getSignableAccount(client)
      return account.signMessage(params.message)
    },

    transfer: (params) => {
      const account = getSignableAccount(client)
      if (client.prover) {
        return client.prover
          .buildTransaction({
            programName: 'credits.aleo',
            functionName: params.privateFee ? 'transfer_private' : 'transfer_public',
            inputs: [params.to, `${params.amount}u64`],
            fee: 0n,
            privateFee: params.privateFee,
          })
          .then((tx) =>
            client.request({
              method: 'sendTransaction',
              params: { transaction: JSON.stringify(tx) },
            }) as Promise<string>,
          )
      }
      return client.request({
        method: 'executeTransaction',
        params: {
          programName: 'credits.aleo',
          functionName: params.privateFee ? 'transfer_private' : 'transfer_public',
          inputs: [params.to, `${params.amount}u64`],
          fee: 0n,
        },
      }) as Promise<string>
    },

    decrypt: (params) =>
      client.request({
        method: 'decrypt',
        params: { ciphertext: params.ciphertext },
      }) as Promise<string>,

    requestRecords: (params) =>
      client.records
        ? client.records.getRecords({ program: params.program })
        : client.request({
            method: 'requestRecords',
            params: { program: params.program },
          }) as Promise<unknown[]>,
  }
}
```

- [ ] **Step 11: Implement createWalletClient**

```ts
// packages/core/src/clients/createWalletClient.ts
import { createClient, type ClientConfig, type Client } from './createClient.js'
import { walletActions, type WalletActions } from './decorators/wallet.js'

export type WalletClientConfig = ClientConfig & {
  key?: string | undefined
  name?: string | undefined
}

export type WalletClient = Client & WalletActions

export function createWalletClient(config: WalletClientConfig): WalletClient {
  const { key = 'wallet', name = 'Wallet Client', ...rest } = config
  const client = createClient({ ...rest, key, name })
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
export { createWalletClient, type WalletClient, type WalletClientConfig } from './clients/createWalletClient.js'
export type { PublicActions } from './clients/decorators/public.js'
export type { WalletActions } from './clients/decorators/wallet.js'
```

- [ ] **Step 14: Commit**

```bash
git add packages/core/src/clients/ packages/core/test/clients/ packages/core/src/index.ts
git commit -m "feat: add client layer — createClient, createPublicClient, createWalletClient with decorators"
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
import type { AleoLocalAccount, AleoRpcAccount, AleoViewOnlyAccount } from '../types/account.js'

export type ToAccountSource = {
  address: string
  viewKey?: string | undefined
  sign?: (message: Uint8Array) => Promise<Uint8Array>
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>
}

export function toAccount(source: ToAccountSource & { type: 'rpc' }): AleoRpcAccount
export function toAccount(source: ToAccountSource & { type: 'viewOnly'; viewKey: string }): AleoViewOnlyAccount
export function toAccount(source: ToAccountSource & { type: 'local'; privateKey: string; viewKey: string; source: string }): AleoLocalAccount
export function toAccount(source: any): any {
  return source
}
```

- [ ] **Step 4: Implement rpcAccount**

```ts
// packages/core/src/accounts/rpcAccount.ts
import type { AleoRpcAccount } from '../types/account.js'

type RpcAccountSource = {
  address: string
  viewKey?: string | undefined
  sign: (message: Uint8Array) => Promise<Uint8Array>
  signMessage: (message: Uint8Array) => Promise<Uint8Array>
}

export function rpcAccount(source: RpcAccountSource): AleoRpcAccount {
  return {
    type: 'rpc',
    address: source.address,
    viewKey: source.viewKey,
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
    // privateKeyToAccount requires an SDK implementation to derive address/viewKey.
    // Without an SDK, it accepts pre-derived values.
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
import type { AleoLocalAccount } from '../types/account.js'

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
export function privateKeyToAccount(source: PrivateKeyAccountSource): AleoLocalAccount<'privateKey'> {
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
import type { AleoLocalAccount } from '../types/account.js'

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
export function mnemonicToAccount(source: MnemonicAccountSource): AleoLocalAccount<'mnemonic'> {
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
import type { AleoViewOnlyAccount } from '../types/account.js'

type ViewOnlyAccountSource = {
  address: string
  viewKey: string
}

export function viewOnlyAccount(source: ViewOnlyAccountSource): AleoViewOnlyAccount {
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
import type { AleoBlock } from '../../types/block.js'

export type GetBlockParameters = { height?: number; hash?: string }
export type GetBlockReturnType = AleoBlock

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
import type { AleoTransaction } from '../../types/transaction.js'

export type GetTransactionParameters = { id: string }
export type GetTransactionReturnType = AleoTransaction

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
  // This will be implemented when prover integration is built out.
  // For now, returns 0n — callers should specify fees explicitly.
  return 0n
}
```

```ts
// packages/core/src/actions/public/getRecords.ts
import type { Client } from '../../clients/createClient.js'
import type { AleoRecord } from '../../types/recordScanner.js'

export type GetRecordsParameters = { program: string }
export type GetRecordsReturnType = AleoRecord[]

export async function getRecords(client: Client, params: GetRecordsParameters): Promise<GetRecordsReturnType> {
  if (client.records) {
    return client.records.getRecords({ program: params.program })
  }
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

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/actions/public/ packages/core/test/actions/ packages/core/src/clients/decorators/public.ts packages/core/src/index.ts
git commit -m "feat: add public actions — getBlockNumber, getBlock, getTransaction, getBalance, readContract, getCode, estimateGas, getRecords, getTransitionViewKeys"
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
  it('uses prover when available', async () => {
    const mockTx = { id: 'at1built' }
    const client = {
      account: { type: 'local', sign: vi.fn(), signMessage: vi.fn() },
      prover: { buildTransaction: vi.fn().mockResolvedValue(mockTx) },
      request: vi.fn().mockResolvedValue('at1sent'),
    } as any

    const result = await writeContract(client, {
      program: 'my_program.aleo',
      function: 'transfer',
      inputs: ['aleo1abc', '100u64'],
      fee: 1000n,
    })

    expect(client.prover.buildTransaction).toHaveBeenCalledWith({
      programName: 'my_program.aleo',
      functionName: 'transfer',
      inputs: ['aleo1abc', '100u64'],
      fee: 1000n,
      privateFee: undefined,
    })
    expect(result).toBe('at1sent')
  })

  it('delegates to RPC when no prover', async () => {
    const client = {
      account: { type: 'rpc', sign: vi.fn(), signMessage: vi.fn() },
      prover: undefined,
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

- [ ] **Step 4: Implement writeContract**

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

  if (client.prover) {
    const tx = await client.prover.buildTransaction({
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
import type { AleoSignableAccount } from '../../types/account.js'

export type SignMessageParameters = { message: Uint8Array }
export type SignMessageReturnType = Uint8Array

export async function signMessage(
  client: Client,
  params: SignMessageParameters,
): Promise<SignMessageReturnType> {
  if (!client.account || !('signMessage' in client.account)) {
    throw new AccountNotFoundError()
  }
  return (client.account as AleoSignableAccount).signMessage(params.message)
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
import type { AleoRecord } from '../../types/recordScanner.js'

export type RequestRecordsParameters = { program: string }
export type RequestRecordsReturnType = AleoRecord[]

export async function requestRecords(
  client: Client,
  params: RequestRecordsParameters,
): Promise<RequestRecordsReturnType> {
  if (client.records) {
    return client.records.getRecords({ program: params.program })
  }
  return client.request({
    method: 'requestRecords',
    params: { program: params.program },
  }) as Promise<AleoRecord[]>
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
      prover: undefined,
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
  deployContract: (params: DeployContractParameters) => Promise<DeployContractReturnType>
  signMessage: (params: SignMessageParameters) => Promise<SignMessageReturnType>
  transfer: (params: TransferParameters) => Promise<TransferReturnType>
  decrypt: (params: DecryptParameters) => Promise<DecryptReturnType>
  requestRecords: (params: RequestRecordsParameters) => Promise<RequestRecordsReturnType>
}

export function walletActions(client: Client): WalletActions {
  return {
    sendTransaction: (params) => sendTransaction(client, params),
    writeContract: (params) => writeContract(client, params),
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
export { writeContract } from './actions/wallet/writeContract.js'
export { deployContract } from './actions/wallet/deployContract.js'
export { signMessage } from './actions/wallet/signMessage.js'
export { transfer } from './actions/wallet/transfer.js'
export { decrypt } from './actions/wallet/decrypt.js'
export { requestRecords } from './actions/wallet/requestRecords.js'
```

- [ ] **Step 9: Run all tests**

Run: `pnpm vitest run`
Expected: All PASS

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/actions/wallet/ packages/core/test/actions/wallet/ packages/core/src/clients/decorators/wallet.ts packages/core/src/index.ts
git commit -m "feat: add wallet actions — sendTransaction, writeContract, deployContract, signMessage, transfer, decrypt, requestRecords"
```

---

### Task 10: Integration Test — Full Client Usage

**Files:**
- Create: `packages/core/test/integration/publicClient.test.ts`
- Create: `packages/core/test/integration/walletClient.test.ts`

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

    const sig = await client.signMessage({ message: new Uint8Array([3, 4, 5]) })
    expect(sig).toEqual(new Uint8Array([2]))
  })

  it('creates a wallet client with prover and builds transactions', async () => {
    const mockTx = { id: 'at1built' }
    const mockProver = { buildTransaction: vi.fn().mockResolvedValue(mockTx) }
    const mockRequest = vi.fn().mockResolvedValue('at1broadcasted')

    const client = createWalletClient({
      account: rpcAccount({
        address: 'aleo1abc',
        sign: vi.fn(),
        signMessage: vi.fn(),
      }),
      transport: custom({ request: mockRequest }),
      prover: mockProver,
    })

    await client.writeContract({
      program: 'test.aleo',
      function: 'run',
      inputs: ['1u64'],
      fee: 100n,
    })

    expect(mockProver.buildTransaction).toHaveBeenCalled()
    expect(mockRequest).toHaveBeenCalledWith({
      method: 'sendTransaction',
      params: { transaction: JSON.stringify(mockTx) },
    })
  })
})
```

- [ ] **Step 3: Run all tests**

Run: `pnpm vitest run`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/test/integration/
git commit -m "test: add integration tests for PublicClient and WalletClient"
```

---

### Task 11: Build Verification & Final Barrel Export

**Files:**
- Modify: `packages/core/src/index.ts` (verify completeness)

- [ ] **Step 1: Verify the full barrel export is complete**

Read `packages/core/src/index.ts` and ensure every public type, function, and class is exported. The final file should export:

- All types from `types/`
- All errors from `errors/`
- All utilities from `utils/`
- All transports: `createTransport`, `http`, `custom`, `fallback`
- All clients: `createClient`, `createPublicClient`, `createWalletClient`
- All account factories: `rpcAccount`, `privateKeyToAccount`, `mnemonicToAccount`, `viewOnlyAccount`, `toAccount`
- All public actions individually
- All wallet actions individually
- `PublicActions` and `WalletActions` types

- [ ] **Step 2: Run the build**

Run: `cd /Users/privacydaddy/dev/aleo-viem && pnpm build`
Expected: Build succeeds, `packages/core/dist/` contains `index.js` and `index.d.ts`.

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
| 2 | Core types (Account, Transport, Prover, RecordScanner, Block, Transaction, Program) | 1 |
| 3 | Utilities (address, credits, uid) | 1 |
| 4 | Error types | 1 |
| 5 | Transport layer (http, custom, fallback) | 2, 4 |
| 6 | Client layer (createClient, createPublicClient, createWalletClient) | 2, 3, 4, 5 |
| 7 | Account factories (rpcAccount, privateKeyToAccount, mnemonicToAccount, viewOnlyAccount) | 2 |
| 8 | Public actions (9 actions, individual files + decorator) | 2, 6 |
| 9 | Wallet actions (7 actions, individual files + decorator) | 2, 4, 6, 7 |
| 10 | Integration tests | All above |
| 11 | Build verification | All above |
