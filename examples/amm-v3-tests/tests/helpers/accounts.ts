import { createDevnodeClient } from '@veil/provable'

export const DEVNODE_KEYS = {
  admin: 'APrivateKey1zkp8CZNn3yeCseEtxuVPbDCwSyhGW6yZKUYKfgXmcpoGPWH',
  user1: 'APrivateKey1zkp2RWGDcde3efb89rjhME1VYA8QMxcxep5DShNBR6n8Yjh',
  user2: 'APrivateKey1zkpBuV4Wu1ywav6k8BJRvJ9eo6Pao7usGF9hgK43SyvdbJq',
} as const

export type AccountName = keyof typeof DEVNODE_KEYS

export function makeClients(name: AccountName, socketAddr: string) {
  return createDevnodeClient({ privateKey: DEVNODE_KEYS[name], socketAddr })
}
