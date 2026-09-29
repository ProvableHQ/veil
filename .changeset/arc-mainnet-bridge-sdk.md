---
"@provablehq/aleo-bridge-sdk": minor
---

Add Arc mainnet USDC-to-USDCx bridging using the current quote, execute, wait, resume, and complete lifecycle. Align example runners with network-loaded Aleo accounts, optional edge API-key authentication, and explicit preview/execution controls.

Add native USDC CCTP V2 routes from Ethereum, Base, and Arbitrum to Arc, with Fast/Standard fees, forwarding, and checkpoint recovery. Exhaustive protocol and result switches must handle `cctp` and `evm-cctp`. Add SDK-only Ethereum → Arc → Aleo and Arc → Aleo mainnet tests.

Use Circle’s version-0 forwarding frame for new CCTP burns, verified with Ethereum-to-Arc mainnet delivery. Preserve recovery of already-submitted version-1 burns.
