import { decodeFunctionResult, encodeFunctionData, getAddress, parseAbi } from 'viem'
import type { BridgeChainClients } from '../../connections/resolve.js'
import { requireEvmClient, requireSolanaClient } from '../../connections/resolve.js'
import { BridgeError } from '../../errors/bridgeErrors.js'
import type { BridgePlan, BridgeRegistry } from '../../types/protocol.js'

const ERC20_BALANCE_ABI = parseAbi(['function balanceOf(address owner) view returns (uint256)'])

/** Reads a supported destination asset balance, or returns undefined without a configured verifier. */
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

  return undefined
}
