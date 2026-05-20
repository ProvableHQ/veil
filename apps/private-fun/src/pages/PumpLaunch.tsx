import { useState } from 'react'
import { Layout } from '../components/Layout.js'
import { pumpLaunch, type PumpLaunchResult } from '../lib/recipes/pump-launch.js'
import { getBridgeClient } from '../lib/bridge-client.js'
import { useAleoSigner } from '../lib/wallets/useAleoSigner.js'
import { useSolanaSigner } from '../lib/wallets/useSolanaSigner.js'
import { pinMetadataToIpfs } from '../lib/pin-metadata.js'
import { launchWithCreator } from '../lib/launch-with-creator.js'
import type { BridgeOrderStatusDto } from '@veil/bridge'

type RuntimeStatus = 'idle' | 'running' | 'launched' | 'failed'

export function PumpLaunch() {
  const aleo = useAleoSigner()
  const solana = useSolanaSigner()

  const [name, setName] = useState('PRIVATE')
  const [symbol, setSymbol] = useState('PVT')
  const [imageUri, setImageUri] = useState('')
  const [totalSol, setTotalSol] = useState('0.5')
  const [initialBuySol, setInitialBuySol] = useState('0.05')

  const [runtime, setRuntime] = useState<RuntimeStatus>('idle')
  const [bridgeStage, setBridgeStage] = useState('')
  const [result, setResult] = useState<PumpLaunchResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canLaunch =
    !!aleo &&
    !!solana &&
    !!name.trim() &&
    !!symbol.trim() &&
    !!imageUri.trim() &&
    !!totalSol.trim() &&
    runtime !== 'running'

  async function onLaunch() {
    if (!aleo || !solana) return
    setRuntime('running')
    setError(null)
    setResult(null)
    setBridgeStage('')
    try {
      const r = await pumpLaunch({
        bridge: getBridgeClient(),
        aleoWallet: aleo.walletClient,
        creator: {
          publicKey: solana.publicKey.toBase58(),
          signTransaction: solana.signTransaction as never,
        },
        totalSol: totalSol.trim(),
        initialBuySol: initialBuySol.trim(),
        metadata: { name: name.trim(), symbol: symbol.trim(), imageUri: imageUri.trim() },
        pinMetadata: pinMetadataToIpfs,
        launchWithCreator,
        onStage: (s: BridgeOrderStatusDto) => setBridgeStage(s.status),
      })
      setResult(r)
      setRuntime('launched')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setRuntime('failed')
    }
  }

  const statusLabel =
    runtime === 'running' ? (bridgeStage || 'starting')
    : runtime === 'launched' ? 'launched'
    : runtime === 'failed' ? 'failed'
    : 'idle'

  return (
    <Layout
      breadcrumb={['Applets', 'Pump launch']}
      title="Anonymous pump.fun launch"
      subtitle="Launch a pump.fun coin from a fresh Solana account funded via bridged ALEO. For maximum unlinkability, use a brand-new account in your Solana wallet."
    >
      {!aleo && (
        <div className="pf-error" style={{ marginBottom: 16 }}>
          Connect an Aleo wallet to fund the launch.
        </div>
      )}
      {!solana && (
        <div className="pf-error" style={{ marginBottom: 16 }}>
          Connect a Solana wallet (use a fresh account for maximum unlinkability).
        </div>
      )}

      <div className="pf-form">
        <div className="pf-row">
          <label htmlFor="name">Name</label>
          <input id="name" className="pf-input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="pf-row">
          <label htmlFor="symbol">Symbol</label>
          <input id="symbol" className="pf-input" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
        </div>
        <div className="pf-row">
          <label htmlFor="image">Image URI</label>
          <input
            id="image"
            className="pf-input mono"
            placeholder="https://… or data:image/…"
            value={imageUri}
            onChange={(e) => setImageUri(e.target.value)}
          />
        </div>
        <div className="pf-row">
          <label htmlFor="total">Total SOL</label>
          <input
            id="total"
            className="pf-input mono"
            value={totalSol}
            onChange={(e) => setTotalSol(e.target.value)}
          />
        </div>
        <div className="pf-row">
          <label htmlFor="initial">Initial buy</label>
          <input
            id="initial"
            className="pf-input mono"
            value={initialBuySol}
            onChange={(e) => setInitialBuySol(e.target.value)}
          />
        </div>

        {solana && (
          <div className="pf-row">
            <label>Creator account</label>
            <div className="pf-input mono">{solana.publicKey.toBase58()}</div>
          </div>
        )}

        <button className="pf-btn" type="button" onClick={onLaunch} disabled={!canLaunch}>
          Launch {name || '?'}
        </button>
      </div>

      {(runtime !== 'idle' || error) && (
        <div className="pf-meta">
          <span>
            Status{' '}
            <span
              className={`pf-status${runtime === 'launched' ? ' done' : runtime === 'failed' ? ' failed' : ''}`}
            >
              <span className="pf-dot" />
              {statusLabel}
            </span>
          </span>
          {result?.tokenMint && (
            <span>
              Mint <strong>{result.tokenMint.slice(0, 10)}…</strong>
            </span>
          )}
          {result?.pumpfunUrl && (
            <span>
              <a href={result.pumpfunUrl} target="_blank" rel="noreferrer">View on pump.fun</a>
            </span>
          )}
          {result?.solanaTxSignature && (
            <span>
              <a
                href={`https://solscan.io/tx/${result.solanaTxSignature}`}
                target="_blank"
                rel="noreferrer"
              >
                Solana tx
              </a>
            </span>
          )}
        </div>
      )}

      {error && <div className="pf-error">{error}</div>}
    </Layout>
  )
}
