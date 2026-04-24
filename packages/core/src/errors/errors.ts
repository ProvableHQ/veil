export class BaseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BaseError'
  }
}

export class TransportError extends BaseError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TransportError'
  }
}

export class AccountNotFoundError extends BaseError {
  constructor() {
    super(
      'No account configured. To read data, use createPublicClient. ' +
      'To sign transactions, use createWalletClient with an account:\n' +
      '  createWalletClient({ account: rpcAccount(walletAdapter), transport: custom(walletAdapter) })',
    )
    this.name = 'AccountNotFoundError'
  }
}

export class ProvingNotConfiguredError extends BaseError {
  constructor() {
    super(
      'No proving configuration found. Local accounts require a proving config:\n' +
      '  createWalletClient({ account, transport, proving: { mode: \'delegated\', url: \'...\' } })\n' +
      'Or use an RPC account (wallet adapter) which handles proving internally.',
    )
    this.name = 'ProvingNotConfiguredError'
  }
}

export class InvalidAddressError extends BaseError {
  constructor(address: string) {
    super(
      `Invalid Aleo address: "${address}". ` +
      'Aleo addresses start with "aleo1" followed by 58 lowercase alphanumeric characters.',
    )
    this.name = 'InvalidAddressError'
  }
}

export class ProgramNotFoundError extends BaseError {
  constructor(program: string) {
    super(
      `Program "${program}" not found. ` +
      'Verify the program ID is correct and has been deployed. ' +
      `Check with: await client.getCode({ programId: '${program}' })`,
    )
    this.name = 'ProgramNotFoundError'
  }
}

export class InvalidInputError extends BaseError {
  constructor(functionName: string, expected: string, received: string) {
    super(
      `Invalid input for function "${functionName}": expected ${expected}, received "${received}". ` +
      'Use encodeValue() to convert values, e.g. encodeValue(100n, \'u64\') → \'100u64\'.',
    )
    this.name = 'InvalidInputError'
  }
}
