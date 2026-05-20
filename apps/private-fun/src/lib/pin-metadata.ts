import type { PumpMetadata } from './recipes/pump-launch.js'

const PINATA_JWT = import.meta.env.VITE_PINATA_JWT ?? ''

export async function pinMetadataToIpfs(metadata: PumpMetadata): Promise<string> {
  if (!PINATA_JWT) {
    throw new Error('VITE_PINATA_JWT not set — required for IPFS pinning')
  }
  const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PINATA_JWT}`,
    },
    body: JSON.stringify({ pinataContent: metadata }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Pinata pin failed: HTTP ${response.status}${text ? `: ${text}` : ''}`)
  }
  const json = (await response.json()) as { IpfsHash: string }
  return `ipfs://${json.IpfsHash}`
}
