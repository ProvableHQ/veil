#!/usr/bin/env node
// Checks that the mainnet Shield Swap API spec is a subset of the testnet one.
//
// The generated client types come from the testnet spec alone, so the two
// deployments MUST agree on everything they share: every mainnet operation
// and schema has to exist on testnet with an identical definition. Exits
// non-zero listing each inconsistency; otherwise prints the routes only
// testnet serves so their ApiClient methods can carry a "testnet only" note.
//
// Usage: node check-networks.mjs <testnet-openapi.json> <mainnet-openapi.json>
import { readFileSync } from 'node:fs'

const [testnetFile, mainnetFile] = process.argv.slice(2)
if (!testnetFile || !mainnetFile) {
  console.error('usage: check-networks.mjs <testnet-openapi.json> <mainnet-openapi.json>')
  process.exit(2)
}
const testnet = JSON.parse(readFileSync(testnetFile, 'utf8'))
const mainnet = JSON.parse(readFileSync(mainnetFile, 'utf8'))

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']

// Enumerates every method + path pair a spec serves.
function operations(spec) {
  const out = new Map()
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of METHODS) {
      if (item[method]) out.set(`${method.toUpperCase()} ${path}`, item[method])
    }
  }
  return out
}

// Serializes with object keys sorted at every level, so two hosts that emit
// the same definition with a different property order still compare equal.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

const same = (a, b) => canonical(a) === canonical(b)

const testnetOps = operations(testnet)
const mainnetOps = operations(mainnet)
const problems = []

for (const [key, op] of mainnetOps) {
  const counterpart = testnetOps.get(key)
  if (!counterpart) problems.push(`mainnet-only operation: ${key}`)
  else if (!same(op, counterpart)) problems.push(`operation differs between networks: ${key}`)
}
for (const [name, schema] of Object.entries(mainnet.components?.schemas ?? {})) {
  const counterpart = testnet.components?.schemas?.[name]
  if (!counterpart) problems.push(`mainnet-only schema: ${name}`)
  else if (!same(schema, counterpart)) problems.push(`schema differs between networks: ${name}`)
}

if (problems.length > 0) {
  console.error('The mainnet and testnet Shield Swap API specs are inconsistent:')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

const testnetOnly = [...testnetOps.keys()].filter((key) => !mainnetOps.has(key)).sort()
console.log(`mainnet spec is a subset of testnet; ${testnetOnly.length} testnet-only route(s):`)
for (const key of testnetOnly) console.log(`  - ${key}`)
