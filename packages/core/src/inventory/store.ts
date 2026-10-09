import type { RecordInventoryStore, RecordSpend } from './types.js'

/**
 * Builds an atomic, process-local reservation store.
 * Data disappears when the process exits; use a durable implementation for bots.
 * @returns A store shared by every client given the returned instance.
 * @example
 * const store = memoryRecordInventoryStore()
 */
export function memoryRecordInventoryStore(): RecordInventoryStore {
  const entries: RecordSpend[] = []
  // Journal values are wire-format JSON, so cloning needs no runtime-specific API.
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  return {
    list: async (scope) => copy(entries.filter((entry) => entry.scope === scope)),
    acquire: async (entry) => {
      if (new Set(entry.records).size !== entry.records.length) throw new Error('Duplicate record inputs')
      if (entries.some((old) => old.scope === entry.scope && holdsRecords(old) &&
        old.records.some((id) => entry.records.includes(id)))) return undefined
      const saved = copy({ ...entry, id: String(entries.length + 1) })
      entries.push(saved)
      return copy(saved)
    },
    update: async (scope, id, patch) => {
      const entry = entries.find((item) => item.scope === scope && item.id === id)
      if (!entry) throw new Error('Unknown record reservation')
      Object.assign(entry, copy(patch))
      if ('transaction' in patch && patch.transaction === undefined) delete entry.transaction
    },
  }
}

/** Returns whether a journal entry excludes its inputs from record selection. */
export function holdsRecords(entry: RecordSpend): boolean {
  return entry.status !== 'cancelled' && entry.status !== 'rejected'
}
