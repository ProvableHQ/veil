import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { assertShape, type ShapeSpec } from '../../support/assertShape.js'

import { getLatestEdition } from '../../../src/actions/public/getLatestEdition.js'
import { getProgramByEdition } from '../../../src/actions/public/getProgramByEdition.js'
import { getAmendmentCount } from '../../../src/actions/public/getAmendmentCount.js'
import { getAmendmentCountByEdition } from '../../../src/actions/public/getAmendmentCountByEdition.js'
import { getDeploymentTransactionByEdition } from '../../../src/actions/public/getDeploymentTransactionByEdition.js'
import { getOriginalDeploymentTransaction } from '../../../src/actions/public/getOriginalDeploymentTransaction.js'
import { getAmendmentDeploymentTransaction } from '../../../src/actions/public/getAmendmentDeploymentTransaction.js'
import { getProgramCallsPaginated } from '../../../src/actions/public/getProgramCallsPaginated.js'
import { getProgramIdByAddress } from '../../../src/actions/public/getProgramIdByAddress.js'
import { getProgramAddress } from '../../../src/actions/public/getProgramAddress.js'
import { findBlockHeightByStateRoot } from '../../../src/actions/public/findBlockHeightByStateRoot.js'
import { getStatePaths } from '../../../src/actions/public/getStatePaths.js'
import { getBlockHeightByHash } from '../../../src/actions/public/getBlockHeightByHash.js'
import { getBlockTransactionsByHash } from '../../../src/actions/public/getBlockTransactionsByHash.js'
import { getTokenDetails } from '../../../src/actions/public/getTokenDetails.js'
import { getProgramMetricsByRange } from '../../../src/actions/public/getProgramMetricsByRange.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = resolve(__dirname, '../../fixtures/public')

function loadFixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(resolve(fixturesDir, `${name}.json`), 'utf-8')) as T
}

function mockClient(response: unknown) {
  return { request: vi.fn().mockResolvedValue(response) } as any
}

// Declared response shapes — assertions encode what each action promises to return.
const amendmentCountShape: ShapeSpec = {
  program_id: 'string',
  edition: 'number',
  amendment_count: 'number',
}

const programCallShape: ShapeSpec = {
  transaction_id: 'string',
  function_id: 'string',
  block_number: 'number',
  block_timestamp: 'string',
  status: 'string',
}

const programCallsCursorShape: ShapeSpec = {
  block_number: 'number',
  transition_id: 'string',
}

const programCallsPaginatedShape: ShapeSpec = {
  prev_cursor: { __nullable: programCallsCursorShape },
  next_cursor: { __nullable: programCallsCursorShape },
  calls: { __array: programCallShape },
}

const blockTxShape: ShapeSpec = {
  id: 'string',
  fee: 'number',
  status: 'string',
  block_height: 'number',
  block_timestamp: 'string',
  block_hash: 'string',
  transaction_type: 'string',
  program_id: 'string',
  function_id: 'string',
}

const blockTransactionsByHashShape: ShapeSpec = {
  transactions: { __array: blockTxShape },
}

const tokenInfoShape: ShapeSpec = {
  token_id: 'string',
  token_id_datatype: 'string',
  symbol: 'string',
  display: 'string',
  program_name: 'string',
  decimals: 'number',
  total_supply: 'string',
  verified: 'boolean',
  token_icon_url: { __nullable: 'string' },
  compliance_freeze_list: { __nullable: 'unknown' },
  price: { __nullable: 'string' },
  price_change_percentage_24h: { __nullable: 'string' },
  fully_diluted_value: { __nullable: 'string' },
  total_market_cap: { __nullable: 'string' },
  volume_24h: { __nullable: 'string' },
}

const tokenPricePointShape: ShapeSpec = {
  day: 'string',
  price_usd: { __nullable: 'string' },
  volume_24h: { __nullable: 'string' },
  total_market_cap: { __nullable: 'string' },
}

const tokenPaginationShape: ShapeSpec = {
  limit: 'number',
  offset: 'number',
  total_count: 'number',
  has_next: 'boolean',
  has_previous: 'boolean',
}

const tokenDetailsShape: ShapeSpec = {
  token: { __nullable: tokenInfoShape },
  price_history: {
    pagination: { __nullable: tokenPaginationShape },
    data: { __array: tokenPricePointShape },
  },
}

const programMetricsDayPointShape: ShapeSpec = {
  day: 'string',
  calls: 'number',
}

describe('publicClient action fixtures — runtime shape validation', () => {
  it('getLatestEdition — number', async () => {
    const client = mockClient(7)
    const result = await getLatestEdition(client, { programId: 'token.aleo' })
    assertShape(result, 'number')
    expect(result).toBe(7)
  })

  it('getProgramByEdition — string (raw program source)', async () => {
    const source = 'program token.aleo;\n\nfunction transfer:\n  input r0 as address.public;\n'
    const client = mockClient(source)
    const result = await getProgramByEdition(client, { programId: 'token.aleo', edition: 3 })
    assertShape(result, 'string')
    expect(result).toBe(source)
  })

  it('getAmendmentCount — { program_id, edition, amendment_count }', async () => {
    const fixture = loadFixture('getAmendmentCount')
    const client = mockClient(fixture)
    const result = await getAmendmentCount(client, { programId: 'token.aleo' })
    assertShape(result, amendmentCountShape)
  })

  it('getAmendmentCountByEdition — same object shape', async () => {
    const fixture = loadFixture('getAmendmentCountByEdition')
    const client = mockClient(fixture)
    const result = await getAmendmentCountByEdition(client, { programId: 'token.aleo', edition: 2 })
    assertShape(result, amendmentCountShape)
  })

  it('getDeploymentTransactionByEdition — string', async () => {
    const client = mockClient('at1deployedition')
    const result = await getDeploymentTransactionByEdition(client, { programId: 'token.aleo', edition: 4 })
    assertShape(result, 'string')
  })

  it('getOriginalDeploymentTransaction — string', async () => {
    const client = mockClient('at1original')
    const result = await getOriginalDeploymentTransaction(client, { programId: 'token.aleo', edition: 4 })
    assertShape(result, 'string')
  })

  it('getAmendmentDeploymentTransaction — string | null (string case)', async () => {
    const client = mockClient('at1amendment')
    const result = await getAmendmentDeploymentTransaction(client, {
      programId: 'token.aleo',
      edition: 4,
      amendment: 2,
    })
    assertShape(result, { __nullable: 'string' })
    expect(result).toBe('at1amendment')
  })

  it('getAmendmentDeploymentTransaction — string | null (null case)', async () => {
    const client = mockClient(null)
    const result = await getAmendmentDeploymentTransaction(client, {
      programId: 'token.aleo',
      edition: 4,
      amendment: 999,
    })
    assertShape(result, { __nullable: 'string' })
    expect(result).toBeNull()
  })

  it('getProgramCallsPaginated — paginated cursor shape', async () => {
    const fixture = loadFixture('getProgramCallsPaginated')
    const client = mockClient(fixture)
    const result = await getProgramCallsPaginated(client, { programId: 'token.aleo' })
    assertShape(result, programCallsPaginatedShape)
  })

  it('getProgramIdByAddress — string', async () => {
    const client = mockClient('token.aleo')
    const result = await getProgramIdByAddress(client, { address: 'aleo1program' })
    assertShape(result, 'string')
  })

  it('getProgramAddress — string', async () => {
    const client = mockClient('aleo1program')
    const result = await getProgramAddress(client, { programId: 'token.aleo' })
    assertShape(result, 'string')
  })

  it('findBlockHeightByStateRoot — number', async () => {
    const client = mockClient(42)
    const result = await findBlockHeightByStateRoot(client, { stateRoot: 'sr1abc' })
    assertShape(result, 'number')
  })

  it('getStatePaths — string[]', async () => {
    const fixture = loadFixture('getStatePaths')
    const client = mockClient(fixture)
    const result = await getStatePaths(client, { commitments: ['c1', 'c2', 'c3'] })
    assertShape(result, { __array: 'string' })
  })

  it('getBlockHeightByHash — number', async () => {
    const client = mockClient(100)
    const result = await getBlockHeightByHash(client, { hash: 'ab1block' })
    assertShape(result, 'number')
  })

  it('getBlockTransactionsByHash — { transactions[] }', async () => {
    const fixture = loadFixture('getBlockTransactionsByHash')
    const client = mockClient(fixture)
    const result = await getBlockTransactionsByHash(client, { hash: 'ab1block' })
    assertShape(result, blockTransactionsByHashShape)
  })

  it('getTokenDetails — token + price_history', async () => {
    const fixture = loadFixture('getTokenDetails')
    const client = mockClient(fixture)
    const result = await getTokenDetails(client, { programId: 'foo.aleo' })
    assertShape(result, tokenDetailsShape)
  })

  it('getProgramMetricsByRange — { day, calls }[]', async () => {
    const fixture = loadFixture('getProgramMetricsByRange')
    const client = mockClient(fixture)
    const result = await getProgramMetricsByRange(client, { programId: 'token.aleo', days: 30 })
    assertShape(result, { __array: programMetricsDayPointShape })
  })
})
