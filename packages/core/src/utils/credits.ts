const MICROCREDITS_PER_CREDIT = 1_000_000n

export function creditsToMicrocredits(credits: bigint | number): bigint {
  if (typeof credits === 'number') {
    return BigInt(Math.round(credits * Number(MICROCREDITS_PER_CREDIT)))
  }
  return credits * MICROCREDITS_PER_CREDIT
}

export function microcreditsToCredits(microcredits: bigint): number {
  return Number(microcredits) / Number(MICROCREDITS_PER_CREDIT)
}
