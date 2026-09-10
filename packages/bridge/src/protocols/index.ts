import type { Client } from '@provablehq/veil-core'
import type { EvmClient, EvmWalletClient } from '../connections/evm.js'
import type { SolanaClient, SolanaWalletClient } from '../connections/solana.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../registry/default.js'
import type {
  AleoWalletClient,
  ExecuteAleoHyperlaneTransferRemoteParameters,
  ExecuteXReserveBurnParameters,
  ExecuteXReservePrivateMintParameters,
  QuoteAleoHyperlaneGasPaymentParameters,
} from '../types/aleo.js'
import type { BridgeRegistry } from '../types/protocol.js'
import type {
  ExecuteEvmHyperlaneTransferParameters,
  QuoteEvmHyperlaneTransferParameters,
} from '../types/evm.js'
import type {
  ExecuteSolanaHyperlaneTransferParameters,
  QuoteSolanaHyperlaneTransferParameters,
} from '../types/solana.js'
import type {
  ExecuteEvmXReserveTransferParameters,
  GetXReserveAttestationParameters,
  QuoteEvmXReserveTransferParameters,
  XReserveHttpTransport,
} from '../types/xreserve.js'
import * as aleoHyperlane from './hyperlane/aleo.js'
import * as evmHyperlane from './hyperlane/evm.js'
import * as solanaHyperlane from './hyperlane/solana.js'
import * as aleoToEvmXReserve from './xreserve/aleoToEvm.js'
import * as evmToAleoXReserve from './xreserve/evmToAleo.js'

/**
 * Selects a custom registry for a direct protocol helper.
 *
 * @property registry Reviewed registry snapshot. Defaults to the package registry.
 */
export type ProtocolHelperRegistry = {
  registry?: BridgeRegistry | undefined
}

function splitRegistry<Params extends object>(
  params: Params & ProtocolHelperRegistry,
): [BridgeRegistry, Params] {
  const { registry = DEFAULT_BRIDGE_REGISTRY, ...rest } = params
  return [registry, rest as unknown as Params]
}

/**
 * Exposes chain-specific Hyperlane helpers for direct protocol integrations.
 *
 * Helpers use the default reviewed registry unless `params.registry` supplies
 * a custom snapshot. Most applications should use the protocol-neutral bridge
 * client actions instead.
 *
 * @example const result = await hyperlane.evm.quote(client, { plan, recipientBytes32 })
 */
export const hyperlane = {
  aleo: {
    /**
     * Quotes an Aleo-origin Hyperlane gas payment.
     * @param client Aleo public client used for mapping reads.
     * @param params Route selection and optional registry override.
     * @returns Live gas-oracle values and the exact hook payment.
     * @throws BridgeError When route metadata or on-chain configuration is invalid.
     * @example const result = await hyperlane.aleo.quote(client, { routeId })
     */
    quote(client: Client, params: QuoteAleoHyperlaneGasPaymentParameters & ProtocolHelperRegistry) {
      const [registry, actionParams] = splitRegistry<QuoteAleoHyperlaneGasPaymentParameters>(params)
      return aleoHyperlane.quote(registry, client, actionParams)
    },
    /**
     * Executes an Aleo-origin Hyperlane transfer.
     * @param client Aleo wallet client that proves, signs, and broadcasts.
     * @param params Prepared transfer and optional registry override.
     * @returns Submitted transaction and resumable receipt.
     * @throws BridgeError When route validation or submission fails.
     * @example const result = await hyperlane.aleo.execute(client, { plan, gasPaymentMicrocredits })
     */
    execute(client: AleoWalletClient, params: ExecuteAleoHyperlaneTransferRemoteParameters & ProtocolHelperRegistry) {
      const [registry, actionParams] = splitRegistry<ExecuteAleoHyperlaneTransferRemoteParameters>(params)
      return aleoHyperlane.execute(registry, client, actionParams)
    },
  },
  evm: {
    /**
     * Quotes an EVM-origin Hyperlane transfer.
     * @param client EVM public client used for router reads.
     * @param params Prepared transfer, encoded recipient, and optional registry override.
     * @returns Atomic transfer and fee requirements.
     * @throws BridgeError When route metadata or live router state is invalid.
     * @example const result = await hyperlane.evm.quote(client, { plan, recipientBytes32 })
     */
    quote(client: EvmClient, params: QuoteEvmHyperlaneTransferParameters & ProtocolHelperRegistry) {
      const [registry, actionParams] = splitRegistry<QuoteEvmHyperlaneTransferParameters>(params)
      return evmHyperlane.quote(registry, client, actionParams)
    },
    /**
     * Executes an EVM-origin Hyperlane transfer.
     * @param client EVM client with wallet authorization.
     * @param params Prepared transfer, polling controls, and optional registry override.
     * @returns Submitted transactions and resumable receipt.
     * @throws BridgeError When validation, submission, or confirmation fails.
     * @example const result = await hyperlane.evm.execute(client, { plan, recipientBytes32 })
     */
    execute(client: EvmClient & { walletClient: EvmWalletClient }, params: ExecuteEvmHyperlaneTransferParameters & ProtocolHelperRegistry) {
      const [registry, actionParams] = splitRegistry<ExecuteEvmHyperlaneTransferParameters>(params)
      return evmHyperlane.execute(registry, client, actionParams)
    },
  },
  solana: {
    /**
     * Quotes a Solana-origin Hyperlane transfer.
     * @param client Solana public client used for route and fee reads.
     * @param params Prepared transfer and optional registry override.
     * @returns Atomic transfer, gas, and network fee requirements.
     * @throws BridgeError When route metadata or live Solana state is invalid.
     * @example const result = await hyperlane.solana.quote(client, { plan })
     */
    quote(client: SolanaClient, params: QuoteSolanaHyperlaneTransferParameters & ProtocolHelperRegistry) {
      const [registry, actionParams] = splitRegistry<QuoteSolanaHyperlaneTransferParameters>(params)
      return solanaHyperlane.quote(registry, client, actionParams)
    },
    /**
     * Executes a Solana-origin Hyperlane transfer.
     * @param client Solana client with wallet authorization.
     * @param params Prepared transfer, polling controls, and optional registry override.
     * @returns Submitted signature and resumable receipt.
     * @throws BridgeError When validation, submission, or confirmation fails.
     * @example const result = await hyperlane.solana.execute(client, { plan })
     */
    execute(client: SolanaClient & { walletClient: SolanaWalletClient }, params: ExecuteSolanaHyperlaneTransferParameters & ProtocolHelperRegistry) {
      const [registry, actionParams] = splitRegistry<ExecuteSolanaHyperlaneTransferParameters>(params)
      return solanaHyperlane.execute(registry, client, actionParams)
    },
  },
} as const

/**
 * Exposes directional Circle xReserve helpers for direct protocol integrations.
 *
 * Helpers use the default reviewed registry unless `params.registry` supplies
 * a custom snapshot. Most applications should use the protocol-neutral bridge
 * client actions instead.
 *
 * @example const result = await xreserve.evmToAleo.quote(client, { plan })
 */
export const xreserve = {
  evmToAleo: {
    /**
     * Quotes an EVM-to-Aleo xReserve deposit.
     * @param client EVM client with a wallet address.
     * @param params Prepared transfer and optional registry override.
     * @returns Deposit, balance, allowance, and fee values.
     * @throws BridgeError When route or wallet state is invalid.
     * @example const result = await xreserve.evmToAleo.quote(client, { plan })
     */
    quote(client: EvmClient & { walletClient: EvmWalletClient }, params: QuoteEvmXReserveTransferParameters & ProtocolHelperRegistry) {
      const [registry, actionParams] = splitRegistry<QuoteEvmXReserveTransferParameters>(params)
      return evmToAleoXReserve.quote(registry, client, actionParams)
    },
    /**
     * Executes an EVM-to-Aleo xReserve deposit.
     * @param client EVM client with wallet authorization.
     * @param params Prepared transfer, polling controls, and optional registry override.
     * @returns Submitted transactions and resumable receipt.
     * @throws BridgeError When validation, submission, or confirmation fails.
     * @example const result = await xreserve.evmToAleo.execute(client, { plan })
     */
    execute(client: EvmClient & { walletClient: EvmWalletClient }, params: ExecuteEvmXReserveTransferParameters & ProtocolHelperRegistry) {
      const [registry, actionParams] = splitRegistry<ExecuteEvmXReserveTransferParameters>(params)
      return evmToAleoXReserve.execute(registry, client, actionParams)
    },
    /**
     * Reads one Circle xReserve attestation.
     * @param client Fetch-compatible HTTP capability.
     * @param params Message hash, route, cancellation, and optional registry override.
     * @returns Pending or completed attestation state.
     * @throws BridgeError When Circle returns an invalid response.
     * @example const result = await xreserve.evmToAleo.getAttestation(fetch, { routeId, messageHash })
     */
    getAttestation(client: XReserveHttpTransport, params: GetXReserveAttestationParameters & ProtocolHelperRegistry) {
      const [registry, actionParams] = splitRegistry<GetXReserveAttestationParameters>(params)
      return evmToAleoXReserve.getAttestation(registry, client, actionParams)
    },
    /**
     * Completes a private inbound xReserve mint.
     * @param client Aleo wallet client that proves, signs, and broadcasts.
     * @param params Attested deposit, plan, checkpoint hook, and optional registry override.
     * @returns Destination transaction and resumable receipt.
     * @throws BridgeError When the attestation or private-mint inputs are invalid.
     * @example const result = await xreserve.evmToAleo.complete(client, { plan, deposit, attestation })
     */
    complete(client: AleoWalletClient, params: ExecuteXReservePrivateMintParameters & ProtocolHelperRegistry) {
      const [registry, actionParams] = splitRegistry<ExecuteXReservePrivateMintParameters>(params)
      return evmToAleoXReserve.complete(registry, client, actionParams)
    },
  },
  aleoToEvm: {
    /**
     * Executes an Aleo-to-EVM xReserve burn.
     * @param client Aleo wallet client that proves, signs, and broadcasts.
     * @param params Prepared burn inputs and optional registry override.
     * @returns Source transaction and resumable receipt.
     * @throws BridgeError When burn construction or submission fails.
     * @example const result = await xreserve.aleoToEvm.execute(client, { plan, mode: 'public' })
     */
    execute(client: AleoWalletClient, params: ExecuteXReserveBurnParameters & ProtocolHelperRegistry) {
      const [registry, actionParams] = splitRegistry<ExecuteXReserveBurnParameters>(params)
      return aleoToEvmXReserve.execute(registry, client, actionParams)
    },
  },
} as const
