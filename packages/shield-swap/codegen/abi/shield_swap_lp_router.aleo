import shield_swap.aleo;
import shield_swap_freezelist.aleo;
import shield_swap_multisig_core.aleo;

program shield_swap_lp_router.aleo;

struct U256__8JquwLopp8:
    hi as u128;
    lo as u128;

struct MerkleProof:
    siblings as [field; 16u32];
    leaf_index as u32;

struct ChecksumEdition:
    checksum as [u8; 32u32];
    edition as u16;

function mint_from_wrapped_arc20:
    input r0 as field.private;
    input r1 as dynamic.record;
    input r2 as [MerkleProof; 2u32].private;
    input r3 as dynamic.record;
    input r4 as address.private;
    input r5 as address.private;
    input r6 as shield_swap.aleo/MintPositionRequest.public;
    input r7 as field.public;
    input r8 as field.public;
    input r9 as [shield_swap.aleo/MerkleProof; 2u32].private;
    input r10 as [shield_swap.aleo/MerkleProof; 2u32].private;
    input r11 as [shield_swap.aleo/MerkleProof; 2u32].private;
    call.dynamic r7 'aleo' 'deposit_private' with r1 r6.amount0_desired r2 (as dynamic.record u128.public [MerkleProof; 2u32].private) into r12 r13 r14 (as dynamic.record dynamic.record dynamic.future);
    call shield_swap.aleo/mint r0 r13 r3 r4 r5 r6 r7 r8 r9 r10 r11 into r15 r16 r17 r18 r19 r20;
    call.dynamic r7 'aleo' 'burn_empty_record' with r17 (as dynamic.record);
    async mint_from_wrapped_arc20 r7 r8 r14 r20 into r21;
    output r12 as dynamic.record;
    output r15 as field.public;
    output r16 as shield_swap.aleo/PositionNFT.record;
    output r18 as dynamic.record;
    output r19 as shield_swap.aleo/MintComplianceRecord.record;
    output r21 as shield_swap_lp_router.aleo/mint_from_wrapped_arc20.future;

finalize mint_from_wrapped_arc20:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as dynamic.future;
    input r3 as shield_swap.aleo/mint.future;
    contains shield_swap.aleo/from_wrapper_token_id[r0] into r4;
    assert.eq r4 true;
    contains shield_swap.aleo/from_wrapper_token_id[r1] into r5;
    not r5 into r6;
    assert.eq r6 true;
    await r2;
    await r3;

function mint_from_arc20_wrapped:
    input r0 as field.private;
    input r1 as dynamic.record;
    input r2 as dynamic.record;
    input r3 as [MerkleProof; 2u32].private;
    input r4 as address.private;
    input r5 as address.private;
    input r6 as shield_swap.aleo/MintPositionRequest.public;
    input r7 as field.public;
    input r8 as field.public;
    input r9 as [shield_swap.aleo/MerkleProof; 2u32].private;
    input r10 as [shield_swap.aleo/MerkleProof; 2u32].private;
    input r11 as [shield_swap.aleo/MerkleProof; 2u32].private;
    call.dynamic r8 'aleo' 'deposit_private' with r2 r6.amount1_desired r3 (as dynamic.record u128.public [MerkleProof; 2u32].private) into r12 r13 r14 (as dynamic.record dynamic.record dynamic.future);
    call shield_swap.aleo/mint r0 r1 r13 r4 r5 r6 r7 r8 r9 r10 r11 into r15 r16 r17 r18 r19 r20;
    call.dynamic r8 'aleo' 'burn_empty_record' with r18 (as dynamic.record);
    async mint_from_arc20_wrapped r7 r8 r14 r20 into r21;
    output r12 as dynamic.record;
    output r15 as field.public;
    output r16 as shield_swap.aleo/PositionNFT.record;
    output r17 as dynamic.record;
    output r19 as shield_swap.aleo/MintComplianceRecord.record;
    output r21 as shield_swap_lp_router.aleo/mint_from_arc20_wrapped.future;

finalize mint_from_arc20_wrapped:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as dynamic.future;
    input r3 as shield_swap.aleo/mint.future;
    contains shield_swap.aleo/from_wrapper_token_id[r0] into r4;
    not r4 into r5;
    assert.eq r5 true;
    contains shield_swap.aleo/from_wrapper_token_id[r1] into r6;
    assert.eq r6 true;
    await r2;
    await r3;

function mint_from_wrapped_wrapped:
    input r0 as field.private;
    input r1 as dynamic.record;
    input r2 as [MerkleProof; 2u32].private;
    input r3 as dynamic.record;
    input r4 as [MerkleProof; 2u32].private;
    input r5 as address.private;
    input r6 as address.private;
    input r7 as shield_swap.aleo/MintPositionRequest.public;
    input r8 as field.public;
    input r9 as field.public;
    input r10 as [shield_swap.aleo/MerkleProof; 2u32].private;
    input r11 as [shield_swap.aleo/MerkleProof; 2u32].private;
    input r12 as [shield_swap.aleo/MerkleProof; 2u32].private;
    call.dynamic r8 'aleo' 'deposit_private' with r1 r7.amount0_desired r2 (as dynamic.record u128.public [MerkleProof; 2u32].private) into r13 r14 r15 (as dynamic.record dynamic.record dynamic.future);
    call.dynamic r9 'aleo' 'deposit_private' with r3 r7.amount1_desired r4 (as dynamic.record u128.public [MerkleProof; 2u32].private) into r16 r17 r18 (as dynamic.record dynamic.record dynamic.future);
    call shield_swap.aleo/mint r0 r14 r17 r5 r6 r7 r8 r9 r10 r11 r12 into r19 r20 r21 r22 r23 r24;
    call.dynamic r8 'aleo' 'burn_empty_record' with r21 (as dynamic.record);
    call.dynamic r9 'aleo' 'burn_empty_record' with r22 (as dynamic.record);
    async mint_from_wrapped_wrapped r8 r9 r15 r18 r24 into r25;
    output r13 as dynamic.record;
    output r16 as dynamic.record;
    output r19 as field.public;
    output r20 as shield_swap.aleo/PositionNFT.record;
    output r23 as shield_swap.aleo/MintComplianceRecord.record;
    output r25 as shield_swap_lp_router.aleo/mint_from_wrapped_wrapped.future;

finalize mint_from_wrapped_wrapped:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as dynamic.future;
    input r3 as dynamic.future;
    input r4 as shield_swap.aleo/mint.future;
    contains shield_swap.aleo/from_wrapper_token_id[r0] into r5;
    assert.eq r5 true;
    contains shield_swap.aleo/from_wrapper_token_id[r1] into r6;
    assert.eq r6 true;
    await r2;
    await r3;
    await r4;

function increase_from_wrapped_arc20:
    input r0 as shield_swap.aleo/PositionNFT.record;
    input r1 as dynamic.record;
    input r2 as [MerkleProof; 2u32].private;
    input r3 as dynamic.record;
    input r4 as u128.public;
    input r5 as u128.public;
    input r6 as u128.public;
    input r7 as u128.public;
    input r8 as field.public;
    input r9 as field.public;
    input r10 as i32.public;
    input r11 as i32.public;
    call.dynamic r8 'aleo' 'deposit_private' with r1 r4 r2 (as dynamic.record u128.public [MerkleProof; 2u32].private) into r12 r13 r14 (as dynamic.record dynamic.record dynamic.future);
    call shield_swap.aleo/increase_liquidity r0 r13 r3 r4 r5 r6 r7 r8 r9 r10 r11 into r15 r16 r17 r18 r19;
    call.dynamic r8 'aleo' 'burn_empty_record' with r17 (as dynamic.record);
    async increase_from_wrapped_arc20 r8 r9 r14 r19 into r20;
    output r12 as dynamic.record;
    output r15 as field.public;
    output r16 as shield_swap.aleo/PositionNFT.record;
    output r18 as dynamic.record;
    output r20 as shield_swap_lp_router.aleo/increase_from_wrapped_arc20.future;

finalize increase_from_wrapped_arc20:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as dynamic.future;
    input r3 as shield_swap.aleo/increase_liquidity.future;
    contains shield_swap.aleo/from_wrapper_token_id[r0] into r4;
    assert.eq r4 true;
    contains shield_swap.aleo/from_wrapper_token_id[r1] into r5;
    not r5 into r6;
    assert.eq r6 true;
    await r2;
    await r3;

function increase_from_arc20_wrapped:
    input r0 as shield_swap.aleo/PositionNFT.record;
    input r1 as dynamic.record;
    input r2 as dynamic.record;
    input r3 as [MerkleProof; 2u32].private;
    input r4 as u128.public;
    input r5 as u128.public;
    input r6 as u128.public;
    input r7 as u128.public;
    input r8 as field.public;
    input r9 as field.public;
    input r10 as i32.public;
    input r11 as i32.public;
    call.dynamic r9 'aleo' 'deposit_private' with r2 r5 r3 (as dynamic.record u128.public [MerkleProof; 2u32].private) into r12 r13 r14 (as dynamic.record dynamic.record dynamic.future);
    call shield_swap.aleo/increase_liquidity r0 r1 r13 r4 r5 r6 r7 r8 r9 r10 r11 into r15 r16 r17 r18 r19;
    call.dynamic r9 'aleo' 'burn_empty_record' with r18 (as dynamic.record);
    async increase_from_arc20_wrapped r8 r9 r14 r19 into r20;
    output r12 as dynamic.record;
    output r15 as field.public;
    output r16 as shield_swap.aleo/PositionNFT.record;
    output r17 as dynamic.record;
    output r20 as shield_swap_lp_router.aleo/increase_from_arc20_wrapped.future;

finalize increase_from_arc20_wrapped:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as dynamic.future;
    input r3 as shield_swap.aleo/increase_liquidity.future;
    contains shield_swap.aleo/from_wrapper_token_id[r0] into r4;
    not r4 into r5;
    assert.eq r5 true;
    contains shield_swap.aleo/from_wrapper_token_id[r1] into r6;
    assert.eq r6 true;
    await r2;
    await r3;

function increase_from_wrapped_wrapped:
    input r0 as shield_swap.aleo/PositionNFT.record;
    input r1 as dynamic.record;
    input r2 as [MerkleProof; 2u32].private;
    input r3 as dynamic.record;
    input r4 as [MerkleProof; 2u32].private;
    input r5 as u128.public;
    input r6 as u128.public;
    input r7 as u128.public;
    input r8 as u128.public;
    input r9 as field.public;
    input r10 as field.public;
    input r11 as i32.public;
    input r12 as i32.public;
    call.dynamic r9 'aleo' 'deposit_private' with r1 r5 r2 (as dynamic.record u128.public [MerkleProof; 2u32].private) into r13 r14 r15 (as dynamic.record dynamic.record dynamic.future);
    call.dynamic r10 'aleo' 'deposit_private' with r3 r6 r4 (as dynamic.record u128.public [MerkleProof; 2u32].private) into r16 r17 r18 (as dynamic.record dynamic.record dynamic.future);
    call shield_swap.aleo/increase_liquidity r0 r14 r17 r5 r6 r7 r8 r9 r10 r11 r12 into r19 r20 r21 r22 r23;
    call.dynamic r9 'aleo' 'burn_empty_record' with r21 (as dynamic.record);
    call.dynamic r10 'aleo' 'burn_empty_record' with r22 (as dynamic.record);
    async increase_from_wrapped_wrapped r9 r10 r15 r18 r23 into r24;
    output r13 as dynamic.record;
    output r16 as dynamic.record;
    output r19 as field.public;
    output r20 as shield_swap.aleo/PositionNFT.record;
    output r24 as shield_swap_lp_router.aleo/increase_from_wrapped_wrapped.future;

finalize increase_from_wrapped_wrapped:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as dynamic.future;
    input r3 as dynamic.future;
    input r4 as shield_swap.aleo/increase_liquidity.future;
    contains shield_swap.aleo/from_wrapper_token_id[r0] into r5;
    assert.eq r5 true;
    contains shield_swap.aleo/from_wrapper_token_id[r1] into r6;
    assert.eq r6 true;
    await r2;
    await r3;
    await r4;

function collect_to_wrapped_arc20:
    input r0 as shield_swap.aleo/PositionNFT.record;
    input r1 as u128.public;
    input r2 as u128.public;
    input r3 as field.public;
    input r4 as field.public;
    input r5 as [shield_swap.aleo/MerkleProof; 2u32].private;
    input r6 as [shield_swap.aleo/MerkleProof; 2u32].private;
    input r7 as [MerkleProof; 2u32].private;
    call shield_swap.aleo/collect r0 r1 r2 r3 r4 r5 r6 into r8 r9 r10 r11;
    call.dynamic r3 'aleo' 'withdraw_private' with r9 r1 r0.withdrawal r7 (as dynamic.record u128.public address.private [MerkleProof; 2u32].private) into r12 r13 (as dynamic.record dynamic.future);
    async collect_to_wrapped_arc20 r3 r4 r11 r13 into r14;
    output r8 as shield_swap.aleo/PositionNFT.record;
    output r12 as dynamic.record;
    output r10 as dynamic.record;
    output r14 as shield_swap_lp_router.aleo/collect_to_wrapped_arc20.future;

finalize collect_to_wrapped_arc20:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as shield_swap.aleo/collect.future;
    input r3 as dynamic.future;
    contains shield_swap.aleo/from_wrapper_token_id[r0] into r4;
    assert.eq r4 true;
    contains shield_swap.aleo/from_wrapper_token_id[r1] into r5;
    not r5 into r6;
    assert.eq r6 true;
    await r2;
    await r3;

function collect_to_arc20_wrapped:
    input r0 as shield_swap.aleo/PositionNFT.record;
    input r1 as u128.public;
    input r2 as u128.public;
    input r3 as field.public;
    input r4 as field.public;
    input r5 as [shield_swap.aleo/MerkleProof; 2u32].private;
    input r6 as [shield_swap.aleo/MerkleProof; 2u32].private;
    input r7 as [MerkleProof; 2u32].private;
    call shield_swap.aleo/collect r0 r1 r2 r3 r4 r5 r6 into r8 r9 r10 r11;
    call.dynamic r4 'aleo' 'withdraw_private' with r10 r2 r0.withdrawal r7 (as dynamic.record u128.public address.private [MerkleProof; 2u32].private) into r12 r13 (as dynamic.record dynamic.future);
    async collect_to_arc20_wrapped r3 r4 r11 r13 into r14;
    output r8 as shield_swap.aleo/PositionNFT.record;
    output r9 as dynamic.record;
    output r12 as dynamic.record;
    output r14 as shield_swap_lp_router.aleo/collect_to_arc20_wrapped.future;

finalize collect_to_arc20_wrapped:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as shield_swap.aleo/collect.future;
    input r3 as dynamic.future;
    contains shield_swap.aleo/from_wrapper_token_id[r0] into r4;
    not r4 into r5;
    assert.eq r5 true;
    contains shield_swap.aleo/from_wrapper_token_id[r1] into r6;
    assert.eq r6 true;
    await r2;
    await r3;

function collect_to_wrapped_wrapped:
    input r0 as shield_swap.aleo/PositionNFT.record;
    input r1 as u128.public;
    input r2 as u128.public;
    input r3 as field.public;
    input r4 as field.public;
    input r5 as [shield_swap.aleo/MerkleProof; 2u32].private;
    input r6 as [shield_swap.aleo/MerkleProof; 2u32].private;
    input r7 as [MerkleProof; 2u32].private;
    input r8 as [MerkleProof; 2u32].private;
    call shield_swap.aleo/collect r0 r1 r2 r3 r4 r5 r6 into r9 r10 r11 r12;
    call.dynamic r3 'aleo' 'withdraw_private' with r10 r1 r0.withdrawal r7 (as dynamic.record u128.public address.private [MerkleProof; 2u32].private) into r13 r14 (as dynamic.record dynamic.future);
    call.dynamic r4 'aleo' 'withdraw_private' with r11 r2 r0.withdrawal r8 (as dynamic.record u128.public address.private [MerkleProof; 2u32].private) into r15 r16 (as dynamic.record dynamic.future);
    async collect_to_wrapped_wrapped r3 r4 r12 r14 r16 into r17;
    output r9 as shield_swap.aleo/PositionNFT.record;
    output r13 as dynamic.record;
    output r15 as dynamic.record;
    output r17 as shield_swap_lp_router.aleo/collect_to_wrapped_wrapped.future;

finalize collect_to_wrapped_wrapped:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as shield_swap.aleo/collect.future;
    input r3 as dynamic.future;
    input r4 as dynamic.future;
    contains shield_swap.aleo/from_wrapper_token_id[r0] into r5;
    assert.eq r5 true;
    contains shield_swap.aleo/from_wrapper_token_id[r1] into r6;
    assert.eq r6 true;
    await r2;
    await r3;
    await r4;

function collect_protocol_wrapped:
    input r0 as field.public;
    input r1 as u128.public;
    input r2 as u128.public;
    input r3 as field.public;
    input r4 as field.public;
    input r5 as boolean.public;
    ternary r5 r3 r4 into r6;
    ternary r5 r1 r2 into r7;
    call shield_swap.aleo/collect_protocol r0 r1 r2 r3 r4 self.signer into r8;
    call.dynamic r6 'aleo' 'withdraw_public_as_signer' with r7 (as u128.public) into r9 (as dynamic.future);
    async collect_protocol_wrapped r5 r3 r4 r8 r9 into r10;
    output r10 as shield_swap_lp_router.aleo/collect_protocol_wrapped.future;

finalize collect_protocol_wrapped:
    input r0 as boolean.public;
    input r1 as field.public;
    input r2 as field.public;
    input r3 as shield_swap.aleo/collect_protocol.future;
    input r4 as dynamic.future;
    branch.eq r0 false to end_then_0_0;
    contains shield_swap.aleo/from_wrapper_token_id[r1] into r5;
    assert.eq r5 true;
    contains shield_swap.aleo/from_wrapper_token_id[r2] into r6;
    not r6 into r7;
    assert.eq r7 true;
    branch.eq true true to end_otherwise_0_1;
    position end_then_0_0;
    contains shield_swap.aleo/from_wrapper_token_id[r1] into r8;
    not r8 into r9;
    assert.eq r9 true;
    contains shield_swap.aleo/from_wrapper_token_id[r2] into r10;
    assert.eq r10 true;
    position end_otherwise_0_1;
    await r3;
    await r4;

function collect_protocol_both_wrapped:
    input r0 as field.public;
    input r1 as u128.public;
    input r2 as u128.public;
    input r3 as field.public;
    input r4 as field.public;
    call shield_swap.aleo/collect_protocol r0 r1 r2 r3 r4 self.signer into r5;
    call.dynamic r3 'aleo' 'withdraw_public_as_signer' with r1 (as u128.public) into r6 (as dynamic.future);
    call.dynamic r4 'aleo' 'withdraw_public_as_signer' with r2 (as u128.public) into r7 (as dynamic.future);
    async collect_protocol_both_wrapped r3 r4 r5 r6 r7 into r8;
    output r8 as shield_swap_lp_router.aleo/collect_protocol_both_wrapped.future;

finalize collect_protocol_both_wrapped:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as shield_swap.aleo/collect_protocol.future;
    input r3 as dynamic.future;
    input r4 as dynamic.future;
    contains shield_swap.aleo/from_wrapper_token_id[r0] into r5;
    assert.eq r5 true;
    contains shield_swap.aleo/from_wrapper_token_id[r1] into r6;
    assert.eq r6 true;
    await r2;
    await r3;
    await r4;

constructor:
    gt edition 0u16 into r0;
    branch.eq r0 false to end_then_0_0;
    cast checksum edition into r1 as ChecksumEdition;
    hash.bhp256 r1 into r2 as field;
    cast shield_swap_lp_router.aleo r2 into r3 as shield_swap_multisig_core.aleo/WalletSigningOpId;
    hash.bhp256 r3 into r4 as field;
    contains shield_swap_multisig_core.aleo/completed_signing_ops[r4] into r5;
    assert.eq r5 true;
    branch.eq true true to end_otherwise_0_1;
    position end_then_0_0;
    position end_otherwise_0_1;

