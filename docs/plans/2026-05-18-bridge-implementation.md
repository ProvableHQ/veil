# @veil/bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `@veil/bridge` package — a typed client for the `wallet-services-api` bridge endpoints, with a `swap` action that orchestrates quote → order → Aleo unshield deposit → completion polling.

**Architecture:** Transport → client → decorator → actions, mirroring `@veil/core`. Single HTTP transport (`httpBridge`) over WSA's `/bridge/*` routes. Five primitive actions plus one orchestrator (`swap`) that uses `@veil/core`'s `WalletClient` to sign Aleo deposits. Each action ships with an MCP tool wrapper.

**Tech Stack:** TypeScript (ESM), vitest, tsup, pnpm workspace, `@veil/core` as a peer dep.

**Spec:** [`docs/specs/2026-05-18-bridge-design.md`](../specs/2026-05-18-bridge-design.md)

---

## Task 1: Scaffold the `@veil/bridge` package

**Files:**
- Create: `packages/bridge/package.json`
- Create: `packages/bridge/tsconfig.json`
- Create: `packages/bridge/tsup.config.ts`
- Create: `packages/bridge/src/index.ts`
- Create: `packages/bridge/test/.gitkeep`

- [ ] **Step 1: Create `packages/bridge/package.json`**

```json
{
  "name": "@veil/bridge",
  "version": "0.1.0",
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
  "files": ["dist"],
  "dependencies": {
    "@veil/core": "workspace:*"
  }
}
```

- [ ] **Step 2: Create `packages/bridge/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".."
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/bridge/tsup.config.ts`**

```typescript
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

- [ ] **Step 4: Create empty `packages/bridge/src/index.ts`**

```typescript
export {}
```

- [ ] **Step 5: Create `packages/bridge/test/.gitkeep`** (empty file)

- [ ] **Step 6: Verify the workspace recognises the package**

Run: `pnpm install`
Expected: `@veil/bridge` listed under workspace packages; no errors.

Run: `pnpm --filter @veil/bridge typecheck`
Expected: PASS (no source yet).

- [ ] **Step 7: Commit**

```bash
git add packages/bridge/package.json packages/bridge/tsconfig.json packages/bridge/tsup.config.ts packages/bridge/src/index.ts packages/bridge/test/.gitkeep
git commit -m "scaffold @veil/bridge package"
```

---

## Task 2: Bridge types

**Files:**
- Create: `packages/bridge/src/types/bridge.ts`
- Create: `packages/bridge/src/types/envelope.ts`

Types are sourced from `~/dev/wallet-services-api/docs/openapi.yaml` (search `BridgeQuote`, `BridgeOrderInstructions`, `BridgeOrderStage`, `BridgeOrderStatusDto`, `BridgeOrderAuditDto`). The plan ships minimal-but-complete shapes the actions consume; widen later as needed.

- [ ] **Step 1: Create `packages/bridge/src/types/envelope.ts`**

```typescript
export type ApiEnvelope<T> = {
  data: T
  meta?: Record<string, unknown>
}
```

- [ ] **Step 2: Create `packages/bridge/src/types/bridge.ts`**

```typescript
export type BridgeOrderStage =
  | 'ORDER_CREATED'
  | 'AWAITING_DEPOSIT'
  | 'DEPOSIT_DETECTED'
  | 'DEPOSIT_CONFIRMED'
  | 'SWAP_IN_PROGRESS'
  | 'DESTINATION_SENDING'
  | 'COMPLETED'
  | 'EXPIRED'
  | 'FAILED'
  | 'REFUNDED'
  | 'DELETED'

export type BridgeQuoteFeeEstimateLeg = {
  asset: string
  amount: string
  chain?: string
}

export type BridgeQuoteFeeEstimate = {
  source?: BridgeQuoteFeeEstimateLeg
  destination?: BridgeQuoteFeeEstimateLeg
}

export type BridgeQuote = {
  id: string
  provider: string
  fromChain: string
  fromAsset: string
  toChain: string
  toAsset: string
  fromAmount: string
  toAmount: string
  rate: string
  feeEstimate?: BridgeQuoteFeeEstimate
  etaSeconds?: number
  expiresAt?: string
  metadata?: Record<string, unknown>
}

export type ProviderError = {
  provider: string
  message: string
  code?: string
}

export type GetQuotesMeta = {
  count: number
  quoteRequestId: string
  warnings?: string[]
  providerErrors?: ProviderError[]
}

export type DepositInstructionType = 'ONCHAIN_DEPOSIT' | 'OFFCHAIN_WIDGET'

export type DepositInstruction = {
  type: DepositInstructionType
  address: string
  amount: string
  chain: string
  memo?: string
  expiresAt?: string
}

export type BridgeOrderInstructions = {
  orderId: string
  depositAddress: string
  depositAmount: string
  depositChain: string
  depositMemo?: string
  instructions: DepositInstruction
  expiration?: string
}

export type BridgeOrderStepStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'FAILED'

export type BridgeOrderStepKey = string

export type BridgeOrderStepStatusDto = {
  key: BridgeOrderStepKey
  status: BridgeOrderStepStatus
  startedAt?: string
  completedAt?: string
}

export type BridgeOrderTimelineEvent = {
  step: BridgeOrderStepKey
  status: BridgeOrderStepStatus
  timestamp: string
}

export type BridgeOrderFinalStatusReason = string

export type BridgeOrderFinalStatus = {
  step: BridgeOrderStepKey
  status: BridgeOrderStepStatus
  reason?: BridgeOrderFinalStatusReason
  message?: string
}

export type BridgeOrderStatusDto = {
  orderId: string
  stage: BridgeOrderStage
  currentStep?: BridgeOrderStepKey
  steps: BridgeOrderStepStatusDto[]
  timeline?: BridgeOrderTimelineEvent[]
  finalStatus?: BridgeOrderFinalStatus
  transactionHashes?: Record<string, string>
}

export type BridgeOrderAuditDto = {
  orderId: string
  events: Array<{
    timestamp: string
    source: string
    type: string
    payload: Record<string, unknown>
  }>
}

export const TERMINAL_STAGES: ReadonlyArray<BridgeOrderStage> = [
  'COMPLETED',
  'EXPIRED',
  'FAILED',
  'REFUNDED',
  'DELETED',
]

export function isTerminalStage(stage: BridgeOrderStage): boolean {
  return TERMINAL_STAGES.includes(stage)
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/bridge/src/types
git commit -m "add bridge response types"
```

---

## Task 3: Envelope unwrap helper

**Files:**
- Create: `packages/bridge/src/utils/unwrapEnvelope.ts`
- Create: `packages/bridge/test/utils/unwrapEnvelope.test.ts`
- Create: `packages/bridge/src/errors/bridgeErrors.ts`

- [ ] **Step 1: Create `packages/bridge/src/errors/bridgeErrors.ts`**

```typescript
export class BridgeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BridgeError'
  }
}

export class BridgeEnvelopeError extends BridgeError {
  constructor(message: string) {
    super(message)
    this.name = 'BridgeEnvelopeError'
  }
}

export class BridgeOrderFailedError extends BridgeError {
  constructor(
    public readonly stage: string,
    public readonly orderId: string,
    public readonly reason?: string,
  ) {
    super(`Bridge order ${orderId} ended in terminal stage ${stage}${reason ? `: ${reason}` : ''}`)
    this.name = 'BridgeOrderFailedError'
  }
}

export class BridgeTimeoutError extends BridgeError {
  constructor(public readonly orderId: string, public readonly timeoutMs: number) {
    super(`Bridge order ${orderId} did not reach the requested stage within ${timeoutMs}ms`)
    this.name = 'BridgeTimeoutError'
  }
}
```

- [ ] **Step 2: Write failing test `packages/bridge/test/utils/unwrapEnvelope.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { unwrapEnvelope } from '../../src/utils/unwrapEnvelope.js'
import { BridgeEnvelopeError } from '../../src/errors/bridgeErrors.js'

describe('unwrapEnvelope', () => {
  it('returns data when keepMeta is false', () => {
    const response = { data: { id: '1' }, meta: { count: 1 } }
    const result = unwrapEnvelope(response, { keepMeta: false })
    expect(result).toEqual({ id: '1' })
  })

  it('returns data and meta when keepMeta is true', () => {
    const response = { data: { id: '1' }, meta: { count: 1 } }
    const result = unwrapEnvelope(response, { keepMeta: true })
    expect(result).toEqual({ data: { id: '1' }, meta: { count: 1 } })
  })

  it('returns data and empty meta when keepMeta is true but meta missing', () => {
    const response = { data: { id: '1' } }
    const result = unwrapEnvelope(response, { keepMeta: true })
    expect(result).toEqual({ data: { id: '1' }, meta: {} })
  })

  it('throws BridgeEnvelopeError when data is absent', () => {
    expect(() => unwrapEnvelope({ meta: {} } as any, { keepMeta: false }))
      .toThrowError(BridgeEnvelopeError)
  })

  it('throws BridgeEnvelopeError when response is null', () => {
    expect(() => unwrapEnvelope(null as any, { keepMeta: false }))
      .toThrowError(BridgeEnvelopeError)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @veil/bridge test`
Expected: FAIL — `unwrapEnvelope` not defined.

- [ ] **Step 4: Implement `packages/bridge/src/utils/unwrapEnvelope.ts`**

```typescript
import { BridgeEnvelopeError } from '../errors/bridgeErrors.js'
import type { ApiEnvelope } from '../types/envelope.js'

export function unwrapEnvelope<T>(
  response: ApiEnvelope<T> | null | undefined,
  options: { keepMeta: false },
): T
export function unwrapEnvelope<T>(
  response: ApiEnvelope<T> | null | undefined,
  options: { keepMeta: true },
): { data: T; meta: Record<string, unknown> }
export function unwrapEnvelope<T>(
  response: ApiEnvelope<T> | null | undefined,
  options: { keepMeta: boolean },
): T | { data: T; meta: Record<string, unknown> } {
  if (response == null || typeof response !== 'object' || !('data' in response)) {
    throw new BridgeEnvelopeError('Bridge response missing "data" envelope')
  }
  if (options.keepMeta) {
    return { data: response.data, meta: response.meta ?? {} }
  }
  return response.data
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @veil/bridge test`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/bridge/src/utils/unwrapEnvelope.ts packages/bridge/src/errors/bridgeErrors.ts packages/bridge/test/utils/unwrapEnvelope.test.ts
git commit -m "add envelope unwrap helper and bridge errors"
```

---

## Task 4: `httpBridge` transport

**Files:**
- Create: `packages/bridge/src/transports/httpBridge.ts`
- Create: `packages/bridge/test/transports/httpBridge.test.ts`

- [ ] **Step 1: Write failing test `packages/bridge/test/transports/httpBridge.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { httpBridge } from '../../src/transports/httpBridge.js'

function makeFetchMock(response: { ok: boolean; status?: number; body: unknown }) {
  return vi.fn(async () => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    text: async () => JSON.stringify(response.body),
    json: async () => response.body,
  })) as unknown as typeof fetch
}

describe('httpBridge transport', () => {
  it('builds the GET /bridge/quotes URL with query params', async () => {
    const fetchFn = makeFetchMock({ ok: true, body: { data: [] } })
    const transport = httpBridge('https://wsa.example/api', { fetchFn })

    await transport.request({
      method: 'getBridgeQuotes',
      params: {
        fromChain: 'aleo', fromAsset: 'ALEO',
        toChain: 'solana', toAsset: 'SOL',
        amount: '1.0', recipientAddress: '8xJ...',
      },
    })

    const [url, init] = (fetchFn as any).mock.calls[0]
    expect(url).toMatch(/^https:\/\/wsa\.example\/api\/bridge\/quotes\?/)
    expect(url).toContain('fromChain=aleo')
    expect(url).toContain('toAsset=SOL')
    expect(url).toContain('amount=1.0')
    expect(init.method).toBe('GET')
  })

  it('POSTs JSON to /bridge/orders with optional x-timezone header', async () => {
    const fetchFn = makeFetchMock({ ok: true, body: { data: { orderId: 'o1' } } })
    const transport = httpBridge('https://wsa.example/api', { fetchFn })

    await transport.request({
      method: 'createBridgeOrder',
      params: { quoteId: 'q1', timezone: 'America/New_York' },
    })

    const [url, init] = (fetchFn as any).mock.calls[0]
    expect(url).toBe('https://wsa.example/api/bridge/orders')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.headers['x-timezone']).toBe('America/New_York')
    expect(JSON.parse(init.body)).toEqual({ quoteId: 'q1' })
  })

  it('GETs /bridge/orders/{id}', async () => {
    const fetchFn = makeFetchMock({ ok: true, body: { data: { orderId: 'o1' } } })
    const transport = httpBridge('https://wsa.example/api', { fetchFn })

    await transport.request({ method: 'getBridgeOrder', params: { id: 'o1' } })

    const [url] = (fetchFn as any).mock.calls[0]
    expect(url).toBe('https://wsa.example/api/bridge/orders/o1')
  })

  it('GETs /bridge/orders/{id}/audit', async () => {
    const fetchFn = makeFetchMock({ ok: true, body: { data: {} } })
    const transport = httpBridge('https://wsa.example/api', { fetchFn })

    await transport.request({ method: 'getBridgeOrderAudit', params: { id: 'o1' } })

    const [url] = (fetchFn as any).mock.calls[0]
    expect(url).toBe('https://wsa.example/api/bridge/orders/o1/audit')
  })

  it('throws TransportError on non-2xx', async () => {
    const fetchFn = makeFetchMock({ ok: false, status: 500, body: { error: 'boom' } })
    const transport = httpBridge('https://wsa.example/api', { fetchFn })

    await expect(transport.request({ method: 'getBridgeOrder', params: { id: 'o1' } }))
      .rejects.toThrow(/HTTP 500/)
  })

  it('throws on unknown method', async () => {
    const transport = httpBridge('https://wsa.example/api', { fetchFn: vi.fn() })
    await expect(transport.request({ method: 'doesNotExist' as any })).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @veil/bridge test`
Expected: FAIL — `httpBridge` not defined.

- [ ] **Step 3: Implement `packages/bridge/src/transports/httpBridge.ts`**

```typescript
import { TransportError } from '@veil/core'
import type { Transport, TransportConfig } from '@veil/core'
import { createTransport } from '@veil/core'

type HttpBridgeConfig = {
  fetchFn?: typeof fetch
  headers?: Record<string, string>
  key?: string
  name?: string
}

function enc(v: unknown): string {
  if (v === null || v === undefined) return ''
  return encodeURIComponent(String(v))
}

type BuiltRequest = {
  url: string
  httpMethod: 'GET' | 'POST'
  body?: string
  headers?: Record<string, string>
}

function buildRequest(
  baseUrl: string,
  method: string,
  params?: Record<string, unknown>,
): BuiltRequest {
  switch (method) {
    case 'getBridgeQuotes': {
      const q = new URLSearchParams()
      const p = params ?? {}
      for (const key of ['fromChain', 'fromAsset', 'toChain', 'toAsset', 'amount', 'recipientAddress']) {
        if (p[key] != null) q.set(key, String(p[key]))
      }
      return { url: `${baseUrl}/bridge/quotes?${q.toString()}`, httpMethod: 'GET' }
    }
    case 'createBridgeOrder': {
      const p = (params ?? {}) as { quoteId?: string; timezone?: string }
      const headers: Record<string, string> = {}
      if (p.timezone) headers['x-timezone'] = p.timezone
      return {
        url: `${baseUrl}/bridge/orders`,
        httpMethod: 'POST',
        body: JSON.stringify({ quoteId: p.quoteId }),
        headers,
      }
    }
    case 'getBridgeOrder':
      return { url: `${baseUrl}/bridge/orders/${enc((params as any)?.id)}`, httpMethod: 'GET' }
    case 'getBridgeOrderAudit':
      return { url: `${baseUrl}/bridge/orders/${enc((params as any)?.id)}/audit`, httpMethod: 'GET' }
    default:
      throw new TransportError(`Unknown bridge method: ${method}`)
  }
}

export function httpBridge(
  baseUrl: string,
  config: HttpBridgeConfig = {},
): Transport<'httpBridge'> {
  const {
    fetchFn = fetch,
    headers: extraHeaders = {},
    key = 'httpBridge',
    name = 'HTTP Bridge Transport',
  } = config

  const transportConfig: TransportConfig<'httpBridge'> = {
    key,
    name,
    type: 'httpBridge',
    request: async ({ method, params }) => {
      const built = buildRequest(baseUrl, method, params as Record<string, unknown> | undefined)
      const response = await fetchFn(built.url, {
        method: built.httpMethod,
        headers: {
          'Content-Type': 'application/json',
          ...extraHeaders,
          ...built.headers,
        },
        ...(built.body ? { body: built.body } : {}),
      })
      if (!response.ok) {
        const text = await response.text()
        throw new TransportError(`HTTP ${response.status}: ${text}`)
      }
      return response.json()
    },
  }

  return createTransport(transportConfig)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @veil/bridge test`
Expected: PASS (6 transport tests + earlier 5).

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/transports packages/bridge/test/transports
git commit -m "add httpBridge transport"
```

---

## Task 5: `createBridgeClient` (skeleton, empty decorator)

**Files:**
- Create: `packages/bridge/src/clients/createBridgeClient.ts`
- Create: `packages/bridge/src/clients/decorators/bridge.ts`
- Create: `packages/bridge/test/clients/createBridgeClient.test.ts`

- [ ] **Step 1: Write failing test `packages/bridge/test/clients/createBridgeClient.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createBridgeClient } from '../../src/clients/createBridgeClient.js'
import { httpBridge } from '../../src/transports/httpBridge.js'

describe('createBridgeClient', () => {
  it('exposes a request function from the transport', () => {
    const fetchFn = vi.fn()
    const client = createBridgeClient({ transport: httpBridge('https://wsa.example/api', { fetchFn }) })
    expect(typeof client.request).toBe('function')
  })

  it('has the bridge key by default', () => {
    const fetchFn = vi.fn()
    const client = createBridgeClient({ transport: httpBridge('https://wsa.example/api', { fetchFn }) })
    expect(client.key).toBe('bridge')
  })

  it('is extendable like other Veil clients', () => {
    const fetchFn = vi.fn()
    const client = createBridgeClient({ transport: httpBridge('https://wsa.example/api', { fetchFn }) })
    const extended = client.extend(() => ({ hello: () => 'world' }))
    expect(extended.hello()).toBe('world')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @veil/bridge test`
Expected: FAIL — `createBridgeClient` not defined.

- [ ] **Step 3: Implement `packages/bridge/src/clients/decorators/bridge.ts` (empty for now)**

```typescript
import type { Client } from '@veil/core'

export type BridgeActions = Record<string, never>

export function bridgeActions(_client: Client): BridgeActions {
  return {}
}
```

- [ ] **Step 4: Implement `packages/bridge/src/clients/createBridgeClient.ts`**

```typescript
import { createClient, type ClientConfig, type Client } from '@veil/core'
import { bridgeActions, type BridgeActions } from './decorators/bridge.js'

export type BridgeClientConfig = Omit<ClientConfig, 'account' | 'key' | 'name' | 'proving'> & {
  key?: string
  name?: string
}

export type BridgeClient = Client & BridgeActions

export function createBridgeClient(config: BridgeClientConfig): BridgeClient {
  const { key = 'bridge', name = 'Bridge Client', ...rest } = config
  const client = createClient({ ...rest, key, name })
  return client.extend(bridgeActions) as BridgeClient
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @veil/bridge test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/bridge/src/clients packages/bridge/test/clients
git commit -m "add createBridgeClient skeleton"
```

---

## Task 6: `getQuotes` action

**Files:**
- Create: `packages/bridge/src/actions/getQuotes.ts`
- Create: `packages/bridge/test/actions/getQuotes.test.ts`

- [ ] **Step 1: Write failing test `packages/bridge/test/actions/getQuotes.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { getQuotes } from '../../src/actions/getQuotes.js'
import { BridgeEnvelopeError } from '../../src/errors/bridgeErrors.js'

describe('getQuotes', () => {
  it('returns quotes + meta on success', async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        data: [{ id: 'q1', provider: 'p', fromChain: 'aleo', fromAsset: 'ALEO',
                 toChain: 'solana', toAsset: 'SOL', fromAmount: '1', toAmount: '0.05', rate: '0.05' }],
        meta: { count: 1, quoteRequestId: 'req-1' },
      }),
    } as any

    const result = await getQuotes(client, {
      fromChain: 'aleo', fromAsset: 'ALEO',
      toChain: 'solana', toAsset: 'SOL',
      amount: '1', recipientAddress: '8xJ...',
    })

    expect(result.quotes).toHaveLength(1)
    expect(result.quotes[0].id).toBe('q1')
    expect(result.meta.quoteRequestId).toBe('req-1')
    expect(result.meta.count).toBe(1)
    expect(client.request).toHaveBeenCalledWith({
      method: 'getBridgeQuotes',
      params: expect.objectContaining({ fromChain: 'aleo', toAsset: 'SOL', amount: '1' }),
    })
  })

  it('passes through providerErrors and warnings via meta', async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        data: [],
        meta: {
          count: 0,
          quoteRequestId: 'req-2',
          warnings: ['near minimum'],
          providerErrors: [{ provider: 'x', message: 'down' }],
        },
      }),
    } as any

    const result = await getQuotes(client, {
      fromChain: 'aleo', fromAsset: 'ALEO',
      toChain: 'solana', toAsset: 'SOL',
      amount: '1', recipientAddress: '8xJ...',
    })

    expect(result.meta.warnings).toEqual(['near minimum'])
    expect(result.meta.providerErrors).toHaveLength(1)
  })

  it('throws BridgeEnvelopeError if data is missing', async () => {
    const client = { request: vi.fn().mockResolvedValue({ meta: {} }) } as any
    await expect(getQuotes(client, {
      fromChain: 'aleo', fromAsset: 'ALEO',
      toChain: 'solana', toAsset: 'SOL',
      amount: '1', recipientAddress: '8xJ...',
    })).rejects.toThrow(BridgeEnvelopeError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @veil/bridge test`
Expected: FAIL — `getQuotes` not defined.

- [ ] **Step 3: Implement `packages/bridge/src/actions/getQuotes.ts`**

```typescript
import type { Client } from '@veil/core'
import { unwrapEnvelope } from '../utils/unwrapEnvelope.js'
import type { BridgeQuote, GetQuotesMeta } from '../types/bridge.js'

export type GetQuotesParameters = {
  fromChain: string
  fromAsset: string
  toChain: string
  toAsset: string
  amount: string
  recipientAddress: string
}

export type GetQuotesReturnType = {
  quotes: BridgeQuote[]
  meta: GetQuotesMeta
}

export async function getQuotes(
  client: Client,
  params: GetQuotesParameters,
): Promise<GetQuotesReturnType> {
  const response = await client.request({ method: 'getBridgeQuotes', params })
  const { data, meta } = unwrapEnvelope<BridgeQuote[]>(response as any, { keepMeta: true })
  return { quotes: data, meta: meta as GetQuotesMeta }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @veil/bridge test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/actions/getQuotes.ts packages/bridge/test/actions/getQuotes.test.ts
git commit -m "add getQuotes action"
```

---

## Task 7: `createOrder` action

**Files:**
- Create: `packages/bridge/src/actions/createOrder.ts`
- Create: `packages/bridge/test/actions/createOrder.test.ts`

- [ ] **Step 1: Write failing test `packages/bridge/test/actions/createOrder.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createOrder } from '../../src/actions/createOrder.js'
import { BridgeEnvelopeError } from '../../src/errors/bridgeErrors.js'

describe('createOrder', () => {
  it('returns BridgeOrderInstructions', async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        data: {
          orderId: 'o1',
          depositAddress: 'aleo1deposit',
          depositAmount: '1.5',
          depositChain: 'aleo',
          instructions: {
            type: 'ONCHAIN_DEPOSIT',
            address: 'aleo1deposit',
            amount: '1.5',
            chain: 'aleo',
          },
        },
      }),
    } as any

    const result = await createOrder(client, { quoteId: 'q1' })

    expect(result.orderId).toBe('o1')
    expect(result.depositAddress).toBe('aleo1deposit')
    expect(client.request).toHaveBeenCalledWith({
      method: 'createBridgeOrder',
      params: { quoteId: 'q1' },
    })
  })

  it('passes timezone through to the request', async () => {
    const client = {
      request: vi.fn().mockResolvedValue({ data: { orderId: 'o1', depositAddress: 'a', depositAmount: '1', depositChain: 'aleo', instructions: { type: 'ONCHAIN_DEPOSIT', address: 'a', amount: '1', chain: 'aleo' } } }),
    } as any

    await createOrder(client, { quoteId: 'q1', timezone: 'America/New_York' })

    expect(client.request).toHaveBeenCalledWith({
      method: 'createBridgeOrder',
      params: { quoteId: 'q1', timezone: 'America/New_York' },
    })
  })

  it('throws BridgeEnvelopeError on missing data', async () => {
    const client = { request: vi.fn().mockResolvedValue({}) } as any
    await expect(createOrder(client, { quoteId: 'q1' })).rejects.toThrow(BridgeEnvelopeError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @veil/bridge test`
Expected: FAIL — `createOrder` not defined.

- [ ] **Step 3: Implement `packages/bridge/src/actions/createOrder.ts`**

```typescript
import type { Client } from '@veil/core'
import { unwrapEnvelope } from '../utils/unwrapEnvelope.js'
import type { BridgeOrderInstructions } from '../types/bridge.js'

export type CreateOrderParameters = {
  quoteId: string
  timezone?: string
}

export type CreateOrderReturnType = BridgeOrderInstructions

export async function createOrder(
  client: Client,
  params: CreateOrderParameters,
): Promise<CreateOrderReturnType> {
  const response = await client.request({ method: 'createBridgeOrder', params })
  return unwrapEnvelope<BridgeOrderInstructions>(response as any, { keepMeta: false })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @veil/bridge test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/actions/createOrder.ts packages/bridge/test/actions/createOrder.test.ts
git commit -m "add createOrder action"
```

---

## Task 8: `getOrder` and `getOrderAudit` actions

**Files:**
- Create: `packages/bridge/src/actions/getOrder.ts`
- Create: `packages/bridge/src/actions/getOrderAudit.ts`
- Create: `packages/bridge/test/actions/getOrder.test.ts`
- Create: `packages/bridge/test/actions/getOrderAudit.test.ts`

- [ ] **Step 1: Write failing tests `packages/bridge/test/actions/getOrder.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { getOrder } from '../../src/actions/getOrder.js'

describe('getOrder', () => {
  it('returns BridgeOrderStatusDto', async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        data: { orderId: 'o1', stage: 'AWAITING_DEPOSIT', steps: [] },
      }),
    } as any

    const result = await getOrder(client, { id: 'o1' })

    expect(result.orderId).toBe('o1')
    expect(result.stage).toBe('AWAITING_DEPOSIT')
    expect(client.request).toHaveBeenCalledWith({
      method: 'getBridgeOrder',
      params: { id: 'o1' },
    })
  })
})
```

- [ ] **Step 2: Write failing test `packages/bridge/test/actions/getOrderAudit.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { getOrderAudit } from '../../src/actions/getOrderAudit.js'

describe('getOrderAudit', () => {
  it('returns BridgeOrderAuditDto', async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        data: { orderId: 'o1', events: [{ timestamp: 't', source: 's', type: 'x', payload: {} }] },
      }),
    } as any

    const result = await getOrderAudit(client, { id: 'o1' })

    expect(result.orderId).toBe('o1')
    expect(result.events).toHaveLength(1)
    expect(client.request).toHaveBeenCalledWith({
      method: 'getBridgeOrderAudit',
      params: { id: 'o1' },
    })
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @veil/bridge test`
Expected: FAIL — `getOrder` and `getOrderAudit` not defined.

- [ ] **Step 4: Implement `packages/bridge/src/actions/getOrder.ts`**

```typescript
import type { Client } from '@veil/core'
import { unwrapEnvelope } from '../utils/unwrapEnvelope.js'
import type { BridgeOrderStatusDto } from '../types/bridge.js'

export type GetOrderParameters = { id: string }
export type GetOrderReturnType = BridgeOrderStatusDto

export async function getOrder(
  client: Client,
  params: GetOrderParameters,
): Promise<GetOrderReturnType> {
  const response = await client.request({ method: 'getBridgeOrder', params })
  return unwrapEnvelope<BridgeOrderStatusDto>(response as any, { keepMeta: false })
}
```

- [ ] **Step 5: Implement `packages/bridge/src/actions/getOrderAudit.ts`**

```typescript
import type { Client } from '@veil/core'
import { unwrapEnvelope } from '../utils/unwrapEnvelope.js'
import type { BridgeOrderAuditDto } from '../types/bridge.js'

export type GetOrderAuditParameters = { id: string }
export type GetOrderAuditReturnType = BridgeOrderAuditDto

export async function getOrderAudit(
  client: Client,
  params: GetOrderAuditParameters,
): Promise<GetOrderAuditReturnType> {
  const response = await client.request({ method: 'getBridgeOrderAudit', params })
  return unwrapEnvelope<BridgeOrderAuditDto>(response as any, { keepMeta: false })
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @veil/bridge test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/bridge/src/actions/getOrder.ts packages/bridge/src/actions/getOrderAudit.ts packages/bridge/test/actions/getOrder.test.ts packages/bridge/test/actions/getOrderAudit.test.ts
git commit -m "add getOrder and getOrderAudit actions"
```

---

## Task 9: `waitForOrder` action

**Files:**
- Create: `packages/bridge/src/actions/waitForOrder.ts`
- Create: `packages/bridge/test/actions/waitForOrder.test.ts`

- [ ] **Step 1: Write failing test `packages/bridge/test/actions/waitForOrder.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { waitForOrder } from '../../src/actions/waitForOrder.js'
import { BridgeTimeoutError, BridgeOrderFailedError } from '../../src/errors/bridgeErrors.js'

function makeClient(stages: string[]) {
  let i = 0
  return {
    request: vi.fn().mockImplementation(async () => ({
      data: { orderId: 'o1', stage: stages[Math.min(i++, stages.length - 1)], steps: [] },
    })),
  } as any
}

describe('waitForOrder', () => {
  it('resolves when stage reaches the default terminal COMPLETED', async () => {
    const client = makeClient(['AWAITING_DEPOSIT', 'DEPOSIT_DETECTED', 'COMPLETED'])
    const stages: string[] = []

    const result = await waitForOrder(client, {
      id: 'o1',
      pollIntervalMs: 1,
      timeoutMs: 1000,
      onStage: (s) => stages.push(s.stage),
    })

    expect(result.stage).toBe('COMPLETED')
    expect(stages).toEqual(['AWAITING_DEPOSIT', 'DEPOSIT_DETECTED', 'COMPLETED'])
  })

  it('resolves when stage reaches a custom non-terminal stage', async () => {
    const client = makeClient(['AWAITING_DEPOSIT', 'DEPOSIT_DETECTED'])

    const result = await waitForOrder(client, {
      id: 'o1',
      until: 'DEPOSIT_DETECTED',
      pollIntervalMs: 1,
      timeoutMs: 1000,
    })

    expect(result.stage).toBe('DEPOSIT_DETECTED')
  })

  it('throws BridgeOrderFailedError on terminal failure stage', async () => {
    const client = makeClient(['AWAITING_DEPOSIT', 'FAILED'])

    await expect(waitForOrder(client, { id: 'o1', pollIntervalMs: 1, timeoutMs: 1000 }))
      .rejects.toThrow(BridgeOrderFailedError)
  })

  it('throws BridgeTimeoutError if the target stage is never reached', async () => {
    const client = makeClient(['AWAITING_DEPOSIT'])

    await expect(waitForOrder(client, { id: 'o1', pollIntervalMs: 1, timeoutMs: 10 }))
      .rejects.toThrow(BridgeTimeoutError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @veil/bridge test`
Expected: FAIL — `waitForOrder` not defined.

- [ ] **Step 3: Implement `packages/bridge/src/actions/waitForOrder.ts`**

```typescript
import type { Client } from '@veil/core'
import { getOrder } from './getOrder.js'
import { BridgeOrderFailedError, BridgeTimeoutError } from '../errors/bridgeErrors.js'
import {
  isTerminalStage,
  type BridgeOrderStage,
  type BridgeOrderStatusDto,
} from '../types/bridge.js'

export type WaitForOrderParameters = {
  id: string
  until?: BridgeOrderStage
  pollIntervalMs?: number
  timeoutMs?: number
  onStage?: (status: BridgeOrderStatusDto) => void
}

export type WaitForOrderReturnType = BridgeOrderStatusDto

const FAILURE_STAGES: ReadonlyArray<BridgeOrderStage> = ['EXPIRED', 'FAILED', 'REFUNDED', 'DELETED']

export async function waitForOrder(
  client: Client,
  params: WaitForOrderParameters,
): Promise<WaitForOrderReturnType> {
  const until = params.until ?? 'COMPLETED'
  const initialInterval = params.pollIntervalMs ?? 3000
  const timeoutMs = params.timeoutMs ?? 30 * 60_000
  const deadline = Date.now() + timeoutMs

  let interval = initialInterval

  while (true) {
    const status = await getOrder(client, { id: params.id })
    params.onStage?.(status)

    if (status.stage === until) return status

    if (FAILURE_STAGES.includes(status.stage)) {
      throw new BridgeOrderFailedError(
        status.stage,
        status.orderId,
        status.finalStatus?.reason ?? status.finalStatus?.message,
      )
    }

    if (isTerminalStage(status.stage)) {
      return status
    }

    if (Date.now() >= deadline) {
      throw new BridgeTimeoutError(params.id, timeoutMs)
    }

    await new Promise((resolve) => setTimeout(resolve, interval))
    interval = Math.min(interval * 1.5, 30_000)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @veil/bridge test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/actions/waitForOrder.ts packages/bridge/test/actions/waitForOrder.test.ts
git commit -m "add waitForOrder action with backoff and terminal-failure handling"
```

---

## Task 10: Wire primitive actions into the bridge decorator

**Files:**
- Modify: `packages/bridge/src/clients/decorators/bridge.ts`
- Modify: `packages/bridge/test/clients/createBridgeClient.test.ts`

- [ ] **Step 1: Extend test with method-binding assertions**

Append to `packages/bridge/test/clients/createBridgeClient.test.ts`:

```typescript
import { vi } from 'vitest'

describe('createBridgeClient bound actions', () => {
  it('exposes getQuotes, createOrder, getOrder, getOrderAudit, waitForOrder', () => {
    const fetchFn = vi.fn()
    const { createBridgeClient } = require('../../src/clients/createBridgeClient.js')
    const { httpBridge } = require('../../src/transports/httpBridge.js')
    const client = createBridgeClient({ transport: httpBridge('https://wsa.example/api', { fetchFn }) })
    expect(typeof client.getQuotes).toBe('function')
    expect(typeof client.createOrder).toBe('function')
    expect(typeof client.getOrder).toBe('function')
    expect(typeof client.getOrderAudit).toBe('function')
    expect(typeof client.waitForOrder).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @veil/bridge test`
Expected: FAIL — `client.getQuotes` etc. undefined.

- [ ] **Step 3: Replace `packages/bridge/src/clients/decorators/bridge.ts`**

```typescript
import type { Client } from '@veil/core'
import { getQuotes, type GetQuotesParameters, type GetQuotesReturnType } from '../../actions/getQuotes.js'
import { createOrder, type CreateOrderParameters, type CreateOrderReturnType } from '../../actions/createOrder.js'
import { getOrder, type GetOrderParameters, type GetOrderReturnType } from '../../actions/getOrder.js'
import { getOrderAudit, type GetOrderAuditParameters, type GetOrderAuditReturnType } from '../../actions/getOrderAudit.js'
import { waitForOrder, type WaitForOrderParameters, type WaitForOrderReturnType } from '../../actions/waitForOrder.js'

export type BridgeActions = {
  getQuotes: (params: GetQuotesParameters) => Promise<GetQuotesReturnType>
  createOrder: (params: CreateOrderParameters) => Promise<CreateOrderReturnType>
  getOrder: (params: GetOrderParameters) => Promise<GetOrderReturnType>
  getOrderAudit: (params: GetOrderAuditParameters) => Promise<GetOrderAuditReturnType>
  waitForOrder: (params: WaitForOrderParameters) => Promise<WaitForOrderReturnType>
}

export function bridgeActions(client: Client): BridgeActions {
  return {
    getQuotes: (params) => getQuotes(client, params),
    createOrder: (params) => createOrder(client, params),
    getOrder: (params) => getOrder(client, params),
    getOrderAudit: (params) => getOrderAudit(client, params),
    waitForOrder: (params) => waitForOrder(client, params),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @veil/bridge test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/clients/decorators/bridge.ts packages/bridge/test/clients/createBridgeClient.test.ts
git commit -m "wire primitive actions into bridge decorator"
```

---

## Task 11: `swap` action

**Files:**
- Create: `packages/bridge/src/actions/swap.ts`
- Create: `packages/bridge/test/actions/swap.test.ts`
- Modify: `packages/bridge/src/clients/decorators/bridge.ts`

The `swap` action depends on a `WalletClient` from `@veil/core`. For tests, we use a duck-typed stub.

- [ ] **Step 1: Write failing test `packages/bridge/test/actions/swap.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { swap } from '../../src/actions/swap.js'

function makeQuote(over: Partial<any> = {}) {
  return {
    id: 'q1', provider: 'p',
    fromChain: 'aleo', fromAsset: 'ALEO',
    toChain: 'solana', toAsset: 'SOL',
    fromAmount: '1.5', toAmount: '0.05', rate: '0.033',
    etaSeconds: 120,
    ...over,
  }
}

function makeBridgeClient(opts: {
  quotes: any[]
  meta?: any
  order: any
  pollStages?: string[]
}) {
  let i = 0
  return {
    request: vi.fn().mockImplementation(async ({ method }) => {
      if (method === 'getBridgeQuotes') return { data: opts.quotes, meta: opts.meta ?? { count: opts.quotes.length, quoteRequestId: 'req-1' } }
      if (method === 'createBridgeOrder') return { data: opts.order }
      if (method === 'getBridgeOrder') {
        const stages = opts.pollStages ?? ['COMPLETED']
        return { data: { orderId: opts.order.orderId, stage: stages[Math.min(i++, stages.length - 1)], steps: [] } }
      }
      throw new Error(`unexpected method ${method}`)
    }),
  } as any
}

function makeWallet(depositTxId = 'at1deadbeef') {
  return {
    executeContract: vi.fn().mockResolvedValue(depositTxId),
  } as any
}

describe('swap', () => {
  it('runs quote → select(best) → order → deposit → poll until COMPLETED', async () => {
    const bridge = makeBridgeClient({
      quotes: [makeQuote({ id: 'a', toAmount: '0.04' }), makeQuote({ id: 'b', toAmount: '0.05' })],
      order: {
        orderId: 'o1',
        depositAddress: 'aleo1deposit',
        depositAmount: '1.5',
        depositChain: 'aleo',
        instructions: { type: 'ONCHAIN_DEPOSIT', address: 'aleo1deposit', amount: '1.5', chain: 'aleo' },
      },
      pollStages: ['AWAITING_DEPOSIT', 'COMPLETED'],
    })
    const wallet = makeWallet()

    const result = await swap(bridge, {
      wallet,
      from: { asset: 'ALEO', amount: '1.5' },
      to: { chain: 'solana', asset: 'SOL', address: '8xJ...' },
      selectQuote: 'best',
      poll: true,
    })

    expect(result.orderId).toBe('o1')
    expect(result.depositTxId).toBe('at1deadbeef')
    expect(result.finalStatus?.stage).toBe('COMPLETED')

    // Picked the higher-toAmount quote
    expect(bridge.request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'createBridgeOrder',
      params: expect.objectContaining({ quoteId: 'b' }),
    }))

    // Wallet was asked to do the transfer_private_to_public
    expect(wallet.executeContract).toHaveBeenCalledWith(expect.objectContaining({
      programId: 'credits.aleo',
      functionName: 'transfer_private_to_public',
      inputs: ['aleo1deposit', '1.5'],
    }))
  })

  it('uses a user-supplied selectQuote callback', async () => {
    const bridge = makeBridgeClient({
      quotes: [makeQuote({ id: 'a' }), makeQuote({ id: 'b' })],
      order: { orderId: 'o1', depositAddress: 'a', depositAmount: '1', depositChain: 'aleo',
               instructions: { type: 'ONCHAIN_DEPOSIT', address: 'a', amount: '1', chain: 'aleo' } },
    })
    const wallet = makeWallet()

    await swap(bridge, {
      wallet,
      from: { asset: 'ALEO', amount: '1' },
      to: { chain: 'solana', asset: 'SOL', address: '8xJ...' },
      selectQuote: (qs) => qs.find((q) => q.id === 'a')!,
      poll: false,
    })

    expect(bridge.request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'createBridgeOrder',
      params: expect.objectContaining({ quoteId: 'a' }),
    }))
  })

  it('skips polling and returns immediately when poll=false', async () => {
    const bridge = makeBridgeClient({
      quotes: [makeQuote()],
      order: { orderId: 'o1', depositAddress: 'a', depositAmount: '1', depositChain: 'aleo',
               instructions: { type: 'ONCHAIN_DEPOSIT', address: 'a', amount: '1', chain: 'aleo' } },
    })
    const wallet = makeWallet()

    const result = await swap(bridge, {
      wallet,
      from: { asset: 'ALEO', amount: '1' },
      to: { chain: 'solana', asset: 'SOL', address: '8xJ...' },
      poll: false,
    })

    expect(result.finalStatus).toBeUndefined()
    const methods = (bridge.request as any).mock.calls.map((c: any) => c[0].method)
    expect(methods).not.toContain('getBridgeOrder')
  })

  it('throws if there are zero quotes', async () => {
    const bridge = makeBridgeClient({
      quotes: [],
      meta: { count: 0, quoteRequestId: 'req' },
      order: {} as any,
    })
    const wallet = makeWallet()

    await expect(swap(bridge, {
      wallet,
      from: { asset: 'ALEO', amount: '1' },
      to: { chain: 'solana', asset: 'SOL', address: '8xJ...' },
    })).rejects.toThrow(/no quotes/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @veil/bridge test`
Expected: FAIL — `swap` not defined.

- [ ] **Step 3: Implement `packages/bridge/src/actions/swap.ts`**

```typescript
import type { Client } from '@veil/core'
import { getQuotes } from './getQuotes.js'
import { createOrder } from './createOrder.js'
import { waitForOrder } from './waitForOrder.js'
import { BridgeError } from '../errors/bridgeErrors.js'
import type { BridgeOrderStage, BridgeOrderStatusDto, BridgeQuote } from '../types/bridge.js'

export type SwapWalletClient = {
  executeContract: (input: {
    programId: string
    functionName: string
    inputs: string[]
  }) => Promise<string>
}

export type SwapParameters = {
  wallet: SwapWalletClient
  from: { asset: string; amount: string }
  to: { chain: string; asset: string; address: string }
  selectQuote?:
    | 'best'
    | 'fastest'
    | ((quotes: BridgeQuote[]) => BridgeQuote | Promise<BridgeQuote>)
  poll?: boolean | BridgeOrderStage
  timezone?: string
  onStage?: (status: BridgeOrderStatusDto) => void
}

export type SwapReturnType = {
  quoteRequestId: string
  orderId: string
  depositTxId: string
  finalStatus?: BridgeOrderStatusDto
}

const FROM_CHAIN = 'aleo' as const

async function pickQuote(
  strategy: SwapParameters['selectQuote'],
  quotes: BridgeQuote[],
): Promise<BridgeQuote> {
  if (typeof strategy === 'function') return strategy(quotes)
  if (strategy === 'fastest') {
    return [...quotes].sort(
      (a, b) => (a.etaSeconds ?? Number.POSITIVE_INFINITY) - (b.etaSeconds ?? Number.POSITIVE_INFINITY),
    )[0]
  }
  return [...quotes].sort((a, b) => Number(b.toAmount) - Number(a.toAmount))[0]
}

export async function swap(
  client: Client,
  params: SwapParameters,
): Promise<SwapReturnType> {
  const { quotes, meta } = await getQuotes(client, {
    fromChain: FROM_CHAIN,
    fromAsset: params.from.asset,
    toChain: params.to.chain,
    toAsset: params.to.asset,
    amount: params.from.amount,
    recipientAddress: params.to.address,
  })

  if (quotes.length === 0) {
    throw new BridgeError('Bridge returned no quotes for the requested route')
  }

  const chosen = await pickQuote(params.selectQuote ?? 'best', quotes)

  const instructions = await createOrder(client, {
    quoteId: chosen.id,
    timezone: params.timezone,
  })

  const depositTxId = await params.wallet.executeContract({
    programId: 'credits.aleo',
    functionName: 'transfer_private_to_public',
    inputs: [instructions.depositAddress, instructions.depositAmount],
  })

  if (!params.poll) {
    return {
      quoteRequestId: meta.quoteRequestId,
      orderId: instructions.orderId,
      depositTxId,
    }
  }

  const finalStatus = await waitForOrder(client, {
    id: instructions.orderId,
    until: typeof params.poll === 'string' ? params.poll : 'COMPLETED',
    onStage: params.onStage,
  })

  return {
    quoteRequestId: meta.quoteRequestId,
    orderId: instructions.orderId,
    depositTxId,
    finalStatus,
  }
}
```

- [ ] **Step 4: Add `swap` to the bridge decorator**

In `packages/bridge/src/clients/decorators/bridge.ts`, add the import and entry:

```typescript
import { swap, type SwapParameters, type SwapReturnType } from '../../actions/swap.js'
```

Extend `BridgeActions`:

```typescript
swap: (params: SwapParameters) => Promise<SwapReturnType>
```

Extend `bridgeActions` return object:

```typescript
swap: (params) => swap(client, params),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @veil/bridge test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/bridge/src/actions/swap.ts packages/bridge/test/actions/swap.test.ts packages/bridge/src/clients/decorators/bridge.ts
git commit -m "add swap action and bind on bridge client"
```

---

## Task 12: Package index exports

**Files:**
- Modify: `packages/bridge/src/index.ts`

- [ ] **Step 1: Replace `packages/bridge/src/index.ts`**

```typescript
// Clients
export { createBridgeClient, type BridgeClient, type BridgeClientConfig } from './clients/createBridgeClient.js'
export { bridgeActions, type BridgeActions } from './clients/decorators/bridge.js'

// Transport
export { httpBridge } from './transports/httpBridge.js'

// Actions (standalone forms)
export { getQuotes, type GetQuotesParameters, type GetQuotesReturnType } from './actions/getQuotes.js'
export { createOrder, type CreateOrderParameters, type CreateOrderReturnType } from './actions/createOrder.js'
export { getOrder, type GetOrderParameters, type GetOrderReturnType } from './actions/getOrder.js'
export { getOrderAudit, type GetOrderAuditParameters, type GetOrderAuditReturnType } from './actions/getOrderAudit.js'
export { waitForOrder, type WaitForOrderParameters, type WaitForOrderReturnType } from './actions/waitForOrder.js'
export { swap, type SwapParameters, type SwapReturnType, type SwapWalletClient } from './actions/swap.js'

// Types
export type {
  BridgeQuote,
  BridgeQuoteFeeEstimate,
  BridgeQuoteFeeEstimateLeg,
  BridgeOrderInstructions,
  BridgeOrderStage,
  BridgeOrderStatusDto,
  BridgeOrderStepStatusDto,
  BridgeOrderStepStatus,
  BridgeOrderTimelineEvent,
  BridgeOrderFinalStatus,
  BridgeOrderAuditDto,
  DepositInstruction,
  DepositInstructionType,
  GetQuotesMeta,
  ProviderError,
} from './types/bridge.js'
export { TERMINAL_STAGES, isTerminalStage } from './types/bridge.js'

// Errors
export {
  BridgeError,
  BridgeEnvelopeError,
  BridgeOrderFailedError,
  BridgeTimeoutError,
} from './errors/bridgeErrors.js'

// Utilities
export { unwrapEnvelope } from './utils/unwrapEnvelope.js'
```

- [ ] **Step 2: Run typecheck + tests + build**

Run: `pnpm --filter @veil/bridge typecheck`
Expected: PASS.

Run: `pnpm --filter @veil/bridge test`
Expected: PASS.

Run: `pnpm --filter @veil/bridge build`
Expected: clean `dist/` output with `index.js`, `index.d.ts`, `agent/index.js`, `mcp/index.js` (the agent/mcp entries are placeholder for now — Task 13).

- [ ] **Step 3: Commit**

```bash
git add packages/bridge/src/index.ts
git commit -m "export public surface from @veil/bridge index"
```

---

## Task 13: MCP tool wrappers

**Files:**
- Create: `packages/bridge/src/mcp/index.ts`
- Create: `packages/bridge/src/mcp/tools.ts`
- Create: `packages/bridge/src/agent/index.ts`
- Create: `packages/bridge/test/mcp/tools.test.ts`

Each MCP tool is a thin schema + handler that calls the corresponding action. The action receives a bound client; the MCP tool exposes a JSON-shaped wrapper.

- [ ] **Step 1: Write failing test `packages/bridge/test/mcp/tools.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { buildBridgeMcpTools } from '../../src/mcp/tools.js'

function fakeClient() {
  return {
    getQuotes: vi.fn().mockResolvedValue({ quotes: [], meta: { count: 0, quoteRequestId: 'r' } }),
    createOrder: vi.fn().mockResolvedValue({ orderId: 'o1', depositAddress: 'a', depositAmount: '1', depositChain: 'aleo', instructions: { type: 'ONCHAIN_DEPOSIT', address: 'a', amount: '1', chain: 'aleo' } }),
    getOrder: vi.fn().mockResolvedValue({ orderId: 'o1', stage: 'AWAITING_DEPOSIT', steps: [] }),
    getOrderAudit: vi.fn().mockResolvedValue({ orderId: 'o1', events: [] }),
    waitForOrder: vi.fn().mockResolvedValue({ orderId: 'o1', stage: 'COMPLETED', steps: [] }),
    swap: vi.fn().mockResolvedValue({ quoteRequestId: 'r', orderId: 'o1', depositTxId: 'tx', finalStatus: { orderId: 'o1', stage: 'COMPLETED', steps: [] } }),
  } as any
}

describe('buildBridgeMcpTools', () => {
  it('returns one tool per action with a schema', () => {
    const tools = buildBridgeMcpTools(fakeClient())
    const names = tools.map((t) => t.name)
    expect(names).toEqual([
      'bridge_get_quotes',
      'bridge_create_order',
      'bridge_get_order',
      'bridge_get_order_audit',
      'bridge_wait_for_order',
      'bridge_swap',
    ])
    for (const tool of tools) {
      expect(tool.description).toBeTruthy()
      expect(tool.inputSchema?.type).toBe('object')
    }
  })

  it('bridge_get_quotes handler proxies to client.getQuotes', async () => {
    const client = fakeClient()
    const tools = buildBridgeMcpTools(client)
    const tool = tools.find((t) => t.name === 'bridge_get_quotes')!
    const result = await tool.handler({
      fromChain: 'aleo', fromAsset: 'ALEO',
      toChain: 'solana', toAsset: 'SOL',
      amount: '1', recipientAddress: '8xJ...',
    })
    expect(client.getQuotes).toHaveBeenCalled()
    expect(result.meta.quoteRequestId).toBe('r')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @veil/bridge test`
Expected: FAIL — `buildBridgeMcpTools` not defined.

- [ ] **Step 3: Implement `packages/bridge/src/mcp/tools.ts`**

```typescript
import type { BridgeClient } from '../clients/createBridgeClient.js'

export type McpToolSchema = {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

export type McpTool = {
  name: string
  description: string
  inputSchema: McpToolSchema
  handler: (params: any) => Promise<unknown>
}

export function buildBridgeMcpTools(client: BridgeClient): McpTool[] {
  return [
    {
      name: 'bridge_get_quotes',
      description: 'Fetch cross-chain swap quotes where Aleo is one side of the pair.',
      inputSchema: {
        type: 'object',
        properties: {
          fromChain: { type: 'string' },
          fromAsset: { type: 'string' },
          toChain: { type: 'string' },
          toAsset: { type: 'string' },
          amount: { type: 'string', description: 'Decimal source amount.' },
          recipientAddress: { type: 'string' },
        },
        required: ['fromChain', 'fromAsset', 'toChain', 'toAsset', 'amount', 'recipientAddress'],
      },
      handler: (params) => client.getQuotes(params),
    },
    {
      name: 'bridge_create_order',
      description: 'Create a bridge order from a previously-fetched quote.',
      inputSchema: {
        type: 'object',
        properties: {
          quoteId: { type: 'string' },
          timezone: { type: 'string' },
        },
        required: ['quoteId'],
      },
      handler: (params) => client.createOrder(params),
    },
    {
      name: 'bridge_get_order',
      description: 'Fetch the current status of a bridge order.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      handler: (params) => client.getOrder(params),
    },
    {
      name: 'bridge_get_order_audit',
      description: 'Fetch the audit log for a bridge order.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      handler: (params) => client.getOrderAudit(params),
    },
    {
      name: 'bridge_wait_for_order',
      description: 'Poll a bridge order until it reaches a target stage or fails.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          until: { type: 'string', description: 'Target stage (default COMPLETED).' },
          pollIntervalMs: { type: 'number' },
          timeoutMs: { type: 'number' },
        },
        required: ['id'],
      },
      handler: (params) => client.waitForOrder(params),
    },
    {
      name: 'bridge_swap',
      description:
        'End-to-end Aleo-source bridge swap: quote → select → order → Aleo unshield deposit → optional poll to completion. Requires a @veil/core WalletClient in the calling environment; the MCP host must provide it.',
      inputSchema: {
        type: 'object',
        properties: {
          from: {
            type: 'object',
            properties: { asset: { type: 'string' }, amount: { type: 'string' } },
            required: ['asset', 'amount'],
          },
          to: {
            type: 'object',
            properties: { chain: { type: 'string' }, asset: { type: 'string' }, address: { type: 'string' } },
            required: ['chain', 'asset', 'address'],
          },
          selectQuote: { type: 'string', enum: ['best', 'fastest'] },
          poll: { type: ['boolean', 'string'] },
          timezone: { type: 'string' },
        },
        required: ['from', 'to'],
      },
      handler: (params) => client.swap(params),
    },
  ]
}
```

- [ ] **Step 4: Create `packages/bridge/src/mcp/index.ts`**

```typescript
export { buildBridgeMcpTools, type McpTool, type McpToolSchema } from './tools.js'
```

- [ ] **Step 5: Create `packages/bridge/src/agent/index.ts`** (re-export the MCP shapes for agent consumers)

```typescript
export { buildBridgeMcpTools, type McpTool, type McpToolSchema } from '../mcp/tools.js'
```

- [ ] **Step 6: Run tests + typecheck + build**

Run: `pnpm --filter @veil/bridge test`
Expected: PASS.

Run: `pnpm --filter @veil/bridge typecheck`
Expected: PASS.

Run: `pnpm --filter @veil/bridge build`
Expected: PASS — `dist/agent/index.js` and `dist/mcp/index.js` now exist.

- [ ] **Step 7: Commit**

```bash
git add packages/bridge/src/mcp packages/bridge/src/agent packages/bridge/test/mcp
git commit -m "add MCP tool wrappers for bridge actions"
```

---

## Task 14: Workspace-wide green and final commit

- [ ] **Step 1: Run full workspace typecheck**

Run: `pnpm typecheck`
Expected: PASS across all packages.

- [ ] **Step 2: Run full workspace tests**

Run: `pnpm test`
Expected: PASS — previous 333 + new ~25 tests.

- [ ] **Step 3: Update the root README (if it lists packages) or `apps/loyalty-dapp/CLAUDE.md` if it tracks SDK surface**

Search: `grep -r "@veil/core" --include="*.md" .` from repo root.
If a "packages" list exists in a README, add `@veil/bridge` with one-line summary: "Cross-chain bridge client (Aleo ↔ other) over wallet-services-api".

- [ ] **Step 4: Commit any README/docs updates**

```bash
git add <changed-doc-files>
git commit -m "list @veil/bridge in package index"
```

If nothing changed, skip this commit.

---

## Out of Scope (for follow-ups)

- **Live integration test against WSA staging.** Drop a `.skip`'d vitest file at `packages/bridge/test/integration/swap.live.test.ts` once we have a staging URL + a funded test Aleo account. Today's tests are mock-only.
- **`swapInto` (other → Aleo).** Inbound flows currently use the primitives directly. Encapsulating them requires a chain-pluggable deposit-signer interface — defer until at least one consumer asks for it.
- **Quote expiry refresh inside `swap`.** Today `swap` uses whatever quote `selectQuote` returns; if it's stale `createOrder` will fail. Add re-fetch logic when WSA gives us a deterministic `expiresAt`.
- **Concurrent-order limit error mapping.** If WSA enforces it, surface as a typed error.

---

## Self-Review Notes

- Every action in the spec has a task (getQuotes/createOrder/getOrder/getOrderAudit/waitForOrder/swap).
- Every action has an MCP tool wrapper (Task 13).
- Direction asymmetry from the spec is honored: `swap` is Aleo-source-only; inbound uses primitives.
- `transfer_private_to_public` signature matches `@veil/core`'s `executeContract` shape; the swap test mocks it explicitly.
- Envelope helper is used inside every action that hits HTTP.
- Method names (`getQuotes`, `createOrder`, `getOrder`, `getOrderAudit`, `waitForOrder`, `swap`) match across decorator, MCP tool names (`bridge_*` snake_case prefix), and the index re-exports.
