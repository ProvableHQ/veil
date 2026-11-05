import { encodeFunctionData, getAddress, isHash, type Address } from 'viem'
import { requireAleoClientWithWallet, requireEvmClientWithWallet, type BridgeChainClients } from '../../connections/resolve.js'
import { createBridgeCheckpoint } from '../../actions/createBridgeCheckpoint.js'
import { BridgeError } from '../../errors/bridgeErrors.js'
import type { ExecuteParameters } from '../../types/actions.js'
import type { BridgeReceipt, BridgeRegistry } from '../../types/protocol.js'
import type { VerulinkExecution } from '../../types/verulink.js'
import { parseDecimalAmount } from '../../utils/units.js'
import { ABI } from './abi.js'
import { addressLiteral, context, evmRead, integer, mapping } from './common.js'
import { assertActive, quote } from './quote.js'

/** Submits the public source transfer with fresh fee reads and durable submission callbacks. */
export async function execute(
  registry: BridgeRegistry,
  clients: BridgeChainClients,
  params: ExecuteParameters & { resume?: BridgeReceipt | undefined },
): Promise<VerulinkExecution> {
  // An approval hash cannot prove that a later burn was never broadcast. The
  // generic wallet interface exposes neither a signed payload nor its nonce.
  // Require the caller to reconcile that wallet submission instead of risking
  // a duplicate burn, including when it is still pending in the mempool.
  if (params.resume) throw new BridgeError('Verulink approval-only recovery cannot safely resubmit; recover with the source transaction hash from the wallet')
  const { plan } = params
  const c = context(registry, clients, plan)
  if (params.mode !== undefined && params.mode !== 'public' && params.mode !== 'public-as-signer' && params.mode !== 'signer') throw new BridgeError('Verulink only supports public source balances')
  await assertActive(c)
  let priced = await quote(registry, clients, plan)
  const checkOutput = () => {
    if (plan.amountOut !== undefined && parseDecimalAmount(priced.amountOut, 6) < parseDecimalAmount(plan.amountOut, 6)) throw new BridgeError('Verulink fee increased since quoting; quote again before submission')
  }
  checkOutput()
  const save = async (receipt: BridgeReceipt) => params.onCheckpoint?.(createBridgeCheckpoint(plan, receipt))
  if (c.outbound) {
    const wallet = requireAleoClientWithWallet(registry, clients, c.aleoChain.id, 'send public ALEO through Verulink').walletClient
    const sender = wallet.account?.address
    if (!sender || (plan.sender && plan.sender !== sender)) throw new BridgeError('Verulink source sender must match the Aleo wallet account')
    const balance = integer(await mapping(c.aleo.publicClient, 'credits.aleo', 'account', sender), 'public balance')
    if (balance < priced.amountAtomic) throw new BridgeError('Insufficient public ALEO balance for Verulink')
    const state = { routeId: c.route.id, sourceSender: sender }
    const transactionId = await wallet.executeTransaction({
      program: c.aleoTokenService, function: 'token_send_public', privateFee: params.privateFee ?? false,
      inputs: [addressLiteral(plan.recipient), `${priced.amountAtomic}u64`, `${c.evmDomain}u128`,
        addressLiteral(c.evmTokenService), addressLiteral(c.evmToken), `${priced.feeAtomic}u64`],
      onProgress: async event => {
        // Persistence precedes broadcast; recovery reuses these immutable bytes.
        if (event.type === 'transaction-prepared') await save({ id: event.transaction.id, protocol: 'verulink',
          status: 'SOURCE_SUBMISSION_PENDING', protocolState: { ...state, preparedTransaction: JSON.stringify(event.transaction) } })
        await params.onProgress?.(event)
      },
    })
    if (!transactionId) throw new BridgeError('Aleo wallet returned an empty Verulink transaction id')
    const receipt: BridgeReceipt = { id: transactionId, protocol: 'verulink', status: 'SOURCE_CONFIRMING', sourceTxId: transactionId, protocolState: state }
    await save(receipt)
    return { kind: 'aleo-verulink', transactionId, receipt }
  }
  const evm = requireEvmClientWithWallet(registry, clients, c.evmChain.id, 'send wrapped ALEO through Verulink')
  const sender = getAddress(await evm.walletClient.getAddress())
  if (plan.sender && getAddress(plan.sender) !== sender) throw new BridgeError('Verulink source sender does not match the EVM wallet')
  const approvals: string[] = []
  const state = () => ({ routeId: c.route.id, sourceSender: sender, approvalTxIds: [...approvals] })
  const [balance, nativeBalance] = await Promise.all([
    evmRead(evm.publicClient, c.evmToken, 'balanceOf', [sender]), evm.publicClient.getBalance(sender),
  ])
  if (integer(balance, 'wrapped balance', (1n << 256n) - 1n) < priced.amountAtomic) throw new BridgeError('Insufficient wrapped ALEO balance')
  if (nativeBalance <= 0n) throw new BridgeError('BNB is required to pay Verulink source gas')
  const amount = priced.amountAtomic
  let allowance = integer(await evmRead(evm.publicClient, c.evmToken, 'allowance', [sender, c.evmTokenService]), 'allowance', (1n << 256n) - 1n)
  if (allowance < amount) {
    const data = encodeFunctionData({ abi: ABI, functionName: 'approve', args: [c.evmTokenService, amount] })
    await evm.publicClient.call({ to: c.evmToken, data, account: sender })
    const transactionId = await evm.walletClient.sendTransaction({ chainId: c.evmChainId, from: sender, to: c.evmToken, data })
    approvals.push(transactionId)
    const pending: BridgeReceipt = { id: transactionId, protocol: 'verulink', status: 'SOURCE_APPROVAL_PENDING', protocolState: state() }
    await save(pending)
    const deadline = Date.now() + (params.confirmationTimeoutMs ?? 120000)
    for (;;) {
      const result = await evm.publicClient.getTransactionReceipt(transactionId)
      if (result) {
        if (result.status === 'reverted') throw new BridgeError(`Verulink token approval reverted: ${transactionId}`)
        break
      }
      // Timeout returns saved uncertainty and never starts a second submission.
      if (Date.now() >= deadline) return { kind: 'evm-verulink', transactionId, receipt: pending }
      await new Promise(resolve => setTimeout(resolve, Math.min(params.pollingIntervalMs ?? 1000, Math.max(1, deadline - Date.now()))))
    }
    allowance = integer(await evmRead(evm.publicClient, c.evmToken, 'allowance', [sender, c.evmTokenService]), 'allowance', (1n << 256n) - 1n)
    if (allowance < amount) throw new BridgeError('Confirmed Verulink approval did not grant the required allowance')
  }
  // Approval may take minutes. Re-read all protocol conditions immediately before burning.
  await assertActive(c)
  priced = await quote(registry, clients, plan)
  checkOutput()
  const data = encodeFunctionData({ abi: ABI, functionName: 'publicTokenSend', args: [c.evmToken, amount, plan.recipient] })
  await evm.publicClient.call({ to: c.evmTokenService, data, account: sender })
  const transactionId = await evm.walletClient.sendTransaction({ chainId: c.evmChainId, from: sender, to: c.evmTokenService, data })
  if (!isHash(transactionId)) throw new BridgeError('EVM wallet returned an invalid Verulink transaction hash')
  const receipt: BridgeReceipt = { id: transactionId, protocol: 'verulink', status: 'SOURCE_CONFIRMING', sourceTxId: transactionId, protocolState: state() }
  await save(receipt)
  return { kind: 'evm-verulink', transactionId, receipt }
}
