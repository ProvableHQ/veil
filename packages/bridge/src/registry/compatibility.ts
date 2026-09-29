import { sha256, stringToHex } from 'viem'
import type { BridgeRegistry, ProtocolBridgeChain } from '../types/protocol.js'

// SHA-256 of canonical route, asset, and chain data from main commit
// 044fdcdede0adc53ef4d49836707bbbf9f12cd82 (2026-08-31.solana-deposits.1).
// Chain domains include only the route's protocol: adding CCTP must not
// invalidate an otherwise unchanged xReserve or Hyperlane deployment.
const LEGACY_ROUTE_HASHES: Readonly<Record<string, string>> = {
  'xreserve:ethereum/usdc->aleo/usdcx': '0xa44b4fddb24ef7b6bf9b9b1c412995dd2ae23a8ac062174bad4e5e728b287174',
  'xreserve:aleo/usdcx->ethereum/usdc': '0xd4afb499f403e6b78b8de118f5c0fe9be43343e6b098c69019b93ac5eaf1466b',
  'xreserve:sepolia/usdc->aleo-testnet/usdcx': '0x4808880535915ae40c9e6ec94dd5f1d21dc9f35bf4da45bcead639c654f2ca1a',
  'xreserve:aleo-testnet/usdcx->sepolia/usdc': '0xe3b7ca9980618375b1071581da8740b5038c68ddebc2c63b44bc65826718e0db',
  'hyperlane:ethereum/eth->aleo/eth': '0x68f54e7e80290d14efb04f96615acbfc7f62f3ae3258a871c8d0ed337385d374',
  'hyperlane:aleo/eth->ethereum/eth': '0x1bb78fc35866c861c91bafad2d86a80f6721421f8c1634ea37922f7bcdf1313f',
  'hyperlane:ethereum/wbtc->aleo/wbtc': '0xb9e5183ffe3ee6de045cb455791df38f4cd3e857a807b0684388e8daf52377a8',
  'hyperlane:aleo/wbtc->ethereum/wbtc': '0xaa826701601dbdca39851f553a64a06f8d09b766437ada933bfa9d92ffdd8b5b',
  'hyperlane:ethereum/usdt->aleo/usdt': '0xe5bf77a295e6336e2dcba97a245ce088951caa9072c64b1b9b77bcb24f24a393',
  'hyperlane:aleo/usdt->ethereum/usdt': '0xd11ffde0d249872f4e60a9ebf20011e943b0c9feb5a0adfae91a7c860eac61c6',
  'hyperlane:solana/sol->aleo/sol': '0xbaf4d8a05f32249a097e5d4236ac0161213e37eabca9991ffda248183b2c55a1',
  'hyperlane:aleo/sol->solana/sol': '0x69b42a471fba4bc105da8d3b2762150178dc6fb1362d3e277fd08c7092c8006a',
  'hyperlane:aleo/aleo->ethereum/aleo': '0xe829c0747305bfd6f57b4ec643abff9234a5d5a6e4b910cf85514255d3184d78',
  'hyperlane:ethereum/aleo->aleo/aleo': '0x22c51726ccb69a7bd9bc0c930a77ba16a6b65ab59b3cca503b5dd55f5d95c33a',
  'hyperlane:aleo/aleo->solana/aleo': '0x07d9040b8484c89347601b5ecf6a362c0fb64a9afec634a90c0f5bf4964e0969',
  'hyperlane:solana/aleo->aleo/aleo': '0x847973f4186d6a03fe976a237799093e789ad536703d0d39673930e354149c23',
  'hyperlane:aleo/aleo->base/aleo': '0xc82742b13ee44a5f2ff4697ed7fcd88baf4faaed7b6d49778df238bf056b11ba',
  'hyperlane:base/aleo->aleo/aleo': '0xeeaae2aec3c0c1c1faf42b2a1fbd70e0a82b34af78ebe16fb9c1ec0394d38358',
  'hyperlane:aleo/aleo->hyperevm/aleo': '0x7e3cfc7407d5e136108d2a4ac1b3125b211080a880023329e723dddfb890d1d0',
  'hyperlane:hyperevm/aleo->aleo/aleo': '0x6f841ad12206d30fa1d7501bb175bdd22463e2755079e77a66bb7d737c677080',
  'hyperlane:ethereum/usad->aleo/usad': '0xdbe044e86456de025a3895341d2bee19f2f1443ae35b0c727ce1ff95fb8ca6a6',
  'hyperlane:aleo/usad->ethereum/usad': '0x7ca2bf58c99ea3a9528b4aad047e2fc47e17bae1453c3acf8f1a7ded7f682d02',
}

/**
 * Accepts an exact registry version or an unchanged, reviewed pre-Arc route.
 * Checks pinned deployment fingerprints locally; unknown versions and changed
 * routes remain incompatible, including injected registries with reused labels.
 * @param registry Current assets, chains, and deployments used for execution.
 * @param version Registry version stored in a plan or checkpoint.
 * @param routeId Direction whose deployment must still match the reviewed snapshot.
 * @returns Whether the saved version can safely use this registry's route.
 * @example const compatible = isRegistryVersionCompatible(registry, plan.registryVersion, plan.route.id)
 */
export function isRegistryVersionCompatible(registry: BridgeRegistry, version: string, routeId: string): boolean {
  if (version === registry.version) return true
  if (version !== '2026-08-31.solana-deposits.1' || registry.version !== '2026-09-28.cctp-arc.1') return false
  const expected = LEGACY_ROUTE_HASHES[routeId]
  if (!expected) return false
  const route = registry.routes.find(entry => entry.id === routeId)
  if (!route) return false
  const sourceAsset = registry.assets.find(entry => entry.id === route.sourceAssetId)
  const destinationAsset = registry.assets.find(entry => entry.id === route.destinationAssetId)
  const sourceChain = registry.chains.find(entry => entry.id === sourceAsset?.chainId)
  const destinationChain = registry.chains.find(entry => entry.id === destinationAsset?.chainId)
  if (!sourceAsset || !destinationAsset || !sourceChain || !destinationChain) return false
  // Sepolia's pre-Arc catalog omitted its reviewed xReserve domain 0.
  // Normalize only that explicit correction when checking the legacy hash.
  if (route.protocol === 'xreserve' && [sourceChain, destinationChain].some(entry => entry.id === 'sepolia' && entry.protocolDomains?.xreserve !== 0)) return false
  const chain = (entry: ProtocolBridgeChain) => ({
    ...entry, protocolDomains: { [route.protocol]: entry.id === 'sepolia' && route.protocol === 'xreserve' ? null : entry.protocolDomains?.[route.protocol] ?? null },
  })
  // Sort object keys recursively so serialization order cannot affect compatibility.
  const canonical = JSON.stringify({ route, sourceAsset, destinationAsset,
    sourceChain: chain(sourceChain), destinationChain: chain(destinationChain),
  }, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value)
  return sha256(stringToHex(canonical)) === expected
}
