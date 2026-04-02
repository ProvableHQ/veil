import type { ViewOnlyAccount } from '../types/account.js'

type ViewOnlyAccountSource = {
  address: string
  viewKey: string
}

export function viewOnlyAccount(source: ViewOnlyAccountSource): ViewOnlyAccount {
  return {
    type: 'viewOnly',
    address: source.address,
    viewKey: source.viewKey,
  }
}
