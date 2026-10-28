import { expectTypeOf, test } from 'vitest'
import {
  bridgeActions,
  createBridgeClient,
  memoryXReservePrivateMintIdentityStore,
  quote,
  DEFAULT_BRIDGE_REGISTRY,
  type AleoMintMode,
  type BridgeClient,
  type QuoteParameters,
  type WalletPreparedXReserveDeposit,
} from '../../src/index.js'

declare const walletPreparedDeposit: WalletPreparedXReserveDeposit
const store = memoryXReservePrivateMintIdentityStore()
const intent = {
  source: { chain: 'sepolia', asset: 'usdc' },
  destination: { chain: 'aleo-testnet', asset: 'usdcx' },
  amount: '2',
  recipient: 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n',
} as const

test('a private mint quote names a nonce source unless the client carries a store', () => {
  const plain = createBridgeClient({ environment: 'testnet' })
  expectTypeOf(plain).toMatchTypeOf<BridgeClient<false>>()

  // Public and record mints never need a source.
  plain.quote({ ...intent })
  plain.quote({ ...intent, mintMode: 'record' })
  plain.quote({ ...intent, mintMode: 'public', circle: {} })

  // A private mint on a store-less client must name one on the call.
  // @ts-expect-error no nonce source
  plain.quote({ ...intent, mintMode: 'private' })
  // @ts-expect-error an empty circle is not a source
  plain.quote({ ...intent, mintMode: 'private', circle: {} })
  // @ts-expect-error a nonce input alone is not a source
  plain.quote({ ...intent, mintMode: 'private', circle: { privateMintNonceInput: '7scalar' } })
  plain.quote({ ...intent, mintMode: 'private', circle: { privateMintIdentities: store } })
  plain.quote({ ...intent, mintMode: 'private', circle: { privateMintSecretNonce: '7scalar' } })
  plain.quote({ ...intent, mintMode: 'private', circle: { walletPreparedDeposit } })
  plain.quote({ ...intent, mintMode: 'private', circle: { privateMintAddressCommitment: '33'.repeat(32) } })
  // The deprecated flat field still counts as a source.
  plain.quote({ ...intent, mintMode: 'private', privateMintSecretNonce: '7scalar' })

  // A mode decided at runtime compiles with a source and fails without one.
  const mode = 'record' as AleoMintMode
  plain.quote({ ...intent, mintMode: mode, circle: { privateMintSecretNonce: '7scalar' } })
  // @ts-expect-error the mode may be private and no source is named
  plain.quote({ ...intent, mintMode: mode })

  // A client built with a store satisfies the requirement for every private quote.
  const stored = createBridgeClient({ environment: 'testnet', circle: { privateMintIdentities: store } })
  expectTypeOf(stored).toMatchTypeOf<BridgeClient<true>>()
  stored.quote({ ...intent, mintMode: 'private' })
  stored.quote({ ...intent, mintMode: 'private', circle: { walletPreparedDeposit } })

  // An explicitly undefined store does not count.
  const unset = createBridgeClient({ environment: 'testnet', circle: { privateMintIdentities: undefined } })
  // @ts-expect-error no nonce source
  unset.quote({ ...intent, mintMode: 'private' })

  // bridgeActions follows the same rule as the client.
  const actions = bridgeActions({ registry: DEFAULT_BRIDGE_REGISTRY, clients: {}, fetch: globalThis.fetch, circle: { privateMintIdentities: store } })
  actions.quote({ ...intent, mintMode: 'private' })
  const bare = bridgeActions({ registry: DEFAULT_BRIDGE_REGISTRY, clients: {}, fetch: globalThis.fetch })
  // @ts-expect-error no nonce source
  bare.quote({ ...intent, mintMode: 'private' })

  // The standalone action has no client, so the call always carries the source.
  quote(DEFAULT_BRIDGE_REGISTRY, {}, { ...intent, mintMode: 'private', circle: { privateMintSecretNonce: '7scalar' } })
  // @ts-expect-error no nonce source
  quote(DEFAULT_BRIDGE_REGISTRY, {}, { ...intent, mintMode: 'private' })

  // The parameter type itself is usable by consumers who wrap the client.
  const params: QuoteParameters<true> = { ...intent, mintMode: 'private' }
  stored.quote(params)
})
