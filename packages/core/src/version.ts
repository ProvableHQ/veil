/**
 * Identifies the published version of `@provablehq/veil-core`.
 *
 * Mirrors `package.json` and is kept in sync by the release flow; the
 * transport embeds it in the default `X-Veil-Client` header, and a drift
 * between this constant and `package.json` fails the transport test suite.
 * Pure and local.
 *
 * @example
 * import { http, version } from '@provablehq/veil-core'
 *
 * const transport = http('https://api.provable.com/v2', {
 *   clientHeader: `my-dapp/1.2 veil-core/${version}`,
 * })
 */
export const version = '0.5.0'
