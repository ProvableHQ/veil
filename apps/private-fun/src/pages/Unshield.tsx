import { useEffect, useState } from 'react'
import { Layout } from '../components/Layout.js'
import { fundOut, type FundOutResult } from '../lib/recipes/fund-out.js'
import { getBridgeClient } from '../lib/bridge-client.js'
import { useAleoSigner } from '../lib/wallets/useAleoSigner.js'
import {
  CHAIN_CONFIGS,
  type AleoAssetSymbol,
  type ExternalAsset,
  type ExternalChain,
} from '../lib/chains.js'
import type { BridgeOrderStatusDto } from '@veil/bridge'

const ALEO_ASSETS: AleoAssetSymbol[] = ['ALEO', 'WBTC', 'WETH', 'WUSDC', 'WSOL', 'USDCX', 'USAD']
const COMPLIANCE_ASSETS = new Set<AleoAssetSymbol>(['USDCX', 'USAD'])

type RuntimeStatus = 'idle' | 'running' | 'completed' | 'failed'

export function Unshield() {
  const aleo = useAleoSigner()

  const [sourceAsset, setSourceAsset] = useState<AleoAssetSymbol>('ALEO')
  const [destChain, setDestChain] = useState<ExternalChain>('solana')
  const [destAsset, setDestAsset] = useState<ExternalAsset | 'ETH' | 'SOL'>('SOL')
  const [destAddress, setDestAddress] = useState('')
  const [amount, setAmount] = useState('0.5')
  const [merkleProof, setMerkleProof] = useState('')
  const [complianceOpen, setComplianceOpen] = useState(false)

  const [runtime, setRuntime] = useState<RuntimeStatus>('idle')
  const [bridgeStage, setBridgeStage] = useState<string>('')
  const [result, setResult] = useState<FundOutResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const requiresMerkleProof = COMPLIANCE_ASSETS.has(sourceAsset)

  // Keep destAsset in sync with destChain — pick the first supported asset for the chain.
  const availableAssets = CHAIN_CONFIGS[destChain].assets
  useEffect(() => {
    if (!availableAssets.includes(destAsset as ExternalAsset)) {
      const first = availableAssets[0]
      if (first !== undefined) setDestAsset(first)
    }
  }, [destChain, availableAssets, destAsset])

  const canSubmit =
    !!aleo &&
    !!destAddress.trim() &&
    !!amount.trim() &&
    (!requiresMerkleProof || !!merkleProof.trim()) &&
    runtime !== 'running'

  async function onSubmit() {
    if (!aleo) return
    setRuntime('running')
    setBridgeStage('')
    setError(null)
    setResult(null)
    try {
      const r = await fundOut({
        bridge: getBridgeClient(),
        aleoWallet: aleo.walletClient,
        sourceAsset,
        destination: { chain: destChain, asset: destAsset, address: destAddress.trim(), amount: amount.trim() },
        merkleProof: requiresMerkleProof ? merkleProof.trim() : undefined,
        poll: 'COMPLETED',
        onStage: (s: BridgeOrderStatusDto) => setBridgeStage(s.status),
      })
      setResult(r)
      setRuntime('completed')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setRuntime('failed')
    }
  }

  return (
    <Layout
      breadcrumb={['Vault', 'Unshield']}
      title="Unshield"
      subtitle="Move value out of your private Aleo vault to an external account on Solana, Ethereum, Base, or Arbitrum."
    >
      {!aleo && (
        <div className="pf-error" style={{ marginBottom: 16 }}>
          Connect an Aleo wallet to unshield to external accounts.
        </div>
      )}

      <div className="pf-form">
        <div className="pf-row">
          <label htmlFor="src-asset">Source asset</label>
          <select
            id="src-asset"
            className="pf-select"
            value={sourceAsset}
            onChange={(e) => setSourceAsset(e.target.value as AleoAssetSymbol)}
          >
            {ALEO_ASSETS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        <div className="pf-row">
          <label htmlFor="dest-chain">Destination chain</label>
          <select
            id="dest-chain"
            className="pf-select"
            value={destChain}
            onChange={(e) => setDestChain(e.target.value as ExternalChain)}
          >
            {Object.values(CHAIN_CONFIGS).map((c) => (
              <option key={c.symbol} value={c.symbol}>{c.displayName}</option>
            ))}
          </select>
        </div>

        <div className="pf-row">
          <label htmlFor="dest-asset">Destination asset</label>
          <select
            id="dest-asset"
            className="pf-select"
            value={destAsset}
            onChange={(e) => setDestAsset(e.target.value as ExternalAsset)}
          >
            {availableAssets.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        <div className="pf-row">
          <label htmlFor="dest-addr">To address</label>
          <input
            id="dest-addr"
            className="pf-input mono"
            placeholder="external wallet address"
            value={destAddress}
            onChange={(e) => setDestAddress(e.target.value)}
          />
        </div>

        <div className="pf-row">
          <label htmlFor="amount">Amount</label>
          <input
            id="amount"
            className="pf-input mono"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        {requiresMerkleProof && (
          <div className={`pf-expand${complianceOpen ? ' open' : ''}`}>
            <button
              type="button"
              className="pf-expand-head"
              onClick={() => setComplianceOpen((o) => !o)}
              aria-expanded={complianceOpen}
            >
              <span>Compliance proof — required for {sourceAsset}</span>
              <span className="chev">▾</span>
            </button>
            {complianceOpen && (
              <div className="pf-expand-body">
                <textarea
                  className="pf-textarea mono"
                  placeholder="[ {…}, {…} ]  — pre-formatted Aleo merkle proof input"
                  value={merkleProof}
                  onChange={(e) => setMerkleProof(e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        <button
          className="pf-btn"
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
        >
          Unshield {amount || '?'} {destAsset} to {CHAIN_CONFIGS[destChain].displayName} →
        </button>
      </div>

      {(runtime !== 'idle' || error) && (
        <div className="pf-meta">
          <span>
            Status{' '}
            <span className={`pf-status${runtime === 'completed' ? ' done' : runtime === 'failed' ? ' failed' : ''}`}>
              <span className="pf-dot" />
              {runtime === 'running' && (bridgeStage || 'starting')}
              {runtime === 'completed' && 'completed'}
              {runtime === 'failed' && 'failed'}
              {runtime === 'idle' && 'idle'}
            </span>
          </span>
          {result?.orderId && <span>Order <strong>{result.orderId}</strong></span>}
          {result?.depositTxId && (
            <span>
              Aleo tx{' '}
              <a
                href={`https://explorer.provable.com/transaction/${result.depositTxId}`}
                target="_blank"
                rel="noreferrer"
              >
                <strong>{result.depositTxId.slice(0, 10)}…</strong> ↗
              </a>
            </span>
          )}
        </div>
      )}

      {error && <div className="pf-error">{error}</div>}
    </Layout>
  )
}
