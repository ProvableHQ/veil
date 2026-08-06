/**
 * Taking liquidity back out of a position, and collecting what it earned.
 *
 * The step that surprises people: `decreaseLiquidity` does not pay anything out.
 * It converts liquidity into an owed balance recorded against the position, and
 * `collect` is what turns that balance into records the account holds. Fees earn
 * into the same owed balance, so one collect sweeps both.
 *
 * That separation is why a decrease appears to do nothing to the wallet, and why
 * closing a position is three steps rather than one: decrease to zero, collect
 * what is owed, then burn the empty position.
 *
 * SPENDS REAL FUNDS. Needs an existing position.
 */
import { formatUnits } from '../../packages/shield-swap/src/index.js'
import { setupClient } from './setup-client.js'

export async function liquidity() {
  const { client } = await setupClient({ privateKey: process.env.VEIL_E2E_PRIVATE_KEY })

  // Positions are discovered from the records the account holds, so this needs
  // the scanner. There is no chain index of an account's positions.
  const positions = await client.getOwnedPositions()
  const position = positions[0]
  if (!position) throw new Error('no positions — run mint.ts first')

  const [token0, token1] = await Promise.all([
    client.tokenData(position.token0Id),
    client.tokenData(position.token1Id),
  ])

  // Take out half. Liquidity is not a token amount — it is the position's share
  // of the range — so what this converts to in each token depends on where the
  // price sits when it settles.
  const onchain = await client.getPosition({ positionTokenId: position.positionTokenId })
  if (!onchain || onchain.liquidity === 0n) throw new Error('position holds no liquidity')

  await client.decreaseLiquidity({
    poolKey: position.poolKey,
    // Naming the position matters whenever the account holds more than one in
    // the same pool: selecting by pool alone is ambiguous.
    positionTokenId: position.positionTokenId,
    liquidityToRemove: onchain.liquidity / 2n,
  })

  // Poll for the write to land before reading what is owed — the mapping lags
  // the transaction.
  let owed = onchain
  for (let attempt = 0; attempt < 10; attempt++) {
    const current = await client.getPosition({ positionTokenId: position.positionTokenId })
    if (current && current.liquidity < onchain.liquidity) {
      owed = current
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000))
  }
  console.log(`owed ${formatUnits(owed.tokens_owed0, token0.decimals)} ${token0.symbol}`)
  console.log(`     ${formatUnits(owed.tokens_owed1, token1.decimals)} ${token1.symbol}`)

  // Now sweep it into the wallet. The amounts requested are what the position
  // says it owes, read back from chain rather than assumed from the decrease.
  const imports = await client.resolveDexImports({
    tokenPrograms: [token0.ammTokenProgram!, token1.ammTokenProgram!],
  })
  const collected = await client.collect({
    poolKey: position.poolKey,
    positionTokenId: position.positionTokenId,
    amount0Requested: owed.tokens_owed0,
    amount1Requested: owed.tokens_owed1,
    imports,
  })
  console.log(`collected (tx ${collected.transactionId})`)

  // To close the position entirely, decrease all of the liquidity, collect, then
  // `client.burn({ positionTokenId, poolKey })`. One caveat there: the collect
  // spends the position record and issues a new one, and a burn built on the
  // spent record carries a serial number the chain has already consumed — the
  // node drops it silently at verification. Wait for the scanner to serve a
  // record whose tag differs from the old one before burning.
}
