import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createKeyPairSignerFromBytes,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase58Encoder,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  getUtf8Encoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type KeyPairSigner,
  type TransactionMessageBytesBase64,
  type TransactionSigner,
} from '@solana/kit'
import {
  decodeHyperlaneTokenAccount,
  decodeIgpAccount,
  decodeOverheadIgpAccount,
  deriveHyperlaneTokenPda,
  deriveIgpGasPaymentPda,
  deriveIgpProgramDataPda,
  getComputeBudgetInstructions,
  getTokenTransferRemoteInstruction,
} from '@hyperlane-xyz/sealevel-sdk'
import {
  aleoAddressToBytes32,
  createBridgeClient,
} from '@provablehq/aleo-bridge-sdk'

const ROUTE_ID = 'hyperlane:solana/sol->aleo/sol'
const WARP_ROUTE_PROGRAM = address('8YGT2pZwyZe94qBpGzWfY2TMEVcwaQ1bXAE7YAgpUaM7')
const SYSTEM_PROGRAM = address('11111111111111111111111111111111')
const EXECUTION_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_MOVES_REAL_FUNDS'
const EXECUTION_ENVIRONMENT_VARIABLE = 'EXECUTE_HYPERLANE_SOL'
const SOL_DECIMALS = 9
const NATIVE_TOKEN_PLUGIN_SIZE = 1
const IGP_KIND = 0
const OVERHEAD_IGP_KIND = 1

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function privateKeyBytes(raw: string): Uint8Array {
  let bytes: Uint8Array
  if (raw.startsWith('[')) {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length !== 64 || parsed.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
      throw new Error('SOLANA_PRIVATE_KEY JSON must contain exactly 64 byte values')
    }
    bytes = Uint8Array.from(parsed as number[])
  } else {
    bytes = Uint8Array.from(getBase58Encoder().encode(raw))
  }
  if (bytes.length !== 64) {
    throw new Error('SOLANA_PRIVATE_KEY must be a base58-encoded 64-byte keypair or a Solana CLI JSON byte array')
  }
  return bytes
}

async function signerFromEnvironment(): Promise<{
  signer: TransactionSigner
  localSigner: KeyPairSigner | undefined
}> {
  const privateKey = process.env.SOLANA_PRIVATE_KEY?.trim()
  if (privateKey) {
    const localSigner = await createKeyPairSignerFromBytes(privateKeyBytes(privateKey))
    const configuredSender = process.env.SOLANA_SENDER?.trim()
    if (configuredSender && configuredSender !== localSigner.address) {
      throw new Error(`SOLANA_SENDER does not match the private-key account ${localSigner.address}`)
    }
    return { signer: localSigner, localSigner }
  }
  const sender = address(requiredEnvironmentVariable('SOLANA_SENDER'))
  return { signer: createNoopSigner(sender), localSigner: undefined }
}

function parseAmount(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) throw new Error('SOL_AMOUNT must be a positive decimal')
  const [whole, fraction = ''] = value.split('.')
  if (fraction.length > SOL_DECIMALS) throw new Error(`SOL_AMOUNT supports at most ${SOL_DECIMALS} decimal places`)
  const atomic = BigInt(whole!) * 10n ** BigInt(SOL_DECIMALS)
    + BigInt(fraction.padEnd(SOL_DECIMALS, '0') || '0')
  if (atomic <= 0n) throw new Error('SOL_AMOUNT must be greater than zero')
  return atomic
}

function formatAmount(value: bigint, decimals = SOL_DECIMALS): string {
  const unit = 10n ** BigInt(decimals)
  const fraction = (value % unit).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? `${value / unit}.${fraction}` : (value / unit).toString()
}

function hexToBytes(value: string): Uint8Array {
  const hex = value.startsWith('0x') ? value.slice(2) : value
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('Expected a 32-byte hexadecimal Hyperlane recipient')
  return Uint8Array.from(hex.match(/../g)!.map((byte) => Number.parseInt(byte, 16)))
}

function accountData(value: readonly [string, string] | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (!Array.isArray(value) || value[1] !== 'base64') throw new Error('Solana RPC returned unsupported account encoding')
  return Uint8Array.from(Buffer.from(value[0], 'base64'))
}

function millisecondsFromEnvironment(name: string, defaultValue: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return defaultValue
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1_000) {
    throw new Error(`${name} must be an integer greater than or equal to 1000`)
  }
  return value
}

function stringify(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => typeof nested === 'bigint' ? nested.toString() : nested)
}

/**
 * Quotes or submits the reviewed mainnet Solana SOL-to-Aleo SOL Warp Route.
 *
 * The example uses Veil for route planning, Solana Kit for local keypair
 * signing and RPC, and Hyperlane's Kit-native Sealevel codecs for the deployed
 * Warp Route instruction. It remains read-only unless the execution
 * acknowledgement is set.
 *
 * @returns A promise that resolves after preflight or confirmed Solana submission.
 * @throws Error When input, deployed route state, fee quoting, simulation, or submission fails.
 *
 * @example
 * await runSolanaHyperlaneExample()
 */
export async function runSolanaHyperlaneExample(): Promise<void> {
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com'
  const recipient = requiredEnvironmentVariable('ALEO_RECIPIENT')
  const amount = requiredEnvironmentVariable('SOL_AMOUNT')
  const amountAtomic = parseAmount(amount)
  const { signer, localSigner } = await signerFromEnvironment()
  const rpc = createSolanaRpc(rpcUrl)
  const bridge = createBridgeClient({ environment: 'mainnet' })
  const plan = bridge.prepareTransfer({
    routeId: ROUTE_ID,
    amount,
    recipient,
    sender: signer.address,
  })
  if (plan.amountIn !== amount || plan.sourceAsset.decimals !== SOL_DECIMALS) {
    throw new Error('Veil returned unexpected SOL route units')
  }
  const destinationDomain = bridge.registry.chains.find((chain) => chain.id === 'aleo')?.protocolDomains?.hyperlane
  if (typeof destinationDomain !== 'number' || !Number.isSafeInteger(destinationDomain)) {
    throw new Error('The Veil registry is missing the numeric Aleo Hyperlane domain')
  }

  const { address: tokenPda } = await deriveHyperlaneTokenPda(WARP_ROUTE_PROGRAM)
  const tokenAccount = await rpc.getAccountInfo(tokenPda, { commitment: 'confirmed', encoding: 'base64' }).send()
  if (!tokenAccount.value) throw new Error(`Missing Hyperlane token account ${tokenPda}`)
  const token = decodeHyperlaneTokenAccount(accountData(tokenAccount.value.data), NATIVE_TOKEN_PLUGIN_SIZE)
  if (!token) throw new Error('Unable to decode the deployed SOL Warp Route account')
  if (token.decimals !== SOL_DECIMALS || token.remoteDecimals !== SOL_DECIMALS) {
    throw new Error(`Unexpected SOL Warp Route decimals: ${token.decimals}/${token.remoteDecimals}`)
  }
  if (!token.remoteRouters.has(destinationDomain)) throw new Error('The SOL Warp Route has no enrolled Aleo router')
  if (token.feeConfig) throw new Error('The SOL Warp Route now requires a route fee that this reviewed example does not support')
  if (!token.interchainGasPaymaster) throw new Error('The SOL Warp Route has no configured Interchain Gas Paymaster')

  const destinationGas = token.destinationGas.get(destinationDomain)
  if (destinationGas == null) throw new Error('The SOL Warp Route has no Aleo destination gas configuration')
  const igp = token.interchainGasPaymaster
  let innerIgp: Address
  let overhead = 0n
  if (igp.igpType.kind === OVERHEAD_IGP_KIND) {
    const overheadAccount = await rpc.getAccountInfo(igp.igpType.account, { commitment: 'confirmed', encoding: 'base64' }).send()
    if (!overheadAccount.value) throw new Error(`Missing overhead IGP account ${igp.igpType.account}`)
    const decoded = decodeOverheadIgpAccount(accountData(overheadAccount.value.data))
    if (!decoded) throw new Error('Unable to decode the overhead IGP account')
    innerIgp = decoded.inner
    overhead = decoded.gasOverheads.get(destinationDomain) ?? 0n
  } else if (igp.igpType.kind === IGP_KIND) {
    innerIgp = igp.igpType.account
  } else {
    throw new Error(`Unsupported Hyperlane IGP kind: ${igp.igpType.kind}`)
  }

  const innerIgpAccount = await rpc.getAccountInfo(innerIgp, { commitment: 'confirmed', encoding: 'base64' }).send()
  if (!innerIgpAccount.value) throw new Error(`Missing IGP account ${innerIgp}`)
  const decodedIgp = decodeIgpAccount(accountData(innerIgpAccount.value.data))
  if (!decodedIgp) throw new Error('Unable to decode the IGP account')
  if (decodedIgp.feeConfig) throw new Error('The IGP now requires an off-chain signed quote that this reviewed example does not support')
  const gasOracle = decodedIgp.gasOracles.get(destinationDomain)
  if (!gasOracle) throw new Error('The IGP has no Aleo gas oracle')
  const gas = gasOracle.value
  const quoteScale = 10n ** BigInt(10 + gas.tokenDecimals)
  const hookPayment = ((destinationGas + overhead) * gas.gasPrice * gas.tokenExchangeRate) / quoteScale

  const [balanceResult, latestBlockhash, uniqueMessageAccount] = await Promise.all([
    rpc.getBalance(signer.address, { commitment: 'confirmed' }).send(),
    rpc.getLatestBlockhash({ commitment: 'confirmed' }).send(),
    generateKeyPairSigner(),
  ])
  const balance = BigInt(balanceResult.value)
  const { address: programData } = await deriveIgpProgramDataPda(igp.programId)
  const { address: paymentPda } = await deriveIgpGasPaymentPda(igp.programId, uniqueMessageAccount.address)
  const utf8 = getUtf8Encoder()
  const [nativeCollateral] = await getProgramDerivedAddress({
    programAddress: WARP_ROUTE_PROGRAM,
    seeds: [utf8.encode('hyperlane_token'), utf8.encode('-'), utf8.encode('native_collateral')],
  })
  const transferInstruction = await getTokenTransferRemoteInstruction({
    programAddress: WARP_ROUTE_PROGRAM,
    sender: signer,
    uniqueMessageAccount,
    mailbox: token.mailbox,
    data: {
      destinationDomain,
      recipient: hexToBytes(aleoAddressToBytes32(recipient)),
      amountOrId: amountAtomic,
    },
    igp: {
      programId: igp.programId,
      programData,
      paymentPda,
      igpAccount: igp.igpType.account,
      ...(igp.igpType.kind === OVERHEAD_IGP_KIND ? { innerIgp } : {}),
    },
    pluginAccounts: [
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      { address: nativeCollateral, role: AccountRole.WRITABLE },
    ],
  })
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (message) => setTransactionMessageFeePayerSigner(signer, message),
    (message) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash.value, message),
    (message) => appendTransactionMessageInstructions([
      ...getComputeBudgetInstructions(),
      transferInstruction,
    ], message),
  )
  const compiled = compileTransaction(transactionMessage)
  const encodedMessage = getBase64Decoder().decode(compiled.messageBytes) as TransactionMessageBytesBase64
  const feeResult = await rpc.getFeeForMessage(encodedMessage, { commitment: 'confirmed' }).send()
  if (feeResult.value == null) throw new Error('Solana RPC could not quote the transaction fee')
  const transactionFee = BigInt(feeResult.value)
  const unsignedSimulation = await rpc.simulateTransaction(getBase64EncodedWireTransaction(compiled), {
    commitment: 'confirmed',
    encoding: 'base64',
    sigVerify: false,
  }).send()
  if (unsignedSimulation.value.err) {
    throw new Error(`Solana preflight simulation failed: ${stringify(unsignedSimulation.value.err)}\n${unsignedSimulation.value.logs?.join('\n') ?? ''}`)
  }

  console.log('Read-only Solana SOL to Aleo SOL preflight')
  console.table({
    route: ROUTE_ID,
    sender: signer.address,
    recipient,
    amount: `${formatAmount(amountAtomic)} SOL`,
    nativeBalance: `${formatAmount(balance)} SOL`,
    hyperlaneHookPayment: `${formatAmount(hookPayment)} SOL`,
    solanaTransactionFee: `${formatAmount(transactionFee)} SOL`,
    transactionValue: `${formatAmount(amountAtomic + hookPayment + transactionFee)} SOL`,
    warpRouteProgram: WARP_ROUTE_PROGRAM,
    destinationDomain,
    sourceBalanceType: 'native SOL',
    signingLibrary: '@solana/kit',
  })

  if (process.env[EXECUTION_ENVIRONMENT_VARIABLE] !== EXECUTION_ACKNOWLEDGEMENT) {
    console.log('\nPreflight complete; no SOL was transferred.')
    console.log(`Set ${EXECUTION_ENVIRONMENT_VARIABLE}=${EXECUTION_ACKNOWLEDGEMENT} to submit the transfer.`)
    return
  }
  if (!localSigner) throw new Error('SOLANA_PRIVATE_KEY is required for execution')
  const totalRequired = amountAtomic + hookPayment + transactionFee
  if (balance < totalRequired) {
    throw new Error(`Insufficient SOL balance; requires at least ${formatAmount(totalRequired)} SOL`)
  }

  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage)
  const encodedTransaction = getBase64EncodedWireTransaction(signedTransaction)
  const simulation = await rpc.simulateTransaction(encodedTransaction, {
    commitment: 'confirmed',
    encoding: 'base64',
    sigVerify: true,
  }).send()
  if (simulation.value.err) {
    throw new Error(`Solana simulation failed: ${stringify(simulation.value.err)}\n${simulation.value.logs?.join('\n') ?? ''}`)
  }
  const signature = await rpc.sendTransaction(encodedTransaction, {
    encoding: 'base64',
    preflightCommitment: 'confirmed',
  }).send()
  console.log('\nBroadcast Solana transaction:', signature)

  const confirmationTimeout = millisecondsFromEnvironment('SOLANA_CONFIRMATION_TIMEOUT_MS', 2 * 60_000)
  const deadline = Date.now() + confirmationTimeout
  while (Date.now() < deadline) {
    const status = (await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send()).value[0]
    if (status?.err) throw new Error(`Solana transaction failed: ${stringify(status.err)}`)
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      console.log('Solana SOL dispatch confirmed:', signature)
      console.log('A Hyperlane relayer will deliver the message and mint SOL on Aleo.')
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  throw new Error(`Timed out waiting for ${signature}; check its status before retrying because it was already broadcast`)
}

runSolanaHyperlaneExample().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
