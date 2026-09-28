/**
 * Overrides a runnable bridge example without changing its standalone defaults.
 * @property amount Decimal source-token amount; defaults to the example's visible amount.
 * @property execute Whether to submit transactions. Explicit false overrides inherited acknowledgement; omission uses EXECUTE_BRIDGE.
 */
export type ExampleOptions = { amount?: string, execute?: boolean }

/**
 * Reads optional gateway authentication without contacting a service.
 * @returns Provisioned edge authentication, legacy credentials, or no credentials.
 * @example
 * const options = serviceAuth()
 */
export function serviceAuth() {
  const consumerId = process.env.ALEO_CONSUMER_ID?.trim()
  const apiKey = process.env.ALEO_DPS_API_KEY?.trim()
  const edgeKey = process.env.EDGE_PROVABLE_API_KEY?.trim()
  if (consumerId) return { consumerId, apiKey }
  const value = edgeKey || apiKey
  return value ? { auth: { mode: 'api-key' as const, value } } : {}
}

/**
 * Reads Aleo proving configuration for mainnet example accounts.
 * @returns Delegated proving by default, optional gateway authentication, and an optional custom prover URL.
 * @throws When ALEO_PROVING_MODE is neither delegated nor local.
 * @example
 * const options = aleoExampleOptions()
 */
export function aleoExampleOptions() {
  const provingMode = process.env.ALEO_PROVING_MODE?.trim() || 'delegated'
  if (provingMode !== 'delegated' && provingMode !== 'local') {
    throw new Error('ALEO_PROVING_MODE must be delegated or local')
  }
  return { ...serviceAuth(), provingMode, proverUrl: process.env.ALEO_PROVER_URL?.trim() || undefined } as const
}
