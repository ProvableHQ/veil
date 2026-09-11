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
     * Calculates the Hyperlane relayer payment for a transfer leaving Aleo.
     *
     * Reads the current gas oracle on Aleo without requesting a signature or
     * moving funds. The payment can change before the transfer is submitted.
     *
     * @param client Aleo network access used to read the current gas price and exchange rate.
     * @param params Route selected for the transfer and optional replacement bridge deployments.
     * @returns Destination gas requirements and the exact payment in Aleo microcredits.
     * @throws BridgeError When the route is unavailable or its gas configuration is invalid.
     * @example const result = await hyperlane.aleo.quote(client, { routeId })
     */
    quote(client: Client, params: QuoteAleoHyperlaneGasPaymentParameters & ProtocolHelperRegistry) {
      const [registry, actionParams] = splitRegistry<QuoteAleoHyperlaneGasPaymentParameters>(params)
      return aleoHyperlane.quote(registry, client, actionParams)
    },
    /**
     * Begins an Aleo-to-Ethereum or Aleo-to-Solana transfer through Hyperlane.
     *
     * The Aleo wallet proves, signs, and submits the source transaction, which
     * commits the asset and incurs an Aleo network fee.
     *
     * @param client Aleo wallet that authorizes and submits the source transaction.
     * @param params Route, assets, amount, recipient, gas payment, and optional replacement bridge deployments.
     * @returns The Aleo transaction identifier and state needed to follow delivery.
     * @throws BridgeError When the transfer is unavailable, its payment is invalid, or wallet submission fails.
     * @example const result = await hyperlane.aleo.execute(client, { plan, gasPaymentMicrocredits })
     */
    execute(client: AleoWalletClient, params: ExecuteAleoHyperlaneTransferRemoteParameters & ProtocolHelperRegistry) {
      const [registry, actionParams] = splitRegistry<ExecuteAleoHyperlaneTransferRemoteParameters>(params)
      return aleoHyperlane.execute(registry, client, actionParams)
    },
  },
  evm: {
    /**
     * Calculates the funds required for a Hyperlane transfer leaving an EVM chain.
     *
     * Reads the deployed router without requesting a wallet signature or moving
     * funds. The quoted network payment can change before submission.
     *
     * @param client EVM network access used to read the selected Hyperlane router.
     * @param params Route, assets, amount, encoded Aleo recipient, and optional replacement bridge deployments.
     * @returns Source token amount and native network payment required by the router.
     * @throws BridgeError When the route is unavailable or the router returns invalid values.
     * @example const result = await hyperlane.evm.quote(client, { plan, recipientBytes32 })
     */
    quote(client: EvmClient, params: QuoteEvmHyperlaneTransferParameters & ProtocolHelperRegistry) {
      const [registry, actionParams] = splitRegistry<QuoteEvmHyperlaneTransferParameters>(params)
      return evmHyperlane.quote(registry, client, actionParams)
    },
    /**
     * Begins an EVM-to-Aleo transfer through Hyperlane.
     *
     * An ERC-20 transfer may first request token approval. The wallet then
     * submits the source dispatch, which commits funds and incurs network fees.
     *
     * @param client EVM network and wallet access used to authorize and submit the transfer.
     * @param params Route, assets, amount, encoded Aleo recipient, confirmation controls, and optional replacement bridge deployments.
     * @returns Submitted approval identifiers and state needed to follow delivery.
     * @throws BridgeError When the transfer is unavailable, wallet authorization fails, funds are insufficient, or submission fails.
     * @example const result = await hyperlane.evm.execute(client, { plan, recipientBytes32 })
     */
    execute(client: EvmClient & { walletClient: EvmWalletClient }, params: ExecuteEvmHyperlaneTransferParameters & ProtocolHelperRegistry) {
      const [registry, actionParams] = splitRegistry<ExecuteEvmHyperlaneTransferParameters>(params)
      return evmHyperlane.execute(registry, client, actionParams)
    },
  },
  solana: {
    /**
     * Calculates the SOL required for a Solana-to-Aleo Hyperlane transfer.
     *
     * Reads current gas, transaction fee, and rent requirements without
     * requesting a wallet signature or moving funds.
     *
     * @param client Solana network access used to read account, fee, and rent values.
     * @param params Route, amount, recipient, and optional replacement bridge deployments.
     * @returns Transfer amount, relayer payment, network fee, rent, and total required lamports.
     * @throws BridgeError When the route is unavailable or Solana returns invalid account or fee data.
     * @example const result = await hyperlane.solana.quote(client, { plan })
     */
    quote(client: SolanaClient, params: QuoteSolanaHyperlaneTransferParameters & ProtocolHelperRegistry) {
      const [registry, actionParams] = splitRegistry<QuoteSolanaHyperlaneTransferParameters>(params)
      return solanaHyperlane.quote(registry, client, actionParams)
    },
    /**
     * Begins a Solana-to-Aleo transfer through Hyperlane.
     *
     * The Solana wallet signs and submits the source transaction, which commits
     * SOL and incurs the relayer payment, network fee, and account rent.
     *
     * @param client Solana network and wallet access used to authorize and submit the transfer.
     * @param params Route, amount, recipient, confirmation controls, and optional replacement bridge deployments.
     * @returns The Solana signature and state needed to follow delivery.
     * @throws BridgeError When the route is unavailable, funds are insufficient, wallet authorization fails, or submission fails.
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
     * Calculates the USDC and token approval required for an xReserve transfer to Aleo.
     *
     * Reads the connected Ethereum account's USDC balance and existing xReserve
     * allowance without requesting a signature or moving funds.
     *
     * @param client Ethereum network access and the account whose balance and allowance are checked.
     * @param params Route, amount, Aleo recipient, privacy preference, and optional replacement bridge deployments.
     * @returns Deposit amount, maximum provider fee, balance, allowance, and whether approval is required.
     * @throws BridgeError When the route is unavailable, the account lacks funds, or Ethereum returns invalid state.
     * @example const result = await xreserve.evmToAleo.quote(client, { plan })
     */
    quote(client: EvmClient & { walletClient: EvmWalletClient }, params: QuoteEvmXReserveTransferParameters & ProtocolHelperRegistry) {
      const [registry, actionParams] = splitRegistry<QuoteEvmXReserveTransferParameters>(params)
      return evmToAleoXReserve.quote(registry, client, actionParams)
    },
    /**
     * Begins a USDC-to-USDCx transfer from Ethereum to Aleo through xReserve.
     *
     * The wallet may first approve USDC spending, then submits the reserve
     * deposit that commits funds and incurs Ethereum network fees.
     *
     * @param client Ethereum network and wallet access used to authorize and submit the deposit.
     * @param params Route, amount, Aleo recipient, privacy preference, confirmation controls, and optional replacement bridge deployments.
     * @returns Submitted approval identifiers and state needed to obtain Circle's attestation and follow delivery.
     * @throws BridgeError When the route is unavailable, funds are insufficient, wallet authorization fails, or submission fails.
     * @example const result = await xreserve.evmToAleo.execute(client, { plan })
     */
    execute(client: EvmClient & { walletClient: EvmWalletClient }, params: ExecuteEvmXReserveTransferParameters & ProtocolHelperRegistry) {
      const [registry, actionParams] = splitRegistry<ExecuteEvmXReserveTransferParameters>(params)
      return evmToAleoXReserve.execute(registry, client, actionParams)
    },
    /**
     * Checks whether Circle has attested one confirmed xReserve deposit.
     *
     * Contacts Circle once and does not request a wallet signature, submit a
     * transaction, or move funds.
     *
     * @param client HTTP access used to contact Circle's attestation service.
     * @param params Deposit message hash, route, cancellation signal, and optional replacement bridge deployments.
     * @returns Whether the attestation is pending or the signed attestation is ready.
     * @throws BridgeError When Circle returns an invalid response.
     * @example const result = await xreserve.evmToAleo.getAttestation(fetch, { routeId, messageHash })
     */
    getAttestation(client: XReserveHttpTransport, params: GetXReserveAttestationParameters & ProtocolHelperRegistry) {
      const [registry, actionParams] = splitRegistry<GetXReserveAttestationParameters>(params)
      return evmToAleoXReserve.getAttestation(registry, client, actionParams)
    },
    /**
     * Delivers a private USDCx record after Circle attests an Ethereum deposit.
     *
     * The Aleo wallet proves, signs, and submits the private mint, which incurs
     * an Aleo network fee. The source deposit is not repeated.
     *
     * @param client Aleo wallet that authorizes and submits the private mint.
     * @param params Transfer details, attested deposit, private mint secret, recovery callback, and optional replacement bridge deployments.
     * @returns The Aleo transaction identifier and state needed to confirm private delivery.
     * @throws BridgeError When the attestation or private mint secret is invalid, wallet authorization fails, or submission fails.
     * @example const result = await xreserve.evmToAleo.complete(client, { plan, deposit, attestation })
     */
    complete(client: AleoWalletClient, params: ExecuteXReservePrivateMintParameters & ProtocolHelperRegistry) {
      const [registry, actionParams] = splitRegistry<ExecuteXReservePrivateMintParameters>(params)
      return evmToAleoXReserve.complete(registry, client, actionParams)
    },
  },
  aleoToEvm: {
    /**
     * Begins a USDCx-to-USDC transfer from Aleo to Ethereum through xReserve.
     *
     * The Aleo wallet proves, signs, and submits a burn that commits USDCx and
     * incurs an Aleo network fee. The provider completes Ethereum delivery
     * without another wallet authorization.
     *
     * @param client Aleo wallet that authorizes and submits the USDCx burn.
     * @param params Route, amount, Ethereum recipient, public or private funding preference, and optional replacement bridge deployments.
     * @returns The Aleo transaction identifier and state needed to follow provider-managed delivery.
     * @throws BridgeError When the route or private funding inputs are invalid, wallet authorization fails, or submission fails.
     * @example const result = await xreserve.aleoToEvm.execute(client, { plan, mode: 'public' })
     */
    execute(client: AleoWalletClient, params: ExecuteXReserveBurnParameters & ProtocolHelperRegistry) {
      const [registry, actionParams] = splitRegistry<ExecuteXReserveBurnParameters>(params)
      return aleoToEvmXReserve.execute(registry, client, actionParams)
    },
  },
} as const
