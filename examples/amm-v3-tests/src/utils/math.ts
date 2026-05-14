import { MIN_TICK, MAX_TICK } from '../types/index.js'

export const Q64 = BigInt('9223372036854775808')

const MAGIC: Record<number, bigint> = {
  1:      BigInt('9222910902837697536'),
  2:      BigInt('9222449791875588096'),
  3:      BigInt('9221988703967300608'),
  4:      BigInt('9221527639111677952'),
  8:      BigInt('9219683610192801792'),
  16:     BigInt('9215996658532725760'),
  32:     BigInt('9208627177859081216'),
  64:     BigInt('9193905890596798464'),
  128:    BigInt('9164533880601766912'),
  256:    BigInt('9106071067403056128'),
  512:    BigInt('8990261907820801024'),
  1024:   BigInt('8763043369415622656'),
  2048:   BigInt('8325689215117605888'),
  4096:   BigInt('7515375139346884608'),
  8192:   BigInt('6123667489441693696'),
  16384:  BigInt('4065682634442729984'),
  32768:  BigInt('1792161827361994496'),
  65536:  BigInt('348228825923923264'),
  131072: BigInt('13147394978735516'),
  262144: BigInt('18740867660568'),
  524288: BigInt('38079361'),
}

export function getSqrtPriceAtTick(tick: number): bigint {
  if (tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error(`Tick ${tick} out of bounds [${MIN_TICK}, ${MAX_TICK}]`)
  }
  if (tick === 0) return Q64

  const absTick = Math.abs(tick)
  const lowBits = absTick & 0x3
  let ratio = lowBits === 0 ? Q64 : MAGIC[lowBits]

  for (const bit of [4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288]) {
    if ((absTick & bit) !== 0) ratio = (ratio * MAGIC[bit]) >> BigInt(63)
  }

  return tick < 0 ? ratio : (Q64 * Q64) / ratio
}

export function roundTickToSpacing(tick: number, spacing: number): number {
  return Math.floor(tick / spacing) * spacing
}

export function getUsableTicks(tickLower: number, tickUpper: number, spacing: number) {
  return {
    tickLower: roundTickToSpacing(tickLower, spacing),
    tickUpper: roundTickToSpacing(tickUpper, spacing),
  }
}
