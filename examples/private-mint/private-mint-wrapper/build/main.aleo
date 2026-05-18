import merkle_tree.aleo;
import test_usdcx_multisig_core.aleo;
import test_usdcx_freezelist.aleo;
import test_usdcx_stablecoin.aleo;
import test_usdcx_bridge.aleo;
program bridge_demo_v1.aleo;

closure get_amount_from_bytes:
    input r0 as [u8; 16u32];
    cast r0[0u32] into r1 as u128;
    mul r1 1329227995784915872903807060280344576u128 into r2;
    add 0u128 r2 into r3;
    cast r0[1u32] into r4 as u128;
    mul r4 5192296858534827628530496329220096u128 into r5;
    add r3 r5 into r6;
    cast r0[2u32] into r7 as u128;
    mul r7 20282409603651670423947251286016u128 into r8;
    add r6 r8 into r9;
    cast r0[3u32] into r10 as u128;
    mul r10 79228162514264337593543950336u128 into r11;
    add r9 r11 into r12;
    cast r0[4u32] into r13 as u128;
    mul r13 309485009821345068724781056u128 into r14;
    add r12 r14 into r15;
    cast r0[5u32] into r16 as u128;
    mul r16 1208925819614629174706176u128 into r17;
    add r15 r17 into r18;
    cast r0[6u32] into r19 as u128;
    mul r19 4722366482869645213696u128 into r20;
    add r18 r20 into r21;
    cast r0[7u32] into r22 as u128;
    mul r22 18446744073709551616u128 into r23;
    add r21 r23 into r24;
    cast r0[8u32] into r25 as u128;
    mul r25 72057594037927936u128 into r26;
    add r24 r26 into r27;
    cast r0[9u32] into r28 as u128;
    mul r28 281474976710656u128 into r29;
    add r27 r29 into r30;
    cast r0[10u32] into r31 as u128;
    mul r31 1099511627776u128 into r32;
    add r30 r32 into r33;
    cast r0[11u32] into r34 as u128;
    mul r34 4294967296u128 into r35;
    add r33 r35 into r36;
    cast r0[12u32] into r37 as u128;
    mul r37 16777216u128 into r38;
    add r36 r38 into r39;
    cast r0[13u32] into r40 as u128;
    mul r40 65536u128 into r41;
    add r39 r41 into r42;
    cast r0[14u32] into r43 as u128;
    mul r43 256u128 into r44;
    add r42 r44 into r45;
    cast r0[15u32] into r46 as u128;
    mul r46 1u128 into r47;
    add r45 r47 into r48;
    output r48 as u128;

function mint_and_send_private:
    input r0 as [u8; 240u32].private;
    input r1 as [u8; 65u32].private;
    input r2 as [u8; 32u32].private;
    input r3 as [u8; 32u32].private;
    cast r0[24u32] r0[25u32] r0[26u32] r0[27u32] r0[28u32] r0[29u32] r0[30u32] r0[31u32] r0[32u32] r0[33u32] r0[34u32] r0[35u32] r0[36u32] r0[37u32] r0[38u32] r0[39u32] into r4 as [u8; 16u32];
    call get_amount_from_bytes r4 into r5;
    call test_usdcx_bridge.aleo/mint_public r0 r1 r2 r3 into r6;
    call test_usdcx_stablecoin.aleo/transfer_public_to_private self.signer r5 into r7 r8 r9;
    async mint_and_send_private r6 r9 into r10;
    output r8 as test_usdcx_stablecoin.aleo/Token.record;
    output r10 as bridge_demo_v1.aleo/mint_and_send_private.future;

finalize mint_and_send_private:
    input r0 as test_usdcx_bridge.aleo/mint_public.future;
    input r1 as test_usdcx_stablecoin.aleo/transfer_public_to_private.future;
    await r0;
    await r1;

function mint_and_send_public:
    input r0 as [u8; 240u32].private;
    input r1 as [u8; 65u32].private;
    input r2 as [u8; 32u32].private;
    input r3 as [u8; 32u32].private;
    assert.eq self.caller aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px;
    cast r0[24u32] r0[25u32] r0[26u32] r0[27u32] r0[28u32] r0[29u32] r0[30u32] r0[31u32] r0[32u32] r0[33u32] r0[34u32] r0[35u32] r0[36u32] r0[37u32] r0[38u32] r0[39u32] into r4 as [u8; 16u32];
    call get_amount_from_bytes r4 into r5;
    call test_usdcx_bridge.aleo/mint_public r0 r1 r2 r3 into r6;
    call test_usdcx_stablecoin.aleo/transfer_public self.signer r5 into r7;
    async mint_and_send_public r6 r7 into r8;
    output r8 as bridge_demo_v1.aleo/mint_and_send_public.future;

finalize mint_and_send_public:
    input r0 as test_usdcx_bridge.aleo/mint_public.future;
    input r1 as test_usdcx_stablecoin.aleo/transfer_public.future;
    await r0;
    await r1;

function deposit_public_usdcx_to_vault:
    input r0 as u128.private;
    call test_usdcx_stablecoin.aleo/transfer_public_as_signer bridge_demo_v1.aleo r0 into r1;
    async deposit_public_usdcx_to_vault r1 into r2;
    output r2 as bridge_demo_v1.aleo/deposit_public_usdcx_to_vault.future;

finalize deposit_public_usdcx_to_vault:
    input r0 as test_usdcx_stablecoin.aleo/transfer_public_as_signer.future;
    await r0;

function deposit_private_usdcx_to_vault:
    input r0 as u128.private;
    input r1 as test_usdcx_stablecoin.aleo/Token.record;
    input r2 as [test_usdcx_stablecoin.aleo/MerkleProof; 2u32].private;
    call test_usdcx_stablecoin.aleo/transfer_private_to_public bridge_demo_v1.aleo r0 r1 r2 into r3 r4 r5;
    async deposit_private_usdcx_to_vault r5 into r6;
    output r6 as bridge_demo_v1.aleo/deposit_private_usdcx_to_vault.future;

finalize deposit_private_usdcx_to_vault:
    input r0 as test_usdcx_stablecoin.aleo/transfer_private_to_public.future;
    await r0;

function withdraw_from_vault_public:
    input r0 as u128.private;
    call test_usdcx_stablecoin.aleo/transfer_public self.signer r0 into r1;
    async withdraw_from_vault_public r1 into r2;
    output r2 as bridge_demo_v1.aleo/withdraw_from_vault_public.future;

finalize withdraw_from_vault_public:
    input r0 as test_usdcx_stablecoin.aleo/transfer_public.future;
    await r0;

function withdraw_from_vault_private:
    input r0 as u128.private;
    input r1 as address.private;
    call test_usdcx_stablecoin.aleo/transfer_public_to_private self.signer r0 into r2 r3 r4;
    async withdraw_from_vault_private r4 into r5;
    output r5 as bridge_demo_v1.aleo/withdraw_from_vault_private.future;

finalize withdraw_from_vault_private:
    input r0 as test_usdcx_stablecoin.aleo/transfer_public_to_private.future;
    await r0;

function burn_private:
    input r0 as test_usdcx_stablecoin.aleo/Token.record;
    input r1 as u128.private;
    input r2 as [test_usdcx_stablecoin.aleo/MerkleProof; 2u32].private;
    call test_usdcx_stablecoin.aleo/transfer_private_to_public bridge_demo_v1.aleo r1 r0 r2 into r3 r4 r5;
    cast 0u8 0u8 0u8 0u8 0u8 0u8 0u8 0u8 0u8 0u8 0u8 0u8 30u8 25u8 109u8 10u8 125u8 129u8 137u8 5u8 76u8 77u8 183u8 68u8 171u8 51u8 64u8 195u8 241u8 198u8 139u8 25u8 into r6 as [u8; 32u32];
    call test_usdcx_bridge.aleo/burn_public r1 1002u32 r6 into r7;
    async burn_private r5 r7 into r8;
    output r8 as bridge_demo_v1.aleo/burn_private.future;

finalize burn_private:
    input r0 as test_usdcx_stablecoin.aleo/transfer_private_to_public.future;
    input r1 as test_usdcx_bridge.aleo/burn_public.future;
    await r0;
    await r1;

constructor:
    gt edition 0u16 into r0;
    branch.eq r0 false to end_then_0_0;
    assert.eq program_owner aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px;
    branch.eq true true to end_otherwise_0_1;
    position end_then_0_0;
    position end_otherwise_0_1;
