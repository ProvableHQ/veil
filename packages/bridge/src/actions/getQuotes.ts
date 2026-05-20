import type { Client } from '@veil/core'
import { unwrapEnvelope } from '../utils/unwrapEnvelope.js'
import type { BridgeQuote, GetQuotesMeta } from '../types/bridge.js'

export type GetQuotesParameters = {
  srcChain: string
  destChain: string
  srcAsset: string
  destAsset: string
  amountIn: string
  slippageBps?: string | undefined
  fromAddress?: string | undefined
  recipientAddress?: string | undefined
  refundAddress?: string | undefined
}

export type GetQuotesReturnType = {
  quotes: BridgeQuote[]
  meta: GetQuotesMeta
}

export async function getQuotes(
  client: Client,
  params: GetQuotesParameters,
): Promise<GetQuotesReturnType> {
  const response = await client.request({ method: 'getBridgeQuotes', params })
  const { data, meta } = unwrapEnvelope<BridgeQuote[]>(
    response as { data: BridgeQuote[]; meta?: Record<string, unknown> },
    { keepMeta: true },
  )
  return { quotes: data, meta: meta as GetQuotesMeta }
}
