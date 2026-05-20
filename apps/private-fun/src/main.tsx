import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { PrivateFunProviders } from './lib/providers.js'
import '@solana/wallet-adapter-react-ui/styles.css'
import './app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivateFunProviders>
      <App />
    </PrivateFunProviders>
  </StrictMode>,
)
