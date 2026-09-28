/**
 * Names a reviewed mainnet journey exposed by the CLI.
 * @property name CLI alias accepted by transfer.
 * @property routeId Canonical identifier in the SDK registry.
 * @property from Display name of the source chain.
 * @property to Display name of the destination chain.
 * @property asset Display name of the transferred assets.
 * @property protocol Protocol responsible for settlement.
 */
export type CliRoute = {
  name: string
  routeId: string
  from: string
  to: string
  asset: string
  protocol: 'xReserve' | 'Hyperlane'
}

/** Lists the reviewed mainnet journeys supported by the CLI. */
export const CLI_ROUTES: readonly CliRoute[] = [
  { name: 'arc-to-aleo', routeId: 'xreserve:arc/usdc->aleo/usdcx', from: 'Arc', to: 'Aleo', asset: 'USDC → USDCx', protocol: 'xReserve' },
  { name: 'usdc-to-usdcx', routeId: 'xreserve:ethereum/usdc->aleo/usdcx', from: 'Ethereum', to: 'Aleo', asset: 'USDC → USDCx', protocol: 'xReserve' },
  { name: 'usdcx-to-usdc', routeId: 'xreserve:aleo/usdcx->ethereum/usdc', from: 'Aleo', to: 'Ethereum', asset: 'USDCx → USDC', protocol: 'xReserve' },
  { name: 'eth-to-aleo', routeId: 'hyperlane:ethereum/eth->aleo/eth', from: 'Ethereum', to: 'Aleo', asset: 'ETH', protocol: 'Hyperlane' },
  { name: 'wbtc-to-aleo', routeId: 'hyperlane:ethereum/wbtc->aleo/wbtc', from: 'Ethereum', to: 'Aleo', asset: 'WBTC', protocol: 'Hyperlane' },
  { name: 'eth-to-ethereum', routeId: 'hyperlane:aleo/eth->ethereum/eth', from: 'Aleo', to: 'Ethereum', asset: 'ETH', protocol: 'Hyperlane' },
  { name: 'wbtc-to-ethereum', routeId: 'hyperlane:aleo/wbtc->ethereum/wbtc', from: 'Aleo', to: 'Ethereum', asset: 'WBTC', protocol: 'Hyperlane' },
  { name: 'sol-to-aleo', routeId: 'hyperlane:solana/sol->aleo/sol', from: 'Solana', to: 'Aleo', asset: 'SOL', protocol: 'Hyperlane' },
  { name: 'sol-to-solana', routeId: 'hyperlane:aleo/sol->solana/sol', from: 'Aleo', to: 'Solana', asset: 'SOL', protocol: 'Hyperlane' },
]
