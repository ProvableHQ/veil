import { useEffect, useState } from 'react'
import { useVeilWallet } from '@veil/react'
import { useLoyalty } from './hooks/useLoyalty'
import { WalletButton } from './components/WalletButton'
import { LoyaltyCard } from './components/LoyaltyCard'
import { Actions } from './components/Actions'
import { Stats } from './components/Stats'
import './app.css'

function CodeExample({ title, children }: { title: string; children: { before: string; after: string } }) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'after' | 'before' | 'both'>('both')

  return (
    <div className="code-example">
      <button className="code-example-toggle" onClick={() => setOpen(!open)}>
        <span className={`code-example-arrow ${open ? 'open' : ''}`}>&#9654;</span>
        <span>{title}</span>
      </button>
      {open && (
        <div className="code-compare">
          <div className="code-compare-tabs">
            <button className={`code-tab ${view === 'both' ? 'active' : ''}`} onClick={() => setView('both')}>compare</button>
            <button className={`code-tab ${view === 'after' ? 'active' : ''}`} onClick={() => setView('after')}>veil</button>
            <button className={`code-tab ${view === 'before' ? 'active' : ''}`} onClick={() => setView('before')}>without veil</button>
          </div>
          <div className={`code-compare-panels ${view}`}>
            {(view === 'before' || view === 'both') && (
              <div className="code-panel code-panel-before">
                {view === 'both' && <div className="code-panel-label">without veil</div>}
                <pre><code>{children.before}</code></pre>
              </div>
            )}
            {(view === 'after' || view === 'both') && (
              <div className="code-panel code-panel-after">
                {view === 'both' && <div className="code-panel-label">veil</div>}
                <pre><code>{children.after}</code></pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function App() {
  const {
    connected,
    address,
    publicClient,
    walletClient,
    connecting,
    connect,
    disconnect,
    wallets,
    selectWallet,
  } = useVeilWallet()
  const {
    cards,
    selectedCard,
    selectCard,
    stats,
    loading,
    txStatus,
    error,
    lastTxId,
    mintCard,
    addPoints,
    redeemVoucher,
    refreshStats,
  } = useLoyalty(walletClient, publicClient, address)

  // Load stats on mount
  useEffect(() => {
    refreshStats()
  }, [refreshStats])

  const veilDifference = (
    <div className="comparison">
      <h2>The veil difference</h2>
      <div className="comparison-grid">
        <div className="comparison-card old">
          <h4>create-leo-app (before)</h4>
          <ul>
            <li>Web workers + Comlink</li>
            <li>Direct @provablehq/sdk imports</li>
            <li>Manual proving in the browser</li>
            <li>Complex worker lifecycle</li>
          </ul>
        </div>
        <div className="comparison-card new">
          <h4>veil (after)</h4>
          <ul>
            <li>writeContract() for executions</li>
            <li>readContract() for mapping reads</li>
            <li>Wallet handles proving</li>
            <li>~60 lines of chain integration</li>
          </ul>
        </div>
      </div>

      <div className="code-examples">
        <CodeExample title="Setup (entire app)">
          {{
            before: `// create-leo-app — web workers, Comlink, manual wiring
// main.tsx
import { wrap } from 'comlink';
const worker = new Worker(
  new URL('./worker.ts', import.meta.url)
);
const api = wrap<WorkerAPI>(worker);

// worker.ts — runs in a separate thread
import { Account, ProgramManager, initThreadPool }
  from '@provablehq/sdk';
import { expose } from 'comlink';

await initThreadPool();
const pm = new ProgramManager();

async function execute(
  program: string, fn: string, inputs: string[],
  privateKey: string, fee: number
) {
  const account = Account.from_private_key(privateKey);
  pm.setAccount(account);
  const tx = await pm.buildExecutionTransaction({
    programName: program,
    functionName: fn,
    fee,
    privateFee: false,
    inputs,
  });
  return await pm.networkClient.submitTransaction(tx);
}

async function getMapping(program: string, mapping: string, key: string) {
  const res = await fetch(
    \`\${rpcUrl}/testnet/program/\${program}/mapping/\${mapping}/\${key}\`
  );
  return res.json();
}

expose({ execute, getMapping });`,
            after: `// veil — two lines in your React app
import { VeilProvider, useVeilWallet } from '@veil/react';

// Root
<VeilProvider network="testnet">
  <App />
</VeilProvider>

// Any component
const { publicClient, walletClient } = useVeilWallet();`
          }}
        </CodeExample>

        <CodeExample title="Execute a transaction">
          {{
            before: `// @provablehq/sdk — manual setup, proving, broadcasting
import { ProgramManager, Account } from '@provablehq/sdk';

const account = Account.from_private_key(privateKey);
const pm = new ProgramManager(rpcUrl, undefined, undefined);
pm.setAccount(account);

const tx = await pm.buildExecutionTransaction(
  'loyalty_token.aleo',
  'mint_card',
  0,        // fee
  false,    // privateFee
  [address, '0u64', nonce],
  undefined, undefined, undefined,
  undefined, undefined,
);
const result = await pm.networkClient
  .submitTransaction(tx);`,
            after: `// veil — one call, wallet handles the rest
const txId = await walletClient.writeContract({
  program: 'loyalty_token.aleo',
  function: 'mint_card',
  inputs: [address, '0u64', nonce],
});`
          }}
        </CodeExample>

        <CodeExample title="Read on-chain state">
          {{
            before: `// Raw REST — manual fetch, parse, no types
const response = await fetch(
  \`\${rpcUrl}/testnet/program/loyalty_token.aleo\`
  + \`/mapping/total_cards/0field\`
);
const raw = await response.json();
const totalCards = raw?.replace('u64', '');`,
            after: `// veil — typed mapping reads
const totalCards = await publicClient.readMapping({
  program: 'loyalty_token.aleo',
  mapping: 'total_cards',
  key: '0field',
});`
          }}
        </CodeExample>

        <CodeExample title="Use record inputs">
          {{
            before: `// @provablehq/sdk — manual record scanning + proving
const scanner = new RecordScanner(viewKey);
const records = await scanner.getOwnedRecords(
  'loyalty_token.aleo'
);
const card = records.find(
  r => !r.spent && r.recordName === 'LoyaltyCard'
);

const pm = new ProgramManager(rpcUrl);
pm.setAccount(account);
const tx = await pm.buildExecutionTransaction(
  'loyalty_token.aleo', 'add_points',
  0, false,
  [card.plaintext, '100u64'],
  undefined, undefined, undefined,
  undefined, undefined,
);
await pm.networkClient.submitTransaction(tx);`,
            after: `// veil — fetch records + execute in a few lines
const records = await walletClient.requestRecords({
  program: 'loyalty_token.aleo',
});
const card = records.find(
  r => !r.spent && r.recordName === 'LoyaltyCard'
);

const txId = await walletClient.writeContract({
  program: 'loyalty_token.aleo',
  function: 'add_points',
  inputs: [card.recordPlaintext, '100u64'],
});`
          }}
        </CodeExample>

        <CodeExample title="Track transaction status">
          {{
            before: `// Manual — poll REST endpoint, parse response
let confirmed = false;
while (!confirmed) {
  await new Promise(r => setTimeout(r, 5000));
  try {
    const res = await fetch(
      \`\${rpcUrl}/testnet/transaction/\${txId}\`
    );
    if (res.ok) confirmed = true;
  } catch {}
}
// Then manually re-fetch records + mappings...`,
            after: `// veil — wallet tracks it natively
const status = await walletClient.transactionStatus({
  transactionId: txId,
});
// { status: 'Accepted', transactionId: 'at1...' }`
          }}
        </CodeExample>
      </div>
    </div>
  )

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <h1 className="logo">Loyalty Points</h1>
          <span className="powered-by">powered by veil</span>
        </div>
        <WalletButton
          connected={connected}
          connecting={connecting}
          address={address ?? undefined}
          onConnect={connect}
          onDisconnect={disconnect}
          wallets={wallets}
          onSelectWallet={selectWallet}
        />
      </header>

      {/* Main content */}
      <main className="main">
        {/* Transaction status */}
        {txStatus !== 'idle' && (
          <div className={`tx-status tx-status-${txStatus}`}>
            <div className="tx-status-icon">
              {txStatus === 'pending' && <span className="spinner" />}
              {txStatus === 'accepted' && <span className="checkmark">&#10003;</span>}
              {txStatus === 'failed' && <span className="xmark">&#10007;</span>}
            </div>
            <div className="tx-status-text">
              {txStatus === 'pending' && 'Transaction pending — confirming on-chain...'}
              {txStatus === 'accepted' && 'Transaction confirmed!'}
              {txStatus === 'failed' && 'Transaction failed'}
            </div>
            {lastTxId && (
              <div className="tx-status-id">{lastTxId.trim().slice(0, 16)}...</div>
            )}
          </div>
        )}
        {error && txStatus !== 'failed' && (
          <div className="error-bar">
            {error}
          </div>
        )}

        {/* Card + Actions */}
        <div className="content-grid">
          <LoyaltyCard
            cards={cards}
            selectedCard={selectedCard}
            onSelectCard={selectCard}
            connected={connected}
          />
          <Actions
            connected={connected}
            hasCard={selectedCard !== null}
            loading={loading}
            onMint={mintCard}
            onAddPoints={addPoints}
            onRedeem={redeemVoucher}
          />
        </div>

        {/* Stats */}
        <Stats stats={stats} onRefresh={refreshStats} lastTxId={lastTxId} />

        {/* The veil difference — code examples moved here */}
        {veilDifference}
      </main>

      {/* Footer */}
      <footer className="footer">
        <a href="https://github.com/ProvableHQ/veil" target="_blank" rel="noopener">
          github.com/ProvableHQ/veil
        </a>
        <span className="sep">|</span>
        <span>Use viem-style calls to use any Aleo wallet or SDK.</span>
      </footer>
    </div>
  )
}
