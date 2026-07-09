import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { VeilProvider } from '@provablehq/veil-aleo-react-hooks'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VeilProvider network="testnet" programs={['loyalty_rewards.aleo', 'loyalty_token.aleo', 'credits.aleo']}>
      <App />
    </VeilProvider>
  </StrictMode>,
)
