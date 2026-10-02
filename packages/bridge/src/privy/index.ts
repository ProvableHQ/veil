import type { PrivyClient } from '@privy-io/node'
import type { CreateViemAccountInput } from '@privy-io/node/viem'
import { createEvmClient, evmLocalAccount, type EvmClient, type EvmTransport } from '../connections/evm.js'
import type { SolanaClient, SolanaTransport } from '../connections/solana.js'
import { BridgeError } from '../errors/bridgeErrors.js'
import { loadKit } from '../solana/kit.js'
import { createRemoteSolanaClient } from '../wallets/remoteSolana.js'

/**
 * Configures a Privy server wallet for EVM bridge transactions.
 *
 * @property client Authenticated Privy Node client owned by the caller.
 * @property walletId Existing Privy wallet identifier corresponding to address.
 * @property address EVM address belonging to walletId.
 * @property authorizationContext Optional wallet authorization context. Defaults to the provider's app authorization.
 * @property transport Public EVM RPC used for reads, transaction preparation, and broadcast.
 * @example const config: PrivyEvmClientConfig = { client: privy, walletId, address, transport: evmHttp(rpcUrl) }
 */
export type PrivyEvmClientConfig = Pick<CreateViemAccountInput, 'walletId' | 'address' | 'authorizationContext'> & {
  client: PrivyClient
  transport: EvmTransport
}

/**
 * Configures a Privy server wallet for Solana bridge transactions.
 *
 * @property client Authenticated Privy Node client owned by the caller.
 * @property walletId Existing Privy wallet identifier corresponding to address.
 * @property address Base58 Solana address belonging to walletId and paying transaction fees.
 * @property authorizationContext Optional wallet authorization context. Defaults to the provider's app authorization.
 * @property transport Public Solana RPC used for reads and broadcast.
 * @example const config: PrivySolanaClientConfig = { client: privy, walletId, address, transport: solanaHttp(rpcUrl) }
 */
export type PrivySolanaClientConfig = {
  client: PrivyClient
  walletId: string
  address: string
  authorizationContext?: CreateViemAccountInput['authorizationContext'] | undefined
  transport: SolanaTransport
}

/**
 * Connects an existing Privy EVM server wallet to the bridge through viem.
 *
 * Construction does not contact Privy or the chain. Submission requests a remote
 * signature and broadcasts through the configured RPC after chain and sender checks.
 *
 * @param config Existing wallet identity, authorization context, and public RPC transport.
 * @returns EVM capabilities accepted by createBridgeClient.
 * @throws BridgeError When the wallet identifier or transport is missing.
 * @example const ethereum = await createPrivyEvmClient({ client: privy, walletId, address, transport: evmHttp(rpcUrl) })
 */
export async function createPrivyEvmClient(config: PrivyEvmClientConfig): Promise<EvmClient> {
  if (!config.walletId.trim()) throw new BridgeError('Privy walletId must not be empty')
  if (!config.transport) throw new BridgeError('Privy EVM client requires a transport')
  const { createViemAccount } = await import('@privy-io/node/viem')
  const account = createViemAccount(config.client, {
    walletId: config.walletId,
    address: config.address,
    authorizationContext: config.authorizationContext,
  })
  return createEvmClient({ transport: config.transport, account: evmLocalAccount(account) })
}

/**
 * Connects an existing Privy Solana server wallet to the bridge.
 *
 * Construction does not contact Privy or the chain. Submission requests a signature,
 * preserves existing bridge signatures, and broadcasts through the configured RPC.
 *
 * @param config Existing wallet identity, authorization context, and public RPC transport.
 * @returns Solana capabilities accepted by createBridgeClient.
 * @throws BridgeError When the wallet identifier, address, or transport is invalid; submission rejects changed messages and invalid signatures.
 * @example const solana = await createPrivySolanaClient({ client: privy, walletId, address, transport: solanaHttp(rpcUrl) })
 */
export async function createPrivySolanaClient(config: PrivySolanaClientConfig): Promise<SolanaClient> {
  if (!config.walletId.trim()) throw new BridgeError('Privy walletId must not be empty')
  const { client, walletId, address, authorizationContext } = config
  return createRemoteSolanaClient({
    transport: config.transport,
    address,
    sign: async (wire, original) => {
      const result = await client.wallets().solana().signTransaction(walletId, {
        transaction: wire,
        ...(authorizationContext ? { authorization_context: authorizationContext } : {}),
      })
      if (result.encoding !== 'base64' || typeof result.signed_transaction !== 'string') {
        throw new BridgeError('Privy returned an invalid base64 Solana transaction')
      }
      const kit = await loadKit()
      const signed = kit.getTransactionDecoder().decode(Uint8Array.from(atob(result.signed_transaction), c => c.charCodeAt(0)))
      if (signed.messageBytes.length !== original.messageBytes.length ||
          signed.messageBytes.some((byte, index) => byte !== original.messageBytes[index])) {
        throw new BridgeError('Privy changed the Solana transaction message')
      }
      const signature = signed.signatures[kit.address(address)]
      if (!signature) throw new BridgeError('Privy returned no signature for the Solana wallet')
      return new Uint8Array(signature)
    },
  })
}
