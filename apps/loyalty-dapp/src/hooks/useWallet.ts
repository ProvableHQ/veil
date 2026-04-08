import { useState, useCallback, useRef } from 'react'
import { createAleoWalletClient } from '../lib/aleo'
import { createMockAdapter } from '../lib/mockAdapter'
import type { WalletClient } from '@veil/core'

export interface UseWalletReturn {
  connected: boolean
  address: string | undefined
  walletClient: WalletClient | undefined
  connecting: boolean
  connect: () => Promise<void>
  disconnect: () => Promise<void>
}

export function useWallet(): UseWalletReturn {
  const [connected, setConnected] = useState(false)
  const [address, setAddress] = useState<string>()
  const [walletClient, setWalletClient] = useState<WalletClient>()
  const [connecting, setConnecting] = useState(false)
  const adapterRef = useRef(createMockAdapter())

  const connect = useCallback(async () => {
    setConnecting(true)
    try {
      const adapter = adapterRef.current

      // In production, this would be:
      //   const adapter = new LeoWalletAdapter()
      //   await adapter.connect(Network.MAINNET, DecryptPermission.UponRequest)
      await adapter.connect()

      // Create veil wallet client from the adapter — one line
      const client = createAleoWalletClient(adapter)

      setWalletClient(client)
      setAddress(adapter.account?.address)
      setConnected(true)
    } finally {
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(async () => {
    await adapterRef.current.disconnect()
    setWalletClient(undefined)
    setAddress(undefined)
    setConnected(false)
  }, [])

  return { connected, address, walletClient, connecting, connect, disconnect }
}
