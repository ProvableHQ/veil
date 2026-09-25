import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fileXReservePrivateMintIdentityStore } from '../src/node.js'
import {
  reserveXReservePrivateMintIdentity,
  type XReservePrivateMintIdentity,
} from '../src/utils/xreservePrivateMintStore.js'
import { xReserveViewKeyToScalar } from '../src/utils/xreserve.js'

const RECIPIENT = 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n'
const VIEW_KEY = 'AViewKey1sqm952gJj1tmAWySYDQvSv2NmfnyEMvU6a9ZBCuyG7PN'
const directories: string[] = []

async function temporaryStorePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'aleo-bridge-private-mints-'))
  directories.push(directory)
  return join(directory, 'identities.json')
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('Node private-mint identity store', () => {
  it('replaces an existing permissive file with mode 0600', async () => {
    const path = await temporaryStorePath()
    await writeFile(path, '[]\n')
    await chmod(path, 0o644)
    const identity: XReservePrivateMintIdentity = {
      counter: 0,
      recipient: RECIPIENT,
      secretNonce: '7scalar',
      addressCommitment: 'ab'.repeat(32),
    }

    await fileXReservePrivateMintIdentityStore(path).save([identity])

    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual([identity])
  })

  it('serializes reservations across separate stores using the same file', async () => {
    const path = await temporaryStorePath()
    const firstStore = fileXReservePrivateMintIdentityStore(path)
    const secondStore = fileXReservePrivateMintIdentityStore(path)
    const viewKeyScalar = await xReserveViewKeyToScalar(VIEW_KEY, 'testnet')
    const reserve = (store: typeof firstStore) => reserveXReservePrivateMintIdentity({
      store,
      viewKeyScalar,
      recipient: RECIPIENT,
      environment: 'testnet',
    })

    const reserved = await Promise.all([reserve(firstStore), reserve(secondStore)])

    expect(reserved.map((identity) => identity.counter).sort()).toEqual([0, 1])
    expect((await firstStore.load()).map((identity) => identity.counter)).toEqual([0, 1])
    await expect(stat(`${path}.lock`)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
