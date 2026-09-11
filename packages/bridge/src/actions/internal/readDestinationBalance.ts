import { decodeFunctionResult, encodeFunctionData, getAddress, parseAbi } from 'viem'
import type { BridgeChainClients } from '../../connections/resolve.js'
import { requireEvmClient, requireSolanaClient } from '../../connections/resolve.js'
import { BridgeError } from '../../errors/bridgeErrors.js'
import type { BridgePlan, BridgeRegistry } from '../../types/protocol.js'

const ERC20_BALANCE_ABI = parseAbi(['function balanceOf(address owner) view returns (uint256)'])

/**
 * Reads a recipient balance that can serve as a fallback delivery signal.
 *
 * Native EVM and Solana balances and EVM ERC-20 balances are supported. The
 * helper returns `undefined` when the destination client or asset reader is not
 * configured, allowing status tracking to report that canonical verification
 * is unavailable rather than claim delivery. It never requests a signature or
 * moves funds.
 */
export async function readDestinationBalance(
  registry: BridgeRegistry,
  clients: BridgeChainClients,
  plan: BridgePlan,
): Promise<bigint | undefined> {
  const chain = registry.chains.find((candidate) => candidate.id === plan.destinationAsset.chainId)
  if (!chain) throw new BridgeError(`Unknown destination chain: ${plan.destinationAsset.chainId}`)
  if (!clients[chain.id]) return undefined

  if (chain.family === 'evm') {
    const recipient = getAddress(plan.recipient)
    const client = requireEvmClient(registry, clients, chain.id).publicClient
    // Native balance uses the account balance; ERC-20 delivery must call the
    // destination token selected by the reviewed route.
    if (plan.destinationAsset.locator?.kind === 'native') return client.getBalance(recipient)
    if (plan.destinationAsset.locator?.kind !== 'evm-contract') return undefined
    const data = encodeFunctionData({
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [recipient],
    })
    const result = await client.call({ to: getAddress(plan.destinationAsset.locator.value), data })
    return decodeFunctionResult({ abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', data: result })
  }

  if (chain.family === 'solana' && plan.destinationAsset.locator?.kind === 'native') {
    return requireSolanaClient(registry, clients, chain.id).publicClient.getBalance(plan.recipient)
  }

  // Aleo private records and unsupported token standards cannot be verified by
  // a public balance read, so callers need a protocol-specific delivery signal.
  return undefined
}
