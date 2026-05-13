import type { WalletClient } from '@veil/core'
import type { TestClient } from '@veil/core'
import { toField, toU128, toU8, toU32, toBool, toAddress } from '../../src/utils/formatting.js'

export const TOKEN_REGISTRY_ID = 'token_registry.aleo'
export const MAX_SUPPLY = BigInt('1000000000000000')  // 1B with 6 decimals

// Compute field encoding of an identifier string (snarkVM Identifier::to_field).
export function identifierToField(name: string): string {
  const bytes = new TextEncoder().encode(name)
  let result = BigInt(0)
  for (let i = 0; i < bytes.length; i++) {
    result |= BigInt(bytes[i]) << (BigInt(i) * 8n)
  }
  return result.toString()
}

export interface TokenDef {
  // The field the AMM uses to identify this token (identifier encoding of the wrapper program name).
  ammTokenId: string
  programId: string
  symbol: string
  name: string
  decimals: number
  // token_registry token_id (null for credits-backed tokens).
  registryTokenId: string | null
  underlying: 'token_registry' | 'credits'
}

// The 3 tokens used for devnode testing.
export const TOKENS: Record<string, TokenDef> = {
  TOKA: {
    ammTokenId:       identifierToField('test_token_a'),
    programId:        'test_token_a.aleo',
    symbol:           'TOKA',
    name:             'Test Token A',
    decimals:         6,
    registryTokenId:  '1',
    underlying:       'token_registry',
  },
  TOKB: {
    ammTokenId:       identifierToField('test_token_b'),
    programId:        'test_token_b.aleo',
    symbol:           'TOKB',
    name:             'Test Token B',
    decimals:         6,
    registryTokenId:  '2',
    underlying:       'token_registry',
  },
  WCRED: {
    ammTokenId:       identifierToField('wrapped_native_credits'),
    programId:        'wrapped_native_credits.aleo',
    symbol:           'WCRED',
    name:             'Wrapped Native Credits',
    decimals:         6,
    registryTokenId:  null,
    underlying:       'credits',
  },
}

function encodeString(str: string): bigint {
  const bytes = new TextEncoder().encode(str)
  let result = BigInt(0)
  for (let i = 0; i < Math.min(bytes.length, 16); i++) {
    result |= BigInt(bytes[i]) << BigInt(i * 8)
  }
  return result
}

// ── Per-token setup steps ────────────────────────────────────────────────────

export async function registerToken(
  symbol: string,
  adminWallet: WalletClient,
  testClient: TestClient,
): Promise<void> {
  const token = TOKENS[symbol]
  if (!token?.registryTokenId) return

  await adminWallet.writeContract({
    program: TOKEN_REGISTRY_ID,
    function: 'register_token',
    inputs: [
      toField(token.registryTokenId),
      toU128(encodeString(token.name)),
      toU128(encodeString(token.symbol)),
      toU8(token.decimals),
      toU128(MAX_SUPPLY),
      toBool(false),
      // self — any address works as the external auth party when disabled
      (adminWallet as unknown as { account: { address: string } }).account.address,
    ],
  })
  await testClient.advanceBlock()
}

export async function mintTokensToAccount(
  symbol: string,
  recipient: string,
  amount: bigint,
  adminWallet: WalletClient,
  testClient: TestClient,
): Promise<void> {
  const token = TOKENS[symbol]
  if (!token?.registryTokenId) return

  await adminWallet.writeContract({
    program: TOKEN_REGISTRY_ID,
    function: 'mint_public',
    inputs: [toField(token.registryTokenId), toAddress(recipient), toU128(amount), toU32(4294967295)],
  })
  await testClient.advanceBlock()
}

export async function depositIntoWrapper(
  symbol: string,
  amount: bigint,
  userWallet: WalletClient,
  testClient: TestClient,
): Promise<void> {
  const token = TOKENS[symbol]
  const fn = token.underlying === 'credits' ? 'deposit_public_as_signer' : 'deposit_public'
  const inputs = token.underlying === 'credits'
    ? [toU128(amount)]
    : [toField(token.registryTokenId!), toU128(amount)]

  await userWallet.writeContract({ program: token.programId, function: fn, inputs })
  await testClient.advanceBlock()
}

export async function approveAmmToSpend(
  symbol: string,
  ammAddress: string,
  amount: bigint,
  userWallet: WalletClient,
  testClient: TestClient,
): Promise<void> {
  const token = TOKENS[symbol]
  await userWallet.writeContract({
    program: token.programId,
    function: 'approve_public',
    inputs: [toAddress(ammAddress), toU128(amount)],
  })
  await testClient.advanceBlock()
}

export async function setupToken(
  symbol: string,
  adminWallet: WalletClient,
  userWallets: WalletClient[],
  ammAddress: string,
  mintAmount: bigint,
  testClient: TestClient,
): Promise<void> {
  await registerToken(symbol, adminWallet, testClient)

  for (const wallet of userWallets) {
    const addr = (wallet as unknown as { account: { address: string } }).account.address

    if (TOKENS[symbol].underlying === 'credits') {
      // Fund the user with credits before depositing into the wrapper.
      await adminWallet.writeContract({
        program: 'credits.aleo',
        function: 'transfer_public',
        inputs: [toAddress(addr), `${mintAmount + 100_000_000n}u64`],
      })
      await testClient.advanceBlock()
    } else {
      await mintTokensToAccount(symbol, addr, mintAmount, adminWallet, testClient)
    }

    await depositIntoWrapper(symbol, mintAmount, wallet, testClient)
    await approveAmmToSpend(symbol, ammAddress, mintAmount * 10n, wallet, testClient)
  }
}
