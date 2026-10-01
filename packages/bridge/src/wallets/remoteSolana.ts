import bs58 from 'bs58'
import type { Transaction } from '@solana/kit'
import { createSolanaClient, type SolanaClient, type SolanaTransport } from '../connections/solana.js'
import { BridgeError } from '../errors/bridgeErrors.js'
import { loadKit } from '../solana/kit.js'

/**
 * Adds a remotely produced fee-payer signature while retaining every existing signature.
 *
 * Construction validates the address without contacting a provider. Submission
 * verifies the returned signature against the original message before broadcasting.
 *
 * @param config Public transport, expected fee payer, and remote signature callback.
 * @returns Solana capabilities accepted by the bridge client.
 * @throws BridgeError When the address, fee payer, or returned signature is invalid.
 * @example const client = createRemoteSolanaClient({ transport, address, sign })
 */
export function createRemoteSolanaClient(config: {
  transport: SolanaTransport
  address: string
  sign: (wire: Uint8Array, transaction: Transaction) => Promise<Uint8Array>
}): SolanaClient {
  try {
    if (bs58.decode(config.address).length !== 32) throw new Error('Expected 32 bytes')
  } catch (cause) {
    throw new BridgeError('Remote Solana wallet requires a valid 32-byte address', { cause })
  }
  const client = createSolanaClient({ transport: config.transport })
  const walletAddress = config.address
  return {
    ...client,
    walletClient: {
      getAddress: async () => walletAddress,
      sendTransaction: async wire => {
        const kit = await loadKit()
        const transaction = kit.getTransactionDecoder().decode(new Uint8Array(wire))
        // The bridge source wallet pays fees; all other signers must already be signed.
        if (Object.keys(transaction.signatures)[0] !== walletAddress) {
          throw new BridgeError('Remote Solana wallet does not match the transaction fee payer')
        }
        for (const [signer, signature] of Object.entries(transaction.signatures)) {
          if (signer !== walletAddress && !signature) {
            throw new BridgeError(`Solana transaction is missing the signature for ${signer}`)
          }
        }
        const signature = await config.sign(new Uint8Array(wire), transaction)
        if (!(signature instanceof Uint8Array) || signature.length !== 64) {
          throw new BridgeError('Remote Solana wallet returned an invalid 64-byte signature')
        }
        const publicKey = await kit.getPublicKeyFromAddress(kit.address(walletAddress))
        const signatureBytes = kit.signatureBytes(signature)
        if (!await kit.verifySignature(publicKey, signatureBytes, transaction.messageBytes)) {
          throw new BridgeError('Remote Solana signature does not match the wallet and transaction message')
        }
        // Only the fee-payer slot is replaced. Ephemeral bridge signatures stay intact.
        const signed = { ...transaction, signatures: { ...transaction.signatures, [walletAddress]: signatureBytes } }
        return client.publicClient.sendTransaction(new Uint8Array(kit.getTransactionEncoder().encode(signed)))
      },
    },
  }
}
