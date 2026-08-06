/**
 * Opening a liquidity position.
 *
 * Providing liquidity here means choosing a price range and depositing both
 * tokens into it. While the market price sits inside that range the position
 * earns a share of the fees from trades passing through; once the price leaves,
 * it earns nothing until the price comes back.
 *
 * A range is expressed in ticks, which are a log-scale price index: price is
 * 1.0001 raised to the tick, adjusted for the two tokens' decimals. Ranges also
 * have to align to the pool's own tick spacing, so the bounds a caller asks for
 * are not necessarily the bounds they get.
 *
 * `previewMint` answers all of that before anything is spent, which is why it
 * comes first. The two amounts are a budget, not a promise: a position takes
 * only what the range needs at the current price, and returns the rest.
 *
 * SPENDS REAL FUNDS. Needs a funded account holding BOTH pool tokens.
 */
import { formatUnits } from '../../packages/shield-swap/src/index.js'
import { setupClient } from './setup-client.js'

export async function mint() {
  const { client, account } = await setupClient({ privateKey: process.env.VEIL_E2E_PRIVATE_KEY })

  const { data: pools } = await client.api.getPools({ limit: 20 })
  const pool = pools.find((candidate) => candidate.token0_info && candidate.token1_info)
  if (!pool) throw new Error('no pool with token metadata')

  const [token0, token1] = await Promise.all([
    client.tokenData(pool.token0),
    client.tokenData(pool.token1),
  ])

  // Deposits are funded from private records, same as swaps.
  const held = await client.getBalances({ tokens: [token0.id, token1.id] })

  // Preview before committing. `rangePercent` asks for a range that wide either
  // side of the current price, and the preview reports where it actually lands
  // after alignment — along with how much of the budget the range consumes.
  const preview = await client.previewMint({
    poolKey: pool.key,
    amount0Desired: (held[token0.id]?.private ?? 0n) / 10n,
    amount1Desired: (held[token1.id]?.private ?? 0n) / 10n,
    rangePercent: 5,
  })

  // Liquidity of zero means the deposit backs nothing at this range — one side
  // is empty, or the amounts are dust spread over a range this wide. A mint
  // would still cost a fee and open nothing, so stop rather than submit.
  if (preview.liquidity === 0n) throw new Error('this budget backs no liquidity at this range')

  console.log(`range ticks ${preview.tickLower}…${preview.tickUpper}, current ${preview.tickCurrent}`)
  console.log(`consumes ${formatUnits(preview.amount0, token0.decimals)} ${token0.symbol}`)
  console.log(`         ${formatUnits(preview.amount1, token1.decimals)} ${token1.symbol}`)
  // A position opened out of range is funded from one side only and earns
  // nothing until the price moves into it. Sometimes deliberate, rarely intended.
  if (!preview.inRange) console.log('note: opens out of range, so it earns nothing yet')

  const imports = await client.resolveDexImports({
    tokenPrograms: [token0.ammTokenProgram!, token1.ammTokenProgram!],
  })

  const minted = await client.mint({
    poolKey: pool.key,
    tickLower: preview.tickLower,
    tickUpper: preview.tickUpper,
    // The amounts the preview said the range consumes, not the budget it was
    // given: those are what the lines above printed, and passing them caps the
    // mint at what was shown even if the price moves between this read and the
    // finalize. Passing the budget back would let it consume more than the
    // preview promised.
    amount0Desired: preview.amount0,
    amount1Desired: preview.amount1,
    recipient: account.address,
    // Fixed for the life of the position: every collect pays here, and it cannot
    // be changed afterwards. Usually the same as the owner.
    withdrawal: account.address,
    imports,
  })

  // The position is identified by an NFT the account now holds. That id is what
  // every later operation — increase, decrease, collect, burn — refers to.
  console.log(`minted ${minted.positionTokenId}`)

  // Mapping writes propagate to reads asynchronously, so a read taken straight
  // after the transaction confirms can still show the previous state. Poll
  // rather than assuming the position is immediately readable.
  for (let attempt = 0; attempt < 30; attempt++) {
    const position = await client.getPosition({ positionTokenId: minted.positionTokenId! })
    if (position && position.liquidity > 0n) {
      console.log(`confirmed: liquidity ${position.liquidity}`)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }
  console.log('not visible yet — the mapping is still catching up')
}
