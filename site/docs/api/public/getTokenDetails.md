# getTokenDetails

Fetches a token's registry entry and price history.

Covers one token's metadata and market data; use
[`getTokens`](/api/public/getTokens) to list registered tokens. Queries the
connected node, so it hits the network.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const details = await client.getTokenDetails({
  programId: 'token_registry.aleo',
  tokenId: '1234...field',
})
// {
//   token: { token_id: '1234...field', symbol: 'CRED', display: 'Credits', ... },
//   price_history: {
//     pagination: { limit: 50, offset: 0, total_count: 30, has_next: false, has_previous: false },
//     data: [{ day: '2024-01-01T00:00:00Z', price_usd: '1.02', volume_24h: '48210.55', total_market_cap: '10200000.00' }, ...],
//   },
// }
```

## Returns

`GetTokenDetailsReturnType`

`token` is the registry entry (same shape as an entry of
[`getTokens`](/api/public/getTokens)'s `data`), or `null` when `tokenId` was
omitted or the token is not registered.

`price_history` carries one page of price points. `pagination` is `null`
when the query matched no price-history rows, otherwise it carries `limit`,
`offset`, `total_count`, `has_next`, and `has_previous`. `data` is an array
of price points, each with `day` (an ISO-8601 bucket timestamp) and
`price_usd`, `volume_24h`, `total_market_cap` as decimal strings, or `null`
when no data exists for that bucket.

## Parameters

### programId

- **Type:** `string`

Program ID hosting the token, such as `'token_registry.aleo'`.

### tokenId

- **Type:** `string`
- **Optional**

Token ID within the program. Required in practice: when omitted, the node
returns `token: null` and `price_history.pagination: null`.

### limit

- **Type:** `number`
- **Optional**
- **Default:** `50` (server-side)

Price-history page size, `0`–`50`.

### offset

- **Type:** `number`
- **Optional**
- **Default:** `0` (server-side)

Price-history row offset.

### granularity

- **Type:** `'hourly' | 'daily'`
- **Optional**
- **Default:** `'daily'` (server-side)

Price-history bucket size.
