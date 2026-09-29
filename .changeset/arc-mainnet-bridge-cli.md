---
"@provablehq/aleo-bridge-sdk": minor
"@provablehq/aleo-bridge-cli": minor
---

Add Arc mainnet USDC-to-USDCx bridging and a standalone bridge CLI using the current quote, execute, wait, resume, and complete lifecycle. Align example runners with network-loaded Aleo accounts, optional edge API-key authentication, and explicit preview/execution controls.

Add native USDC CCTP V2 routes from Ethereum, Base, and Arbitrum to Arc, with Fast/Standard fees, forwarding, and checkpoint recovery. Exhaustive protocol and result switches must handle `cctp` and `evm-cctp`. Add SDK-only Ethereum → Arc → Aleo and Arc → Aleo mainnet tests.
