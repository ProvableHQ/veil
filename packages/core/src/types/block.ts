export type Block = {
  blockHash: string
  previousHash: string
  header: Record<string, unknown>
  authority: Record<string, unknown>
  transactions?: ConfirmedTransaction[] | undefined
  height: number
  round: number
  timestamp: number
}

export type ConfirmedTransaction = {
  type: 'execute' | 'deploy' | 'fee'
  id: string
  transaction: Record<string, unknown>
}
