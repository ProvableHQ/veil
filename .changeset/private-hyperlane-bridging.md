---
'@provablehq/aleo-bridge-sdk': minor
---

Add private inbound Hyperlane minting through recipient address commitments and
private outbound token transfers with explicit fee quotes, compliance proofs,
and reviewed deployment metadata. Add claimable-balance discovery, checkpoints,
and recovery that retain encrypted claim transactions for rebroadcast until
acceptance or rejection. Reject reused encodings before new deposits and keep
automatic dispatch funding distinct from a private execution-fee record.

Include a testnet ETH mint, claim, withdrawal, and recovery example. Existing
public Hyperlane routes and the default registry remain unchanged.
