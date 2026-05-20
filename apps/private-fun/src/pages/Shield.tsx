import { useEffect, useState } from 'react'
import { Layout } from '../components/Layout.js'
import { bridgeIn, type BridgeInResult } from '../lib/recipes/bridge-in.js'
import { getBridgeClient } from '../lib/bridge-client.js'
import { useAleoSigner } from '../lib/wallets/useAleoSigner.js'
import { useSolanaSigner } from '../lib/wallets/useSolanaSigner.js'
import { useEthereumSigner } from '../lib/wallets/useEthereumSigner.js'
import {
  CHAIN_CONFIGS,
  type AleoAssetSymbol,
  type ExternalAsset,
  type ExternalChain,
} from '../lib/chains.js'

const ALEO_ASSETS: AleoAssetSymbol[] = ['ALEO', 'WBTC', 'WETH', 'WUSDC', 'WSOL', 'USDCX', 'USAD']

type RuntimeStatus = 'idle' | 'fetching' | 'awaiting-deposit' | 'polling' | 'completed' | 'failed'

export function Shield() {
  const aleo = useAleoSigner()
  const solana = useSolanaSigner()
  const eth = useEthereumSigner()

  const [sourceChain, setSourceChain] = useState<ExternalChain>('solana')
  const [sourceAsset, setSourceAsset] = useState<ExternalAsset | 'ETH' | 'SOL'>('SOL')
  const [destAsset, setDestAsset] = useState<AleoAssetSymbol>('WSOL')
  const [amount, setAmount] = useState('0.5')

  const [runtime, setRuntime] = useState<RuntimeStatus>('idle')
  const [bridgeStage, setBridgeStage] = useState<string>('')
  const [result, setResult] = useState<BridgeInResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copyHint, setCopyHint] = useState<string | null>(null)

  // Keep sourceAsset in range for the chosen sourceChain
  const availableAssets = CHAIN_CONFIGS[sourceChain].assets
  useEffect(() => {
    const first = availableAssets[0]
    if (first !== undefined && !availableAssets.includes(sourceAsset as ExternalAsset)) {
      setSourceAsset(first)
    }
  }, [sourceChain, availableAssets, sourceAsset])

  const sourceAddress =
    sourceChain === 'solana'
      ? solana?.publicKey.toBase58()
      : (sourceChain === 'ethereum' || sourceChain === 'base' || sourceChain === 'arbitrum')
        ? eth?.address
        : undefined

  const canFetch =
    !!aleo && !!sourceAddress && !!amount.trim() && runtime !== 'fetching' && runtime !== 'polling'

  async function fetchOrder() {
    if (!aleo || !sourceAddress) return
    setRuntime('fetching')
    setError(null)
    setResult(null)
    setBridgeStage('')
    try {
      const r = await bridgeIn({
        bridge: getBridgeClient(),
        source: { chain: sourceChain, asset: sourceAsset, address: sourceAddress, amount: amount.trim() },
        destinationAsset: destAsset,
        recipientAleoAddress: aleo.address,
      })
      setResult(r)
      setRuntime('awaiting-deposit')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setRuntime('failed')
    }
  }

  async function pollUntilDone() {
    if (!result) return
    setRuntime('polling')
    try {
      const final = await result.waitForCompletion()
      setBridgeStage(final.status)
      setRuntime(final.status === 'COMPLETED' ? 'completed' : 'failed')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setRuntime('failed')
    }
  }

  async function copy(text: string, hint: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopyHint(hint)
      setTimeout(() => setCopyHint(null), 1200)
    } catch {
      // ignore — surface in UI if it ever matters
    }
  }

  const sourceChainConfig = CHAIN_CONFIGS[sourceChain]

  const statusLabel =
    runtime === 'fetching' ? 'fetching quote'
    : runtime === 'awaiting-deposit' ? 'awaiting your deposit'
    : runtime === 'polling' ? (bridgeStage || 'polling')
    : runtime === 'completed' ? 'completed'
    : runtime === 'failed' ? 'failed'
    : 'idle'

  return (
    <Layout
      breadcrumb={['Vault', 'Shield']}
      title="Shield"
      subtitle="Move SOL, ETH, USDC, USDT or WBTC from Solana / Ethereum / Base / Arbitrum into your private Aleo vault."
    >
      {!aleo && (
        <div className="pf-error" style={{ marginBottom: 16 }}>
          Connect an Aleo wallet to receive shielded assets.
        </div>
      )}

      <div className="pf-form">
        <div className="pf-row">
          <label htmlFor="src-chain">Source chain</label>
          <select
            id="src-chain"
            className="pf-select"
            value={sourceChain}
            onChange={(e) => setSourceChain(e.target.value as ExternalChain)}
          >
            {Object.values(CHAIN_CONFIGS).map((c) => (
              <option key={c.symbol} value={c.symbol}>{c.displayName}</option>
            ))}
          </select>
        </div>

        <div className="pf-row">
          <label htmlFor="src-asset">Source asset</label>
          <select
            id="src-asset"
            className="pf-select"
            value={sourceAsset}
            onChange={(e) => setSourceAsset(e.target.value as ExternalAsset)}
          >
            {availableAssets.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        <div className="pf-row">
          <label htmlFor="dst-asset">Destination on Aleo</label>
          <select
            id="dst-asset"
            className="pf-select"
            value={destAsset}
            onChange={(e) => setDestAsset(e.target.value as AleoAssetSymbol)}
          >
            {ALEO_ASSETS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
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

        <div className="pf-row">
          <label>Source wallet</label>
          <div className="pf-input mono" style={{ color: sourceAddress ? undefined : 'var(--muted)' }}>
            {sourceAddress ?? `not connected — connect a ${sourceChainConfig.displayName} wallet`}
          </div>
        </div>

        <div className="pf-row">
          <label>Aleo recipient</label>
          <div className="pf-input mono" style={{ color: aleo ? undefined : 'var(--muted)' }}>
            {aleo?.address ?? 'not connected'}
          </div>
        </div>

        <button
          className="pf-btn"
          type="button"
          onClick={fetchOrder}
          disabled={!canFetch}
        >
          Get bridge quote + order
        </button>
      </div>

      {result && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>Deposit instructions</h3>
          <div className="pf-form" style={{ maxWidth: 560 }}>
            <div className="pf-row">
              <label>Send</label>
              <div className="pf-input mono">
                {result.instructions.depositAmount} {result.quote.srcAsset} on {sourceChainConfig.displayName}
              </div>
            </div>
            <div className="pf-row">
              <label>To address</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <div className="pf-input mono" style={{ flex: 1 }}>{result.instructions.depositAddress}</div>
                <button
                  className="pf-btn secondary"
                  type="button"
                  onClick={() => copy(result.instructions.depositAddress ?? '', 'address copied')}
                  style={{ margin: 0 }}
                >
                  Copy
                </button>
              </div>
            </div>
            {result.instructions.depositMemo && (
              <div className="pf-row">
                <label>Memo</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div className="pf-input mono" style={{ flex: 1 }}>{result.instructions.depositMemo}</div>
                  <button
                    className="pf-btn secondary"
                    type="button"
                    onClick={() => copy(result.instructions.depositMemo ?? '', 'memo copied')}
                    style={{ margin: 0 }}
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
            <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>
              Sign and send the deposit with your {sourceChainConfig.displayName} wallet, then click below.
            </p>
            <button
              className="pf-btn"
              type="button"
              onClick={pollUntilDone}
              disabled={runtime === 'polling'}
            >
              I deposited — wait for completion
            </button>
            {copyHint && (
              <span style={{ color: 'var(--accent)', fontSize: 12 }}>{copyHint}</span>
            )}
          </div>
        </div>
      )}

      {(runtime !== 'idle' || error) && (
        <div className="pf-meta">
          <span>
            Status{' '}
            <span
              className={`pf-status${runtime === 'completed' ? ' done' : runtime === 'failed' ? ' failed' : ''}`}
            >
              <span className="pf-dot" />
              {statusLabel}
            </span>
          </span>
          {result?.instructions.orderId && (
            <span>Order <strong>{result.instructions.orderId}</strong></span>
          )}
        </div>
      )}

      {error && <div className="pf-error">{error}</div>}
    </Layout>
  )
}
