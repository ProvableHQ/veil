export type Transaction = {
  id: string
  type: 'execute' | 'deploy' | 'fee'
  execution?: {
    transitions: Transition[]
  } | undefined
  deployment?: Record<string, unknown> | undefined
  fee: {
    transition: Transition
    globalStateRoot: string
    proof: string
  }
}

export type Transition = {
  id: string
  program: string
  function: string
  inputs: Array<{ type: string; id: string; value?: string }>
  outputs: Array<{ type: string; id: string; value?: string }>
  tpk: string
  tcm: string
}
