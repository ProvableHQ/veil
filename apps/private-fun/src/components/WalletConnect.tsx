import { useState } from 'react'
import { useVeilWallet } from '@veil/react'
import { useWallet as useSolanaWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { useAccount, useDisconnect } from 'wagmi'
import { EthereumConnectModal } from './EthereumConnectModal.js'

function truncate(addr: string, head = 4, tail = 4) {
  if (addr.length <= head + tail + 1) return addr
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`
}

export function WalletConnect() {
  const aleo = useVeilWallet()
  const solana = useSolanaWallet()
  const solanaModal = useWalletModal()
  const eth = useAccount()
  const { disconnect: disconnectEth } = useDisconnect()
  const [ethModalOpen, setEthModalOpen] = useState(false)

  return (
    <div className="pf-wallets">
      {aleo.address ? (
        <button
          className="pf-pill aleo"
          type="button"
          onClick={() => aleo.disconnect()}
          title="Aleo connected — click to disconnect"
        >
          <span className="pf-dot live" />
          Aleo <span className="pf-addr">{truncate(aleo.address, 6, 4)}</span>
        </button>
      ) : (
        <button className="pf-pill disconnected" type="button" onClick={() => aleo.connect()}>
          Aleo · Connect
        </button>
      )}

      {solana.publicKey ? (
        <button
          className="pf-pill sol"
          type="button"
          onClick={() => solana.disconnect()}
          title="Solana connected — click to disconnect"
        >
          <span className="pf-dot live" />
          Solana <span className="pf-addr">{truncate(solana.publicKey.toBase58(), 4, 4)}</span>
        </button>
      ) : (
        <button
          className="pf-pill disconnected"
          type="button"
          onClick={() => solanaModal.setVisible(true)}
        >
          Solana · Connect
        </button>
      )}

      {eth.isConnected && eth.address ? (
        <button
          className="pf-pill eth"
          type="button"
          onClick={() => disconnectEth()}
          title="Ethereum connected — click to disconnect"
        >
          <span className="pf-dot live" />
          Ethereum <span className="pf-addr">{truncate(eth.address, 6, 4)}</span>
        </button>
      ) : (
        <>
          <button className="pf-pill disconnected" type="button" onClick={() => setEthModalOpen(true)}>
            Ethereum · Connect
          </button>
          {ethModalOpen && <EthereumConnectModal onClose={() => setEthModalOpen(false)} />}
        </>
      )}
    </div>
  )
}
