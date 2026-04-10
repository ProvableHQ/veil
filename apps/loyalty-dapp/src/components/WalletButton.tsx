import { useState } from 'react'

interface Wallet {
  adapter: { name: string; icon?: string }
  readyState: string
}

interface WalletButtonProps {
  connected: boolean
  connecting: boolean
  address?: string
  onConnect: (walletName?: string) => void
  onDisconnect: () => void
  wallets?: Wallet[]
  onSelectWallet?: (name: string) => void
}

export function WalletButton({
  connected,
  connecting,
  address,
  onConnect,
  onDisconnect,
  wallets,
  onSelectWallet,
}: WalletButtonProps) {
  const [showPicker, setShowPicker] = useState(false)

  if (connecting) {
    return (
      <button className="wallet-btn connecting" disabled>
        Connecting...
      </button>
    )
  }

  if (connected && address) {
    return (
      <div className="wallet-connected">
        <span className="wallet-address">
          {address.slice(0, 8)}...{address.slice(-6)}
        </span>
        <button className="wallet-btn disconnect" onClick={onDisconnect}>
          Disconnect
        </button>
      </div>
    )
  }

  // Show wallet picker if wallets are available
  if (wallets && wallets.length > 0 && onSelectWallet) {
    return (
      <div className="wallet-picker-container">
        <button
          className="wallet-btn connect"
          onClick={() => setShowPicker(!showPicker)}
        >
          Connect Wallet
        </button>
        {showPicker && (
          <div className="wallet-picker">
            {wallets.map((w) => (
              <button
                key={w.adapter.name}
                className="wallet-option"
                onClick={() => {
                  setShowPicker(false)
                  onConnect(w.adapter.name)
                }}
              >
                <img
                  src={w.adapter.icon}
                  alt={w.adapter.name}
                  width={24}
                  height={24}
                />
                <span>{w.adapter.name}</span>
                {w.readyState !== 'Installed' && (
                  <span className="wallet-not-installed">Not installed</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <button className="wallet-btn connect" onClick={onConnect}>
      Connect Wallet
    </button>
  )
}
