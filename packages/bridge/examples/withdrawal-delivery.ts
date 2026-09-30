import { decodeEventLog, parseAbi, type Address, type Hex, zeroAddress } from 'viem'

/** Identifies Circle's Ethereum mainnet Gateway Minter deployment. */
export const GATEWAY_MINTER = '0x2222222d7164433c4C09B0b0D809a9b52C04C205' as const

// Circle ABI: circlefin/evm-gateway-contracts/src/modules/minter/Mints.sol
const ABI = parseAbi([
  'event Withdrawn(address indexed localToken,uint256 value,bytes32 indexed remoteDepositor,address indexed localRecipient,uint32 remoteDomain,bytes32 remoteToken,bytes32 transferSpecHash)',
  'event AttestationUsed(address indexed token,address indexed recipient,bytes32 indexed transferSpecHash,uint32 sourceDomain,bytes32 sourceDepositor,bytes32 sourceSigner,uint256 value)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
])
type Log = { address: Address; data: Hex; topics: readonly Hex[] }
/**
 * Describes the expected withdrawal and net amount permitted by its quote.
 * @property reserve Ethereum xReserve contract for direct withdrawal receipts.
 * @property token Canonical Ethereum USDC contract.
 * @property recipient Intended Ethereum recipient; MUST remain idle during observation.
 * @property remoteDomain Aleo domain used by direct xReserve withdrawals.
 * @property remoteToken Aleo asset identifier used by direct xReserve withdrawals.
 * @property minimum Minimum acceptable net amount in six-decimal USDC atomic units.
 * @property maximum Burn amount in six-decimal USDCx atomic units.
 */
export type WithdrawalExpectation = { reserve: Address; token: Address; recipient: Address; remoteDomain: number; remoteToken: Hex; minimum: bigint; maximum: bigint }
/**
 * Verifies matching xReserve or Gateway events and USDC transfers in a successful destination receipt.
 * Does not establish a cryptographic link to an Aleo burn; callers must isolate the observation window.
 * @param logs Canonical receipt logs from the destination RPC.
 * @param expected Reviewed deployment, recipient, and amount bounds.
 * @returns Observed USDC amount, or undefined when this receipt does not match.
 * @example const received = withdrawalAmount(receipt.logs, expected)
 */
export function withdrawalAmount(logs: readonly Log[], expected: WithdrawalExpectation): bigint | undefined {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  const withdrawals: { value: bigint; from: Address }[] = []
  const transfers: { value: bigint; from: Address }[] = []
  for (const log of logs) {
    try {
      const event = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics as [Hex, ...Hex[]] })
      if (event.eventName === 'Withdrawn' && same(log.address, expected.reserve)
        && same(event.args.localToken, expected.token) && same(event.args.localRecipient, expected.recipient)
        && event.args.remoteDomain === expected.remoteDomain && same(event.args.remoteToken, expected.remoteToken)
        && event.args.value >= expected.minimum && event.args.value <= expected.maximum) withdrawals.push({ value: event.args.value, from: expected.reserve })
      if (event.eventName === 'AttestationUsed' && same(log.address, GATEWAY_MINTER)
        && same(event.args.token, expected.token) && same(event.args.recipient, expected.recipient)
        && event.args.value >= expected.minimum && event.args.value <= expected.maximum) {
        withdrawals.push({ value: event.args.value, from: zeroAddress })
      }
      if (event.eventName === 'Transfer' && same(log.address, expected.token)
        && same(event.args.to, expected.recipient)) transfers.push({ value: event.args.value, from: event.args.from })
    } catch { /* Ignore unrelated contract events. */ }
  }
  if (withdrawals.length !== 1 || transfers.filter(transfer => transfer.value === withdrawals[0]!.value && same(transfer.from, withdrawals[0]!.from)).length !== 1) return undefined
  return withdrawals[0]!.value
}

/** Defines the destination events used by the withdrawal observer. */
export { ABI as WITHDRAWAL_EVENTS }
