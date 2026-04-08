interface WalletButtonProps {
  connected: boolean
  connecting: boolean
  address?: string
  onConnect: () => void
  onDisconnect: () => void
}

export function WalletButton({ connected, connecting, address, onConnect, onDisconnect }: WalletButtonProps) {
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

  return (
    <button className="wallet-btn connect" onClick={onConnect}>
      Connect Wallet
    </button>
  )
}
