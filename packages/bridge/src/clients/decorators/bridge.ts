import type { Client } from '@veil/core'
import { getQuotes, type GetQuotesParameters, type GetQuotesReturnType } from '../../actions/getQuotes.js'
import { createOrder, type CreateOrderParameters, type CreateOrderReturnType } from '../../actions/createOrder.js'
import { getOrder, type GetOrderParameters, type GetOrderReturnType } from '../../actions/getOrder.js'
import { getOrderAudit, type GetOrderAuditParameters, type GetOrderAuditReturnType } from '../../actions/getOrderAudit.js'
import { waitForOrder, type WaitForOrderParameters, type WaitForOrderReturnType } from '../../actions/waitForOrder.js'
import { swap, type SwapParameters, type SwapReturnType } from '../../actions/swap.js'

export type BridgeActions = {
  getQuotes: (params: GetQuotesParameters) => Promise<GetQuotesReturnType>
  createOrder: (params: CreateOrderParameters) => Promise<CreateOrderReturnType>
  getOrder: (params: GetOrderParameters) => Promise<GetOrderReturnType>
  getOrderAudit: (params: GetOrderAuditParameters) => Promise<GetOrderAuditReturnType>
  waitForOrder: (params: WaitForOrderParameters) => Promise<WaitForOrderReturnType>
  swap: (params: SwapParameters) => Promise<SwapReturnType>
}

export function bridgeActions(client: Client): BridgeActions {
  return {
    getQuotes: (params) => getQuotes(client, params),
    createOrder: (params) => createOrder(client, params),
    getOrder: (params) => getOrder(client, params),
    getOrderAudit: (params) => getOrderAudit(client, params),
    waitForOrder: (params) => waitForOrder(client, params),
    swap: (params) => swap(client, params),
  }
}
