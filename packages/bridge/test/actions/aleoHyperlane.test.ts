import { describe, expect, it, vi } from 'vitest'
import {
  buildAleoHyperlaneTransferRemoteCall,
  executeAleoHyperlaneTransferRemote,
} from '../../src/actions/aleoHyperlane.js'
import { prepareTransfer } from '../../src/actions/prepareTransfer.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import type { AleoBridgeExecutor } from '../../src/types/aleo.js'

const ROUTES = [
  ['hyperlane:aleo/eth->ethereum/eth', 'hyp_warp_token_eth_v2.aleo', '0x0000000000000000000000000000000000000001'],
  ['hyperlane:aleo/wbtc->ethereum/wbtc', 'hyp_warp_token_wbtc_v2.aleo', '0x0000000000000000000000000000000000000001'],
  ['hyperlane:aleo/sol->solana/sol', 'hyp_warp_token_sol_v2.aleo', '11111111111111111111111111111111'],
  ['hyperlane:aleo/usad->ethereum/usad', 'hyp_warp_token_usad_v2.aleo', '0x0000000000000000000000000000000000000001'],
] as const

function plan(routeId = ROUTES[0][0], recipient = ROUTES[0][2]) {
  return prepareTransfer(DEFAULT_BRIDGE_REGISTRY, { routeId, amount: '1', recipient })
}

describe('Aleo Hyperlane transfer_remote', () => {
  it.each(ROUTES)('constructs all seven inputs for %s', (routeId, program, recipient) => {
    const call = buildAleoHyperlaneTransferRemoteCall(DEFAULT_BRIDGE_REGISTRY, {
      plan: plan(routeId, recipient),
    })
    expect(call).toMatchObject({
      routeId,
      program,
      function: 'transfer_remote',
      usesPlaceholderConfiguration: true,
    })
    expect(call.inputs).toHaveLength(7)
    expect(call.inputs[6]).toContain('amount: 0u64')
    expect((call.inputs[6] as string).match(/spender:/g)).toHaveLength(4)
  })

  it('uses conspicuous deterministic dummy recipient and router values', () => {
    const call = buildAleoHyperlaneTransferRemoteCall(DEFAULT_BRIDGE_REGISTRY, { plan: plan() })
    expect(call.inputs[3]).toBe('1u32')
    expect(call.inputs[4]).toBe('[0u128, 0u128]')
    expect(call.inputs[5]).toBe('1000000000000000000u128')
    expect(call.inputs[2]).toContain('gas: 0u128')
    expect(call.placeholderFields).toContain('aleoRecipient')
  })

  it('refuses placeholder submission before invoking the Aleo wallet', async () => {
    const executeTransaction = vi.fn<AleoBridgeExecutor['executeTransaction']>()
    await expect(executeAleoHyperlaneTransferRemote(
      DEFAULT_BRIDGE_REGISTRY,
      { executeTransaction },
      { plan: plan() },
    )).rejects.toThrow(/non-executable placeholder configuration/)
    expect(executeTransaction).not.toHaveBeenCalled()
  })

  it('also requires an active route after placeholder replacement', async () => {
    const executeTransaction = vi.fn<AleoBridgeExecutor['executeTransaction']>()
    const registry = {
      ...DEFAULT_BRIDGE_REGISTRY,
      routes: DEFAULT_BRIDGE_REGISTRY.routes.map((route) => route.id === ROUTES[0][0]
        ? { ...route, metadata: { ...route.metadata, aleoPlaceholderConfiguration: false } }
        : route),
    }
    const replacementPlan = prepareTransfer(registry, {
      routeId: ROUTES[0][0],
      amount: '1',
      recipient: ROUTES[0][2],
    })
    await expect(executeAleoHyperlaneTransferRemote(
      registry,
      { executeTransaction },
      { plan: replacementPlan },
    )).rejects.toThrow(/route is not active/)
    expect(executeTransaction).not.toHaveBeenCalled()
  })
})
