import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type LiveState = {
  routeId: string
  sourceTxId?: string
  messageId?: string
  destinationTxId?: string
  destinationBalanceBefore?: string
  completed?: boolean
  sourceReceipt?: unknown
  checkpoint?: unknown
}

export function loadLiveState(path: string, routeId: string): LiveState {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`Live state is not an object: ${path}`)
    const state = parsed as LiveState
    if (state.routeId !== routeId) throw new Error(`Live state route ${String(state.routeId)} does not match ${routeId}`)
    for (const field of ['sourceTxId', 'messageId', 'destinationTxId', 'destinationBalanceBefore'] as const) {
      if (state[field] !== undefined && typeof state[field] !== 'string') throw new Error(`Live state ${field} is invalid: ${path}`)
    }
    if (state.completed !== undefined && typeof state.completed !== 'boolean') throw new Error(`Live state completed flag is invalid: ${path}`)
    return state
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return { routeId }
    throw error
  }
}

export function saveLiveState(path: string, state: LiveState): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}

export async function waitFor<T>(read: () => Promise<T | undefined>, timeoutMs = 20 * 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  do {
    const value = await read()
    if (value !== undefined) return value
    if (Date.now() >= deadline) throw new Error('Live bridge verification timed out; resume with the persisted state file')
    await new Promise((resolve) => setTimeout(resolve, 15_000))
  } while (true)
}

export async function waitForHyperlaneDelivery(originTxHash: string): Promise<{ messageId: string; destinationTxId: string }> {
  return waitFor(async () => {
    const response = await fetch('https://explorer4.hasura.app/v1/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `query ByOrigin($hash: String!) {
          message_view(where: {origin_tx_hash: {_eq: $hash}}, limit: 1) {
            msg_id is_delivered destination_tx_hash
          }
        }`,
        variables: { hash: originTxHash },
      }),
    })
    if (!response.ok) throw new Error(`Hyperlane explorer returned HTTP ${response.status}`)
    const body = await response.json() as { data?: { message_view?: Array<{ msg_id?: string; is_delivered?: boolean; destination_tx_hash?: string }> } }
    const message = body.data?.message_view?.[0]
    if (!message?.is_delivered || !message.msg_id || !message.destination_tx_hash) return undefined
    return {
      messageId: message.msg_id.startsWith('\\x') ? `0x${message.msg_id.slice(2)}` : message.msg_id,
      destinationTxId: message.destination_tx_hash,
    }
  })
}

export async function waitForAleoTransaction(client: { getTransaction(params: { id: string }): Promise<unknown> }, id: string): Promise<void> {
  await waitFor(async () => {
    try {
      return await client.getTransaction({ id }) ? true : undefined
    } catch {
      return undefined
    }
  })
}
