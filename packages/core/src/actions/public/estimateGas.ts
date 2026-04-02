import type { Client } from '../../clients/createClient.js'

export type EstimateGasParameters = { program: string; function: string; inputs: string[] }
export type EstimateGasReturnType = bigint

export async function estimateGas(client: Client, params: EstimateGasParameters): Promise<EstimateGasReturnType> {
  // Try to delegate to the transport — some providers support fee estimation.
  // If the transport returns a value, use it. Otherwise fall back to a
  // base fee heuristic.
  try {
    const result = await client.request({
      method: 'estimateFee',
      params: {
        programId: params.program,
        functionName: params.function,
        inputs: params.inputs,
      },
    })
    if (result !== undefined && result !== null) {
      const raw = String(result)
      const stripped = raw.replace(/u\d+$/, '')
      return BigInt(stripped)
    }
  } catch {
    // Provider doesn't support estimateFee — fall through to heuristic
  }

  // Base fee heuristic: Aleo requires a minimum base fee of 10_000 microcredits
  // for execution. More complex calls with more inputs cost proportionally more.
  const BASE_FEE = 10_000n
  const PER_INPUT_FEE = 1_000n
  return BASE_FEE + PER_INPUT_FEE * BigInt(params.inputs.length)
}
