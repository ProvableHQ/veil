import type { EvmClient, EvmWalletClient } from '../connections/evm.js'
import type { BridgeRegistry } from '../types/protocol.js'
import type { EvmXReserveTransferQuote, QuoteEvmXReserveTransferParameters } from '../types/xreserve.js'
import { runQuoteEvmXReserveTransfer as quoteTransfer } from './internal/evmXReserve.js'

/**
 * Quotes an Ethereum-to-Aleo Circle xReserve deposit.
 *
 * Reads live balance and allowance state without signing or moving funds.
 *
 * @param registry Reviewed deployment snapshot.
 * @param client EVM client with a wallet address to quote.
 * @param params Prepared xReserve transfer.
 * @returns Deposit values, balance, allowance, and approval requirement.
 * @throws BridgeError When metadata, wallet state, balance, or recipient data is invalid.
 * @example const quote = await quoteEvmXReserveTransfer(registry, client, { plan })
 */
export async function quoteEvmXReserveTransfer(
  registry: BridgeRegistry,
  client: EvmClient & { walletClient: EvmWalletClient },
  params: QuoteEvmXReserveTransferParameters,
): Promise<EvmXReserveTransferQuote> {
  return quoteTransfer(registry, client, params)
}
