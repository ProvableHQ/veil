import type { AgentToolSchema } from './types.js'

// ---------------------------------------------------------------------------
// Public (read-only) tool schemas
// ---------------------------------------------------------------------------

export const getBlockNumberSchema: AgentToolSchema = {
  name: 'aleo_get_block_number',
  description:
    'Get the current Aleo blockchain height (latest block number). ' +
    'Returns a single numeric string. Useful for checking chain liveness or polling for new blocks.',
  inputSchema: { type: 'object', properties: {}, required: [] },
}

export const getBalanceSchema: AgentToolSchema = {
  name: 'aleo_get_balance',
  description:
    'Get the public Aleo credits balance for an address. ' +
    'Returns the balance in microcredits (1 credit = 1 000 000 microcredits). ' +
    'Only reflects the public balance — private record balances are not included.',
  inputSchema: {
    type: 'object',
    properties: {
      address: { type: 'string', description: 'Aleo address starting with aleo1...' },
    },
    required: ['address'],
  },
}

export const readMappingSchema: AgentToolSchema = {
  name: 'aleo_read_mapping',
  description:
    "Read a value from an Aleo program's public mapping (on-chain key-value store). " +
    "Equivalent to viem's readContract. Example: read credits.aleo/account to get a balance.",
  inputSchema: {
    type: 'object',
    properties: {
      program: { type: 'string', description: "Program ID, e.g. 'credits.aleo'" },
      mapping: { type: 'string', description: "Mapping name, e.g. 'account'" },
      key: { type: 'string', description: 'Key to look up in the mapping' },
    },
    required: ['program', 'mapping', 'key'],
  },
}

export const getProgramSchema: AgentToolSchema = {
  name: 'aleo_get_program',
  description:
    'Fetch the source code of a deployed Aleo program. ' +
    "Returns the raw Aleo instructions source. Equivalent to viem's getCode.",
  inputSchema: {
    type: 'object',
    properties: {
      program: { type: 'string', description: "Program ID, e.g. 'credits.aleo'" },
    },
    required: ['program'],
  },
}

export const getBlockSchema: AgentToolSchema = {
  name: 'aleo_get_block',
  description:
    'Get an Aleo block by height or hash. ' +
    'Provide either a numeric height or a block hash. Returns the full block object.',
  inputSchema: {
    type: 'object',
    properties: {
      height: { type: 'number', description: 'Block height (number)' },
      hash: { type: 'string', description: 'Block hash' },
    },
  },
}

export const getTransactionSchema: AgentToolSchema = {
  name: 'aleo_get_transaction',
  description:
    'Get an Aleo transaction by its ID. ' +
    'Returns the full transaction object including transitions, fee, and status.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Transaction ID (at1...)' },
    },
    required: ['id'],
  },
}

export const describeProgramSchema: AgentToolSchema = {
  name: 'aleo_describe_program',
  description:
    'Fetch and parse an Aleo program, returning its functions (with input/output types), ' +
    'mappings (key/value types), and closures. Useful for understanding what a program can do ' +
    'before calling it.',
  inputSchema: {
    type: 'object',
    properties: {
      program: { type: 'string', description: "Program ID, e.g. 'credits.aleo'" },
    },
    required: ['program'],
  },
}

// ---------------------------------------------------------------------------
// Wallet (write) tool schemas
// ---------------------------------------------------------------------------

export const executeSchema: AgentToolSchema = {
  name: 'aleo_execute',
  description:
    "Execute a transition on an Aleo program. Equivalent to viem's writeContract. " +
    'Requires a wallet client with a signing account. Returns a transaction ID.',
  inputSchema: {
    type: 'object',
    properties: {
      program: { type: 'string', description: "Program ID, e.g. 'token.aleo'" },
      function: { type: 'string', description: "Function name, e.g. 'mint'" },
      inputs: {
        type: 'array',
        items: { type: 'string' },
        description: "Array of input arguments as strings, e.g. ['aleo1...', '100u64']",
      },
      privateFee: {
        type: 'boolean',
        description:
          'If true, pay the fee from a private record instead of public credits. ' +
          "The fee record is selected by the wallet's record provider.",
      },
      imports: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Names of programs reached via dynamic dispatch that the prover or wallet ' +
          "can't discover from the program's static `import` block. Static imports " +
          'are auto-discovered and should not be listed here.',
      },
    },
    required: ['program', 'function', 'inputs'],
  },
}

export const transferSchema: AgentToolSchema = {
  name: 'aleo_transfer',
  description:
    'Transfer Aleo credits to another address. ' +
    'Convenience wrapper around credits.aleo/transfer_public. Amount is in microcredits.',
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient Aleo address' },
      amount: { type: 'number', description: 'Amount in microcredits' },
    },
    required: ['to', 'amount'],
  },
}

export const deploySchema: AgentToolSchema = {
  name: 'aleo_deploy',
  description:
    'Deploy an Aleo program to the network. ' +
    'Requires a wallet client with a signing account. ' +
    'Provide the full program source code. Returns a transaction ID.',
  inputSchema: {
    type: 'object',
    properties: {
      program: { type: 'string', description: 'Full Aleo program source code to deploy' },
      privateFee: {
        type: 'boolean',
        description:
          'If true, pay the deployment fee from a private record instead of public credits. ' +
          "The fee record is selected by the wallet's record provider.",
      },
    },
    required: ['program'],
  },
}

// ---------------------------------------------------------------------------
// Grouped exports
// ---------------------------------------------------------------------------

export const publicToolSchemas: AgentToolSchema[] = [
  getBlockNumberSchema,
  getBalanceSchema,
  readMappingSchema,
  getProgramSchema,
  getBlockSchema,
  getTransactionSchema,
  describeProgramSchema,
]

export const walletToolSchemas: AgentToolSchema[] = [
  executeSchema,
  transferSchema,
  deploySchema,
]

export const allToolSchemas: AgentToolSchema[] = [
  ...publicToolSchemas,
  ...walletToolSchemas,
]
