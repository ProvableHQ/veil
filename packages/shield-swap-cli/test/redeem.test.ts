import { rmSync } from 'node:fs'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '@provablehq/shield-swap-sdk'

const storage = vi.hoisted(() => ({ root: '' }))
vi.mock('../src/session.js', async (original) => {
  // Keep persistence real, but isolate it from the caller's wallet files.
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  storage.root = mkdtempSync(join(tmpdir(), 'shield-swap-redeem-'))
  vi.stubEnv('SHIELD_SWAP_STATE_DIR', storage.root)
  return { ...await original<typeof import('../src/session.js')>(), loadSession: vi.fn() }
})

import { loadSession, loadState, resolveNetwork, saveState } from '../src/session.js'
import { COMMANDS } from '../src/registry.js'
import { setJsonMode } from '../src/shared.js'

let stdout: string[]
let stderr: string[]
let requests: Array<{ url: string; init: RequestInit }>
let response: Response
let previousExitCode: typeof process.exitCode

beforeEach(() => {
  stdout = []
  stderr = []
  requests = []
  response = Response.json({ data: { code: 'REF123', status: 'redeemed' } })
  previousExitCode = process.exitCode
  process.exitCode = undefined
  vi.stubEnv('SHIELD_SWAP_NETWORK', 'testnet')
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => void stdout.push(String(line)))
  vi.spyOn(console, 'error').mockImplementation((line: unknown) => void stderr.push(String(line)))
  vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`EXIT:${code}`) })

  for (const network of ['testnet', 'mainnet'] as const) {
    saveState({ network, address: `aleo1-${network}`, privateKey: 'test-fixture-key', accessRedeemed: false })
  }
  // Session construction signs and authenticates over the network. Replace that
  // boundary while exercising the real API client, output, and state writes.
  vi.mocked(loadSession).mockImplementation(async (options = {}) => {
    const network = resolveNetwork(options.network)
    const state = loadState(network)
    const api = new ApiClient({
      baseUrl: `https://${network}.example`,
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init! })
        return response
      },
    })
    api.setToken('test-session')
    return { client: { api }, account: { address: state.address }, state, network } as Awaited<ReturnType<typeof loadSession>>
  })
})

afterEach(() => {
  process.exitCode = previousExitCode
  setJsonMode(false)
  vi.restoreAllMocks()
  vi.mocked(loadSession).mockReset()
})

afterAll(() => {
  vi.unstubAllEnvs()
  rmSync(storage.root, { recursive: true, force: true })
})

async function redeem(argv: string[]) {
  // Match the dispatcher, which selects JSON mode before loading the command.
  setJsonMode(argv.includes('--json'))
  expect(COMMANDS.redeem, 'redeem must be reachable from the CLI').toBeDefined()
  await (await COMMANDS.redeem!.load()).main(argv)
}

describe('redeem command', () => {
  it('previews the account and code without redeeming or updating state', async () => {
    await redeem(['--code', 'REF123', '--json'])

    expect(requests).toEqual([])
    expect(loadState('testnet').accessRedeemed).toBe(false)
    expect(JSON.parse(stdout.join('\n'))).toEqual({
      network: 'testnet', address: 'aleo1-testnet', submitted: false, code: 'REF123',
    })
    expect(stderr).toEqual([])
  })

  it('redeems with session auth and persists access only for the selected network', async () => {
    await redeem(['--code', ' REF123 ', '--network', 'mainnet', '--execute', '--json'])

    expect(requests).toHaveLength(1)
    expect(requests[0]!.url).toBe('https://mainnet.example/referral/redeem')
    expect(requests[0]!.init.method).toBe('POST')
    expect(new Headers(requests[0]!.init.headers).get('authorization')).toBe('Bearer test-session')
    expect(JSON.parse(String(requests[0]!.init.body))).toEqual({ code: 'REF123' })
    expect(loadState('mainnet')).toEqual({
      network: 'mainnet', address: 'aleo1-mainnet', privateKey: 'test-fixture-key', accessRedeemed: true,
    })
    expect(loadState('testnet').accessRedeemed).toBe(false)
    expect(JSON.parse(stdout.join('\n'))).toEqual({
      network: 'mainnet', address: 'aleo1-mainnet', submitted: true, code: 'REF123', status: 'redeemed',
    })
    expect(stderr).toEqual([])
  })

  it.each([
    { label: 'missing', argv: [] },
    { label: 'empty', argv: ['--code', ''] },
    { label: 'whitespace', argv: ['--code', '   '] },
  ])('rejects $label codes before authenticating', async ({ argv }) => {
    await expect(redeem([...argv, '--execute', '--json'])).rejects.toThrow('EXIT:1')

    expect(loadSession).not.toHaveBeenCalled()
    expect(JSON.parse(stdout.join('\n')).error.message).toContain('--code')
    expect(stderr).toEqual([])
  })

  it('reports rejected codes as JSON without recording access', async () => {
    response = Response.json({ error: 'Invalid or already-used referral code' }, { status: 400 })
    await redeem(['--code', 'REF123', '--execute', '--json'])

    expect(process.exitCode).toBe(1)
    expect(JSON.parse(stdout.join('\n')).error.message).toContain('Invalid or already-used referral code')
    expect(stderr).toEqual([])
    expect(loadState('testnet').accessRedeemed).toBe(false)
  })

  it('prints the redemption result for a person', async () => {
    await redeem(['--code', 'REF123', '--execute'])

    expect(stdout.join('\n')).toContain('REF123')
    expect(stdout.join('\n')).toContain('redeemed')
    expect(stdout.join('\n')).toContain('aleo1-testnet')
    expect(stderr).toEqual([])
  })

  it('shows help without loading an account', async () => {
    await expect(redeem(['--help'])).rejects.toThrow('EXIT:0')

    expect(loadSession).not.toHaveBeenCalled()
    expect(stdout.join('\n')).toContain('--code')
    expect(stdout.join('\n')).toContain('--execute')
  })

  it('previews generation without requesting a code or updating access', async () => {
    await redeem(['--generate', '--json'])

    expect(requests).toEqual([])
    expect(loadState('testnet').accessRedeemed).toBe(false)
    expect(JSON.parse(stdout.join('\n'))).toEqual({
      network: 'testnet', address: 'aleo1-testnet', submitted: false, action: 'generate',
    })
  })

  it('requests the account shareable code with session auth on the selected network', async () => {
    response = Response.json({ data: { code: 'SHARE123' } })
    const originalState = loadState('mainnet')
    await redeem(['--generate', '--network', 'mainnet', '--execute', '--json'])

    expect(requests).toHaveLength(1)
    expect(requests[0]!.url).toBe('https://mainnet.example/referral/my-code')
    expect(requests[0]!.init.method).toBe('GET')
    expect(new Headers(requests[0]!.init.headers).get('authorization')).toBe('Bearer test-session')
    expect(JSON.parse(stdout.join('\n'))).toEqual({
      network: 'mainnet', address: 'aleo1-mainnet', submitted: true, action: 'generate', code: 'SHARE123',
    })
    expect(loadState('mainnet')).toEqual(originalState)
    expect(stderr).toEqual([])
  })

  it('rejects generation combined with redemption before authenticating', async () => {
    await expect(redeem(['--generate', '--code', 'REF123', '--execute', '--json'])).rejects.toThrow('EXIT:1')

    expect(loadSession).not.toHaveBeenCalled()
    expect(JSON.parse(stdout.join('\n')).error.message).toMatch(/--generate.*--code/)
  })

  it('reports an unavailable personal code without claiming access was granted', async () => {
    response = Response.json({ data: { code: null } })
    await redeem(['--generate', '--execute', '--json'])

    expect(process.exitCode).toBe(1)
    expect(JSON.parse(stdout.join('\n')).error.message).toMatch(/no.*referral code/i)
    expect(loadState('testnet').accessRedeemed).toBe(false)
  })

  it('reports generation API errors as JSON without changing state', async () => {
    response = Response.json({ error: 'Terms acceptance required' }, { status: 403 })
    await redeem(['--generate', '--execute', '--json'])

    expect(process.exitCode).toBe(1)
    expect(JSON.parse(stdout.join('\n')).error.message).toContain('Terms acceptance required')
    expect(loadState('testnet').accessRedeemed).toBe(false)
    expect(stderr).toEqual([])
  })

  it('prints the shareable code for a person', async () => {
    response = Response.json({ data: { code: 'SHARE123' } })
    await redeem(['--generate', '--execute'])

    expect(stdout.join('\n')).toContain('SHARE123')
    expect(stdout.join('\n')).not.toContain('redeemed')
    expect(loadState('testnet').accessRedeemed).toBe(false)
  })
})
