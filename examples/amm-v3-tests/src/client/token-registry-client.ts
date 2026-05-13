import type { PublicClient } from '@veil/core'
import { toField, toU8, parseStruct } from '../utils/formatting.js'

export const TOKEN_REGISTRY_PROGRAM_ID = 'token_registry.aleo'

export interface TokenMetadata {
  token_id: string
  name: bigint
  symbol: bigint
  decimals: number
  supply: bigint
  max_supply: bigint
  admin: string
  external_authorization_required: boolean
  external_authorization_party: string
}

export class TokenRegistryClient {
  private publicClient: PublicClient
  readonly programId: string

  constructor(publicClient: PublicClient, programId = TOKEN_REGISTRY_PROGRAM_ID) {
    this.publicClient = publicClient
    this.programId = programId
  }

  async getTokenMetadata(tokenId: string): Promise<TokenMetadata | null> {
    try {
      const raw = await this.publicClient.readContract({
        programId: this.programId,
        mapping: 'registered_tokens',
        key: toField(tokenId),
      })
      return raw ? this.parseMetadata(raw) : null
    } catch {
      return null
    }
  }

  async isTokenRegistered(tokenId: string): Promise<boolean> {
    return (await this.getTokenMetadata(tokenId)) !== null
  }

  encodeStringAsU128(str: string): bigint {
    const bytes = new TextEncoder().encode(str)
    let result = BigInt(0)
    for (let i = 0; i < Math.min(bytes.length, 16); i++) {
      result |= BigInt(bytes[i]) << BigInt(i * 8)
    }
    return result
  }

  private parseMetadata(raw: string): TokenMetadata {
    const p = parseStruct(raw)
    return {
      token_id:                       p.token_id?.replace(/field$/, '') ?? '',
      name:                           BigInt(p.name?.replace(/u128$/, '') ?? '0'),
      symbol:                         BigInt(p.symbol?.replace(/u128$/, '') ?? '0'),
      decimals:                       parseInt(p.decimals?.replace(/u8$/, '') ?? '0', 10),
      supply:                         BigInt(p.supply?.replace(/u128$/, '') ?? '0'),
      max_supply:                     BigInt(p.max_supply?.replace(/u128$/, '') ?? '0'),
      admin:                          p.admin ?? '',
      external_authorization_required: p.external_authorization_required === 'true',
      external_authorization_party:   p.external_authorization_party ?? '',
    }
  }
}

export const TOKEN_ROLES = {
  MINTER_ROLE:          1,
  BURNER_ROLE:          2,
  SUPPLY_MANAGER_ROLE:  3,
} as const

export function encodeIdentifierToField(name: string): string {
  const bytes = new TextEncoder().encode(name)
  let result = BigInt(0)
  for (let i = 0; i < bytes.length; i++) {
    result |= BigInt(bytes[i]) << (BigInt(i) * 8n)
  }
  return result.toString()
}
