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
  ['hyperlane:aleo/usdt->ethereum/usdt', 'hyp_warp_token_usdt_v2.aleo', '0x0000000000000000000000000000000000000001'],
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
    expect(call.inputs[1]).toBe('{ default_hook: aleo194tz0jmyq8rd9htvnqppqw4jqerk2p2zd8plzn3sxl06wcgsm5pq9fka74, required_hook: aleo1yxevh9qgxehej46j7vueplwjcpfdfml2dje3ey4ukzknx7wzasgqnxgq82 }')
    expect(call.inputs[6]).toContain('amount: 0u64')
    expect((call.inputs[6] as string).match(/spender:/g)).toHaveLength(4)
    expect(call.placeholderFields).not.toContain('aleoMailboxDefaultHook')
    expect(call.placeholderFields).not.toContain('aleoMailboxRequiredHook')
  })

  it('derives the EVM recipient while retaining deterministic dummy router values', () => {
    const call = buildAleoHyperlaneTransferRemoteCall(DEFAULT_BRIDGE_REGISTRY, {
      plan: plan(ROUTES[4][0], ROUTES[4][2]),
    })
    expect(call.inputs[3]).toBe('1u32')
    expect(call.inputs[4]).toBe('[0u128, 1329227995784915872903807060280344576u128]')
    expect(call.inputs[5]).toBe('1000000u128')
    expect(call.inputs[2]).toContain('gas: 0u128')
    expect(call.placeholderFields).not.toContain('aleoRecipient')
  })

  it('uses verified ETH app metadata and remote router configuration', () => {
    const call = buildAleoHyperlaneTransferRemoteCall(DEFAULT_BRIDGE_REGISTRY, {
      plan: plan(ROUTES[0][0], ROUTES[0][2]),
      mode: 'signer',
    })
    expect(call.function).toBe('transfer_remote_as_signer')
    expect(call.inputs[0]).toBe('{ token_type: 1u8, token_owner: aleo1wq6f6qdqya44avznygz5hae40u3mjg64w0r93a4qfu4utpf8cg9q566f4r, ism: aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc, hook: aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc, token_id: 133188123661477349522757068766864658505569365361420630212878794317749195359field, local_decimals: 18u8, remote_decimals: 18u8 }')
    expect(call.inputs[2]).toBe('{ domain: 1u32, recipient: [0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 56u8, 212u8, 71u8, 105u8, 79u8, 92u8, 31u8, 119u8, 58u8, 227u8, 19u8, 44u8, 249u8, 59u8, 243u8, 11u8, 126u8, 193u8, 250u8, 90u8], gas: 44000u128 }')
    expect(call.inputs[4]).toBe('[0u128, 1329227995784915872903807060280344576u128]')
    expect(call.placeholderFields).toEqual(['aleoAllowanceAmount0'])
  })

  it('uses verified WBTC app metadata while retaining unresolved route fields', () => {
    const call = buildAleoHyperlaneTransferRemoteCall(DEFAULT_BRIDGE_REGISTRY, {
      plan: plan(ROUTES[1][0], ROUTES[1][2]),
      mode: 'signer',
    })
    expect(call.function).toBe('transfer_remote_as_signer')
    expect(call.inputs[0]).toBe('{ token_type: 1u8, token_owner: aleo14jauje2a5sncm9u5t3mt6qqv3eq2hatkddskccs0dvsy35a0x58q0d6f95, ism: aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc, hook: aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc, token_id: 1505227928464760254508513036497943623956572091841806589002910775534260084309field, local_decimals: 8u8, remote_decimals: 8u8 }')
    expect(call.inputs[2]).toBe('{ domain: 1u32, recipient: [0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 32u8, 205u8, 200u8, 87u8, 120u8, 183u8, 50u8, 7u8, 63u8, 126u8, 236u8, 239u8, 61u8, 242u8, 92u8, 13u8, 49u8, 15u8, 135u8, 114u8], gas: 68000u128 }')
    expect(call.placeholderFields).not.toContain('aleoTokenType')
    expect(call.placeholderFields).not.toContain('aleoTokenOwner')
    expect(call.placeholderFields).not.toContain('aleoIsm')
    expect(call.placeholderFields).not.toContain('aleoHook')
    expect(call.placeholderFields).not.toContain('aleoTokenId')
    expect(call.placeholderFields).toEqual(['aleoAllowanceAmount0'])
    expect(call.usesPlaceholderConfiguration).toBe(true)
  })

  it('uses verified USDT metadata, scaling, and the Ethereum remote router', () => {
    const call = buildAleoHyperlaneTransferRemoteCall(DEFAULT_BRIDGE_REGISTRY, {
      plan: plan(ROUTES[2][0], ROUTES[2][2]),
      mode: 'signer',
    })
    expect(call.function).toBe('transfer_remote_as_signer')
    expect(call.inputs[0]).toBe('{ token_type: 1u8, token_owner: aleo1l3gwacmjruxryy9c7c4fn0acyzprf29hucrvthw7f63lpyhd5y9srydq8z, ism: aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc, hook: aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc, token_id: 8295938150000417034830036849466229528602563851235385582732969109393809606969field, local_decimals: 6u8, remote_decimals: 18u8 }')
    expect(call.inputs[2]).toBe('{ domain: 1u32, recipient: [0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 60u8, 32u8, 100u8, 215u8, 142u8, 69u8, 120u8, 232u8, 249u8, 54u8, 227u8, 219u8, 66u8, 174u8, 240u8, 68u8, 227u8, 63u8, 191u8, 49u8], gas: 68000u128 }')
    expect(call.placeholderFields).toEqual(['aleoAllowanceAmount0'])
  })

  it('uses verified SOL metadata and the Solana remote router', () => {
    const call = buildAleoHyperlaneTransferRemoteCall(DEFAULT_BRIDGE_REGISTRY, {
      plan: plan(ROUTES[3][0], ROUTES[3][2]),
      mode: 'signer',
    })
    expect(call.function).toBe('transfer_remote_as_signer')
    expect(call.inputs[0]).toBe('{ token_type: 1u8, token_owner: aleo1wr8rfr4ggedjxtg5e23s38zqkgy2j05uc9l8t4akjp5zcw3levpswkwk45, ism: aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc, hook: aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc, token_id: 6148061383892805373029428966764338809222769879628268522058032128225601478383field, local_decimals: 9u8, remote_decimals: 9u8 }')
    expect(call.inputs[2]).toBe('{ domain: 1399811149u32, recipient: [112u8, 4u8, 72u8, 22u8, 219u8, 143u8, 68u8, 202u8, 21u8, 197u8, 236u8, 182u8, 198u8, 142u8, 52u8, 96u8, 142u8, 38u8, 51u8, 113u8, 116u8, 143u8, 96u8, 123u8, 104u8, 126u8, 97u8, 73u8, 7u8, 6u8, 211u8, 122u8], gas: 300000u128 }')
    expect(call.inputs[3]).toBe('1399811149u32')
    expect(call.inputs[4]).toBe('[0u128, 0u128]')
    expect(call.placeholderFields).toEqual(['aleoAllowanceAmount0'])
  })

  it('rejects unknown transfer modes', () => {
    expect(() => buildAleoHyperlaneTransferRemoteCall(DEFAULT_BRIDGE_REGISTRY, {
      plan: plan(),
      mode: 'unknown' as 'caller',
    })).toThrow(/Unsupported Aleo Hyperlane transfer mode/)
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
