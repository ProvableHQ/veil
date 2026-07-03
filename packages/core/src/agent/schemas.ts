import type { AgentToolSchema } from './types.js'

// ---------------------------------------------------------------------------
// Public (read-only) tool schemas
// ---------------------------------------------------------------------------

/**
 * Describes the `aleo_get_block_number` tool: reads the latest Aleo block height.
 *
 * The paired handler calls `getBlockNumber` on the public client and returns
 * `{ height }` with the height as a decimal string.
 */
export const getBlockNumberSchema: AgentToolSchema = {
  name: 'aleo_get_block_number',
  description:
    'Get the current Aleo blockchain height (latest block number). ' +
    'Returns a single numeric string. Useful for checking chain liveness or polling for new blocks.',
  inputSchema: { type: 'object', properties: {}, required: [] },
}

/**
 * Describes the `aleo_get_balance` tool: reads an address's public credits balance.
 *
 * The paired handler calls `getBalance` on the public client and returns
 * `{ balance, unit, address }` with the balance in microcredits as a decimal
 * string. Private record balances are not included.
 */
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

/**
 * Describes the `aleo_read_mapping` tool: reads one key from a program's public mapping.
 *
 * The paired handler calls `readContract` on the public client and returns
 * `{ value, program, mapping, key }`, echoing the lookup alongside the value.
 */
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

/**
 * Describes the `aleo_get_program` tool: fetches a deployed program's source.
 *
 * The paired handler calls `getCode` on the public client and returns
 * `{ source, program }` with the raw Aleo instructions text. For a parsed
 * view of functions and mappings, prefer {@link describeProgramSchema}'s tool.
 */
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

/**
 * Describes the `aleo_get_block` tool: fetches a block by height or hash.
 *
 * The paired handler calls `getBlock` on the public client and returns
 * `{ block }` with the full block object.
 */
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

/**
 * Describes the `aleo_get_transaction` tool: fetches a transaction by its `at1...` ID.
 *
 * The paired handler calls `getTransaction` on the public client and returns
 * `{ transaction }` with transitions, fee, and status.
 */
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

/**
 * Describes the `aleo_describe_program` tool: fetches and parses a program's interface.
 *
 * The paired handler fetches the source via the public client, parses it
 * locally, and returns `{ program, functions, mappings, closures }` — each
 * function with its input/output types, each mapping with its key/value types.
 * The tool for an agent to call before executing an unfamiliar program.
 */
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

/**
 * Describes the `aleo_execute` tool: executes a transition on an Aleo program.
 *
 * The paired handler calls `writeContract` on the wallet client — which signs,
 * proves, and submits to the network — and returns `{ transactionId }` with
 * the `at1...` ID. Requires a wallet client with a signing account.
 */
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

/**
 * Describes the `aleo_transfer` tool: sends public credits to another address.
 *
 * The paired handler calls `transfer` on the wallet client (a wrapper around
 * `credits.aleo/transfer_public`) — which signs, proves, and submits to the
 * network — and returns `{ transactionId }`. Amount is in microcredits (u64).
 */
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

/**
 * Describes the `aleo_deploy` tool: deploys a program to the network.
 *
 * The paired handler calls `deployContract` on the wallet client with the full
 * program source — which signs, proves, and submits to the network — and
 * returns `{ transactionId }`. Requires a wallet client with a signing account.
 */
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

/**
 * Lists the schemas for the read-only tools, which need only a `PublicClient`.
 *
 * Use this set when the agent should query the chain but never sign or spend.
 */
export const publicToolSchemas: AgentToolSchema[] = [
  getBlockNumberSchema,
  getBalanceSchema,
  readMappingSchema,
  getProgramSchema,
  getBlockSchema,
  getTransactionSchema,
  describeProgramSchema,
]

/**
 * Lists the schemas for the write tools, which need a `WalletClient` with a
 * signing account.
 *
 * Every tool in this set produces a fee-paying transaction when invoked.
 */
export const walletToolSchemas: AgentToolSchema[] = [
  executeSchema,
  transferSchema,
  deploySchema,
]

/**
 * Lists every built-in tool schema — {@link publicToolSchemas} followed by
 * {@link walletToolSchemas}.
 *
 * Use when registering the full Aleo tool set with an LLM up front;
 * `aleoAgentToolSchemas` filters the same set by the clients on hand.
 */
export const allToolSchemas: AgentToolSchema[] = [
  ...publicToolSchemas,
  ...walletToolSchemas,
]
