---
sidebar_position: 2
---

# VeilProvider

Wraps your app with wallet connection support and auto-configures all known Aleo wallets.

## Usage

```tsx
import { VeilProvider } from '@provablehq/veil-aleo-react-hooks'

<VeilProvider
  network="mainnet"
  programs={['my_program.aleo', 'credits.aleo']}
>
  <App />
</VeilProvider>
```

## Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `network` | `'mainnet' \| 'testnet'` | `'mainnet'` | Network to connect to |
| `autoConnect` | `boolean` | `true` | Auto-reconnect to previously used wallet |
| `decryptPermission` | `WalletDecryptPermission` | `UponRequest` | Decrypt permission level |
| `programs` | `string[]` | `undefined` | Programs to register with the wallet (required by Shield) |

## Programs

Some wallets (like Shield) require declaring which programs your dApp will interact with at connection time. Pass them via the `programs` prop:

```tsx
<VeilProvider
  network="testnet"
  programs={['loyalty_token.aleo', 'loyalty_rewards.aleo', 'credits.aleo']}
>
```

If you don't pass `programs`, transaction execution may fail with "program not in allowed programs."
