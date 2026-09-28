import type { QuoteParameters, ShieldSwapActions, SwapPlan, SwapQuote } from '@provablehq/shield-swap-sdk'

/**
 * Prepares an executable quote while preserving the CLI's existing plan output.
 * Fetches imports once for both swap submission and the later claim.
 * @param client Configured DEX actions supplying quote, metadata and program reads.
 * @param params Tokens, raw input amount and optional slippage/deployment overrides.
 * @returns The legacy display plan plus the exact quote used for submission.
 * @throws When quoting, token resolution or program retrieval fails.
 */
export async function planQuotedSwap(
  client: Pick<ShieldSwapActions, 'quote' | 'tokenData' | 'resolveDexImports'>,
  params: QuoteParameters,
): Promise<SwapPlan & { quote: SwapQuote }> {
  const quote = await client.quote(params)
  const ids = new Set(quote.hops.flatMap((hop) => [hop.tokenInId, hop.tokenOutId]))
  const tokens = await Promise.all([...ids].map((id) => client.tokenData(id)))
  const imports = await client.resolveDexImports({
    tokenPrograms: tokens.flatMap((token) => token.ammTokenProgram ? [token.ammTokenProgram] : []),
    program: quote.program,
  })
  return {
    from: quote.from, to: quote.to, amountIn: quote.amountIn,
    expectedOut: quote.expectedOut, minOut: quote.minOut, slippageBps: quote.slippageBps,
    poolKeys: quote.hops.map((hop) => hop.poolKey), multiHop: quote.hops.length > 1,
    imports, quote,
  }
}
