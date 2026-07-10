# getTokens

Fetches the tokens registered on the network.

Returns registry entries with market data where available, plus pagination
metadata. Use it to list tokens; use
[`getTokenDetails`](/api/public/getTokenDetails) for one token's entry and
price history. Queries the connected node, so it hits the network.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const { data, pagination } = await client.getTokens()
// data: [{ token_id: '...', symbol: 'CRED', display: 'Credits', program_name: 'credits.aleo', ... }, ...]
// pagination: { limit: 50, offset: 0, total_count: 214, has_next: true, has_previous: false }
```

## Returns

`TokenPage`

A page of token registry entries plus pagination metadata.

`pagination` carries `limit`, `offset`, `total_count`, `has_next`, and
`has_previous` — all `number` or `boolean`, describing the page the server
applied.

`data` is an array of registry entries. Each entry carries `token_id` (the
token ID literal within its program), `token_id_datatype` (its Aleo type,
such as `field` or `u128`), `symbol`, `display`, `program_name` (the hosting
program, such as `token_registry.aleo`), `decimals`, and `verified`. Monetary
and large numeric fields — `total_supply`, `price`,
`price_change_percentage_24h`, `fully_diluted_value`, `total_market_cap`, and
`volume_24h` — arrive as decimal strings to preserve precision for u128+
amounts, and the market-data fields are `null` when no data exists for the
token. `token_icon_url` and `compliance_freeze_list` are `null` when unset.
