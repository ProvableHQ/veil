import type { Client, WalletClient } from '@provablehq/veil-core'
import { getAssets, type GetAssetsReturnType } from '../../actions/getAssets.js'
import { getProviders, type GetProvidersReturnType } from '../../actions/getProviders.js'
import { getRoutes, type GetRoutesParameters, type GetRoutesReturnType } from '../../actions/getRoutes.js'
import { getFlags, type GetFlagsReturnType } from '../../actions/getFlags.js'
import { getQuotes, type GetQuotesParameters, type GetQuotesReturnType } from '../../actions/getQuotes.js'
import { createOrder, type CreateOrderParameters, type CreateOrderReturnType } from '../../actions/createOrder.js'
import { getOrder, type GetOrderParameters, type GetOrderReturnType } from '../../actions/getOrder.js'
import { getOrderAudit, type GetOrderAuditParameters, type GetOrderAuditReturnType } from '../../actions/getOrderAudit.js'
import { waitForOrder, type WaitForOrderParameters, type WaitForOrderReturnType } from '../../actions/waitForOrder.js'
import { swap, type SwapParameters, type SwapReturnType } from '../../actions/swap.js'

/**
 * Options carried from client construction into the bound actions.
 *
 * @property wallet Default WalletClient for `swap`'s Aleo deposit; a per-call
 *   `wallet` on SwapParameters overrides it.
 */
export type BridgeActionsConfig = {
  wallet?: WalletClient | undefined
}

export type BridgeActions = {
  getAssets: () => Promise<GetAssetsReturnType>
  getProviders: () => Promise<GetProvidersReturnType>
  getRoutes: (params?: GetRoutesParameters) => Promise<GetRoutesReturnType>
  getFlags: () => Promise<GetFlagsReturnType>
  getQuotes: (params: GetQuotesParameters) => Promise<GetQuotesReturnType>
  createOrder: (params: CreateOrderParameters) => Promise<CreateOrderReturnType>
  getOrder: (params: GetOrderParameters) => Promise<GetOrderReturnType>
  getOrderAudit: (params: GetOrderAuditParameters) => Promise<GetOrderAuditReturnType>
  waitForOrder: (params: WaitForOrderParameters) => Promise<WaitForOrderReturnType>
  swap: (params: SwapParameters) => Promise<SwapReturnType>
}

/**
 * Binds every bridge action to a client, viem-decorator style.
 *
 * @param client The client whose transport reaches the bridge API.
 * @param config Construction-time defaults — currently the signing wallet
 *   `swap` falls back to when the call does not carry one.
 * @returns The bound {@link BridgeActions}.
 */
export function bridgeActions(client: Client, config: BridgeActionsConfig = {}): BridgeActions {
  return {
    getAssets: () => getAssets(client),
    getProviders: () => getProviders(client),
    getRoutes: (params) => getRoutes(client, params),
    getFlags: () => getFlags(client),
    getQuotes: (params) => getQuotes(client, params),
    createOrder: (params) => createOrder(client, params),
    getOrder: (params) => getOrder(client, params),
    getOrderAudit: (params) => getOrderAudit(client, params),
    waitForOrder: (params) => waitForOrder(client, params),
    // ?? (not spread order) so an explicitly-undefined params.wallet cannot
    // clobber the client's configured wallet.
    swap: (params) => swap(client, { ...params, wallet: params.wallet ?? config.wallet }),
  }
}
