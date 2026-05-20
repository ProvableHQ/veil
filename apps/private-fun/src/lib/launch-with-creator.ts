import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js'
import { BN } from '@coral-xyz/anchor'
import { PumpSdk, OnlinePumpSdk } from '@pump-fun/pump-sdk'
import type { LaunchWithCreator } from './recipes/pump-launch.js'

const SOLANA_RPC = import.meta.env.VITE_SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com'

/**
 * Launches a pump.fun token using the real pump-sdk v1.36 API.
 *
 * Real API notes:
 * - PumpSdk (offline) exposes createAndBuyInstructions() returning TransactionInstruction[].
 * - Requires a pre-fetched Global account (via OnlinePumpSdk.fetchGlobal()).
 * - mint must be a fresh Keypair; its public key is passed in, and it must co-sign the tx.
 * - amount (token amount as BN) is set to 0 so the buy is driven entirely by solAmount.
 * - solAmount is in lamports as BN.
 * - The mint address is known before sending — it's the keypair we generate.
 */
export const launchWithCreator: LaunchWithCreator = async ({
  creator,
  metadataUri,
  metadata,
  initialBuySol,
}) => {
  const conn = new Connection(SOLANA_RPC, 'confirmed')
  const onlineSdk = new OnlinePumpSdk(conn)
  const offlineSdk = new PumpSdk()

  const global = await onlineSdk.fetchGlobal()

  const mintKeypair = Keypair.generate()
  const creatorPk = new PublicKey(creator.publicKey)
  const lamports = Math.floor(Number(initialBuySol) * 1_000_000_000)

  const instructions = await offlineSdk.createAndBuyInstructions({
    global,
    mint: mintKeypair.publicKey,
    name: metadata.name,
    symbol: metadata.symbol,
    uri: metadataUri,
    creator: creatorPk,
    user: creatorPk,
    // amount=0 means the buy is driven by solAmount (spend exactly solAmount of SOL)
    amount: new BN(0),
    solAmount: new BN(lamports),
  })

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed')
  const tx = new Transaction({ feePayer: creatorPk, blockhash, lastValidBlockHeight })
  tx.add(...instructions)

  // mint keypair must sign because pump.fun creates the mint account
  tx.partialSign(mintKeypair)

  // creator wallet signs (and may already be partial-signed by mint above)
  const signed = await creator.signTransaction(tx)
  const sig = await conn.sendRawTransaction((signed as Transaction).serialize())
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')

  return {
    tokenMint: mintKeypair.publicKey.toBase58(),
    solanaTxSignature: sig,
  }
}
