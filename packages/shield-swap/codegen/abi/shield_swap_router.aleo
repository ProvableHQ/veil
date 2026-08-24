import shield_swap.aleo;
import shield_swap_freezelist.aleo;
import shield_swap_multisig_core.aleo;

program shield_swap_router.aleo;

struct U256__8JquwLopp8:
    hi as u128;
    lo as u128;

struct MerkleProof:
    siblings as [field; 16u32];
    leaf_index as u32;

struct ChecksumEdition:
    checksum as [u8; 32u32];
    edition as u16;

function swap_from_wrapped:
    input r0 as dynamic.record;
    input r1 as [MerkleProof; 2u32].private;
    input r2 as field.private;
    input r3 as address.public;
    input r4 as field.public;
    input r5 as boolean.public;
    input r6 as u128.public;
    input r7 as u128.public;
    input r8 as U256__8JquwLopp8.public;
    input r9 as u64.public;
    input r10 as u32.public;
    input r11 as field.public;
    input r12 as field.public;
    gt r7 0u128 into r13;
    assert.eq r13 true;
    ternary r5 r11 r12 into r14;
    call.dynamic r14 'aleo' 'deposit_private' with r0 r6 r1 (as dynamic.record u128.public [MerkleProof; 2u32].private) into r15 r16 r17 (as dynamic.record dynamic.record dynamic.future);
    call shield_swap.aleo/swap r16 r2 r3 r4 r5 r6 r7 r8 r9 r10 r11 r12 into r18 r19 r20 r21;
    call.dynamic r14 'aleo' 'burn_empty_record' with r19 (as dynamic.record);
    async swap_from_wrapped r14 r17 r21 into r22;
    output r15 as dynamic.record;
    output r18 as field.public;
    output r20 as shield_swap.aleo/SwapComplianceRecord.record;
    output r22 as shield_swap_router.aleo/swap_from_wrapped.future;

finalize swap_from_wrapped:
    input r0 as field.public;
    input r1 as dynamic.future;
    input r2 as shield_swap.aleo/swap.future;
    contains shield_swap.aleo/from_wrapper_token_id[r0] into r3;
    assert.eq r3 true;
    await r1;
    await r2;

function swap_mh_from_wrapped:
    input r0 as dynamic.record;
    input r1 as [MerkleProof; 2u32].private;
    input r2 as field.private;
    input r3 as address.public;
    input r4 as field.public;
    input r5 as field.public;
    input r6 as u128.public;
    input r7 as u128.public;
    input r8 as shield_swap.aleo/SwapHop.public;
    input r9 as shield_swap.aleo/SwapHop.public;
    input r10 as shield_swap.aleo/SwapHop.public;
    input r11 as u8.public;
    input r12 as u64.public;
    input r13 as u32.public;
    gt r7 0u128 into r14;
    assert.eq r14 true;
    call.dynamic r4 'aleo' 'deposit_private' with r0 r6 r1 (as dynamic.record u128.public [MerkleProof; 2u32].private) into r15 r16 r17 (as dynamic.record dynamic.record dynamic.future);
    call shield_swap.aleo/swap_multi_hop r2 r3 r16 r4 r5 r6 r7 r8 r9 r10 r11 r12 r13 into r18 r19 r20 r21;
    call.dynamic r4 'aleo' 'burn_empty_record' with r19 (as dynamic.record);
    async swap_mh_from_wrapped r4 r17 r21 into r22;
    output r15 as dynamic.record;
    output r18 as field.public;
    output r20 as shield_swap.aleo/MultiHopSwapComplianceRecord.record;
    output r22 as shield_swap_router.aleo/swap_mh_from_wrapped.future;

finalize swap_mh_from_wrapped:
    input r0 as field.public;
    input r1 as dynamic.future;
    input r2 as shield_swap.aleo/swap_multi_hop.future;
    contains shield_swap.aleo/from_wrapper_token_id[r0] into r3;
    assert.eq r3 true;
    await r1;
    await r2;

function claim_to_arc20_no_refund:
    input r0 as field.private;
    input r1 as address.public;
    input r2 as field.public;
    input r3 as field.public;
    input r4 as field.public;
    input r5 as u128.public;
    input r6 as [shield_swap.aleo/MerkleProof; 2u32].private;
    call shield_swap.aleo/claim_swap_output_no_refund r0 r1 r2 r3 r4 r5 r6 into r7 r8;
    async claim_to_arc20_no_refund r3 r4 r8 into r9;
    output r7 as dynamic.record;
    output r9 as shield_swap_router.aleo/claim_to_arc20_no_refund.future;

finalize claim_to_arc20_no_refund:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as shield_swap.aleo/claim_swap_output_no_refund.future;
    contains shield_swap.aleo/from_wrapper_token_id[r0] into r3;
    assert.eq r3 true;
    contains shield_swap.aleo/from_wrapper_token_id[r1] into r4;
    not r4 into r5;
    assert.eq r5 true;
    await r2;

function claim_to_wrapped_no_refund:
    input r0 as field.private;
    input r1 as address.public;
    input r2 as field.public;
    input r3 as field.public;
    input r4 as field.public;
    input r5 as u128.public;
    input r6 as [shield_swap.aleo/MerkleProof; 2u32].private;
    input r7 as [MerkleProof; 2u32].private;
    call shield_swap.aleo/claim_swap_output_no_refund r0 r1 r2 r3 r4 r5 r6 into r8 r9;
    call.dynamic r4 'aleo' 'withdraw_private' with r8 r5 self.signer r7 (as dynamic.record u128.public address.private [MerkleProof; 2u32].private) into r10 r11 (as dynamic.record dynamic.future);
    async claim_to_wrapped_no_refund r4 r9 r11 into r12;
    output r10 as dynamic.record;
    output r12 as shield_swap_router.aleo/claim_to_wrapped_no_refund.future;

finalize claim_to_wrapped_no_refund:
    input r0 as field.public;
    input r1 as shield_swap.aleo/claim_swap_output_no_refund.future;
    input r2 as dynamic.future;
    contains shield_swap.aleo/from_wrapper_token_id[r0] into r3;
    assert.eq r3 true;
    await r1;
    await r2;

function claim_to_wrapped_refund_arc20:
    input r0 as field.private;
    input r1 as address.public;
    input r2 as field.public;
    input r3 as field.public;
    input r4 as field.public;
    input r5 as u128.public;
    input r6 as u128.public;
    input r7 as [shield_swap.aleo/MerkleProof; 2u32].private;
    input r8 as [MerkleProof; 2u32].private;
    call shield_swap.aleo/claim_swap_output r0 r1 r2 r3 r4 r5 r6 r7 into r9 r10 r11;
    call.dynamic r4 'aleo' 'withdraw_private' with r9 r5 self.signer r8 (as dynamic.record u128.public address.private [MerkleProof; 2u32].private) into r12 r13 (as dynamic.record dynamic.future);
    async claim_to_wrapped_refund_arc20 r3 r4 r11 r13 into r14;
    output r12 as dynamic.record;
    output r10 as dynamic.record;
    output r14 as shield_swap_router.aleo/claim_to_wrapped_refund_arc20.future;

finalize claim_to_wrapped_refund_arc20:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as shield_swap.aleo/claim_swap_output.future;
    input r3 as dynamic.future;
    contains shield_swap.aleo/from_wrapper_token_id[r0] into r4;
    not r4 into r5;
    assert.eq r5 true;
    contains shield_swap.aleo/from_wrapper_token_id[r1] into r6;
    assert.eq r6 true;
    await r2;
    await r3;

function claim_to_arc20_refund_wrapped:
    input r0 as field.private;
    input r1 as address.public;
    input r2 as field.public;
    input r3 as field.public;
    input r4 as field.public;
    input r5 as u128.public;
    input r6 as u128.public;
    input r7 as [shield_swap.aleo/MerkleProof; 2u32].private;
    input r8 as [MerkleProof; 2u32].private;
    call shield_swap.aleo/claim_swap_output r0 r1 r2 r3 r4 r5 r6 r7 into r9 r10 r11;
    call.dynamic r3 'aleo' 'withdraw_private' with r10 r6 self.signer r8 (as dynamic.record u128.public address.private [MerkleProof; 2u32].private) into r12 r13 (as dynamic.record dynamic.future);
    async claim_to_arc20_refund_wrapped r3 r4 r11 r13 into r14;
    output r9 as dynamic.record;
    output r12 as dynamic.record;
    output r14 as shield_swap_router.aleo/claim_to_arc20_refund_wrapped.future;

finalize claim_to_arc20_refund_wrapped:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as shield_swap.aleo/claim_swap_output.future;
    input r3 as dynamic.future;
    contains shield_swap.aleo/from_wrapper_token_id[r0] into r4;
    assert.eq r4 true;
    contains shield_swap.aleo/from_wrapper_token_id[r1] into r5;
    not r5 into r6;
    assert.eq r6 true;
    await r2;
    await r3;

function claim_to_wrapped_refund_wrapped:
    input r0 as field.private;
    input r1 as address.public;
    input r2 as field.public;
    input r3 as field.public;
    input r4 as field.public;
    input r5 as u128.public;
    input r6 as u128.public;
    input r7 as [shield_swap.aleo/MerkleProof; 2u32].private;
    input r8 as [MerkleProof; 2u32].private;
    input r9 as [MerkleProof; 2u32].private;
    call shield_swap.aleo/claim_swap_output r0 r1 r2 r3 r4 r5 r6 r7 into r10 r11 r12;
    call.dynamic r4 'aleo' 'withdraw_private' with r10 r5 self.signer r8 (as dynamic.record u128.public address.private [MerkleProof; 2u32].private) into r13 r14 (as dynamic.record dynamic.future);
    call.dynamic r3 'aleo' 'withdraw_private' with r11 r6 self.signer r9 (as dynamic.record u128.public address.private [MerkleProof; 2u32].private) into r15 r16 (as dynamic.record dynamic.future);
    async claim_to_wrapped_refund_wrapped r3 r4 r12 r14 r16 into r17;
    output r13 as dynamic.record;
    output r15 as dynamic.record;
    output r17 as shield_swap_router.aleo/claim_to_wrapped_refund_wrapped.future;

finalize claim_to_wrapped_refund_wrapped:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as shield_swap.aleo/claim_swap_output.future;
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
    cast shield_swap_router.aleo r2 into r3 as shield_swap_multisig_core.aleo/WalletSigningOpId;
    hash.bhp256 r3 into r4 as field;
    contains shield_swap_multisig_core.aleo/completed_signing_ops[r4] into r5;
    assert.eq r5 true;
    branch.eq true true to end_otherwise_0_1;
    position end_then_0_0;
    position end_otherwise_0_1;

