// SEALEVEL_NOTES.md §5: only the Mailbox dispatch log carries the complete id.
const DISPATCHED_MESSAGE_LOG_PATTERN = /Dispatched message to \d+, ID (0x[0-9a-fA-F]{64})/

/**
 * Extracts the Hyperlane message id from confirmed Solana program logs.
 *
 * Pure and local. Ignores abbreviated IGP and warp-completion identifiers.
 *
 * @param logs Program log lines, or `null` when the transaction was not found.
 * @returns The complete 32-byte message id, or `undefined` when absent.
 * @example const messageId = extractSolanaHyperlaneMessageId(logs)
 */
export function extractSolanaHyperlaneMessageId(logs: string[] | null): string | undefined {
  if (!logs) return undefined
  for (const line of logs) {
    const match = DISPATCHED_MESSAGE_LOG_PATTERN.exec(line)
    if (match) return match[1]
  }
  return undefined
}
