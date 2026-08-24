import credits.aleo;
import shield_swap_multisig_core.aleo;

program shield_swap_arc20_credits.aleo;

record Token:
    owner as address.private;
    amount as u128.private;
    recipient_bound as boolean.private;
    bound_recipient as address.private;

struct ChecksumEdition:
    checksum as [u8; 32u32];
    edition as u16;

struct MerkleProof:
    siblings as [field; 16u32];
    leaf_index as u32;

struct TokenAllowance:
    account as address;
    spender as address;

struct Optional__6A9ZdhLQa8N:
    is_some as boolean;
    val as u128;

mapping balances:
    key as address.public;
    value as u128.public;

mapping allowances:
    key as field.public;
    value as u128.public;

mapping address_to_role:
    key as address.public;
    value as u16.public;

mapping token_supply__:
    key as boolean.public;
    value as u128.public;

function deposit_public_as_signer:
    input r0 as u128.public;
    is.eq self.caller aleo1waeghjttfvzrmk68ckpp4ftnfh7aq6wcm73qxzy0m754x4cu6yxqf38zsq into r1;
    is.eq self.caller aleo18sekmsl46y6skh3kvkekmw4kqqm7d6rz79akpsg58r7wpp5klyyq0qtzqf into r2;
    or r1 r2 into r3;
    assert.eq r3 true;
    cast r0 into r4 as u64;
    cast r4 into r5 as u128;
    assert.eq r5 r0;
    call credits.aleo/transfer_public_as_signer shield_swap_arc20_credits.aleo r4 into r6;
    async deposit_public_as_signer self.signer r0 r6 into r7;
    output r7 as shield_swap_arc20_credits.aleo/deposit_public_as_signer.future;

finalize deposit_public_as_signer:
    input r0 as address.public;
    input r1 as u128.public;
    input r2 as credits.aleo/transfer_public_as_signer.future;
    get.or_use balances[r0] 0u128 into r3;
    add r3 r1 into r4;
    set r4 into balances[r0];
    contains token_supply__[false] into r5;
    get.or_use token_supply__[false] 0u128 into r6;
    ternary r5 r6 0u128 into r7;
    cast r5 r7 into r8 as Optional__6A9ZdhLQa8N;
    ternary r8.is_some r8.val 0u128 into r9;
    add r9 r1 into r10;
    lte r10 340282366920938463463374607431768211455u128 into r11;
    assert.eq r11 true;
    set r10 into token_supply__[false];
    await r2;

function deposit_private:
    input r0 as credits.aleo/credits.record;
    input r1 as u128.public;
    input r2 as [MerkleProof; 2u32].private;
    is.eq self.caller aleo1waeghjttfvzrmk68ckpp4ftnfh7aq6wcm73qxzy0m754x4cu6yxqf38zsq into r3;
    is.eq self.caller aleo18sekmsl46y6skh3kvkekmw4kqqm7d6rz79akpsg58r7wpp5klyyq0qtzqf into r4;
    or r3 r4 into r5;
    assert.eq r5 true;
    cast r1 into r6 as u64;
    cast r6 into r7 as u128;
    assert.eq r7 r1;
    call credits.aleo/transfer_private_to_public r0 shield_swap_arc20_credits.aleo r6 into r8 r9;
    cast self.signer r1 false self.signer into r10 as Token.record;
    async deposit_private r1 r9 into r11;
    output r8 as credits.aleo/credits.record;
    output r10 as Token.record;
    output r11 as shield_swap_arc20_credits.aleo/deposit_private.future;

finalize deposit_private:
    input r0 as u128.public;
    input r1 as credits.aleo/transfer_private_to_public.future;
    contains token_supply__[false] into r2;
    get.or_use token_supply__[false] 0u128 into r3;
    ternary r2 r3 0u128 into r4;
    cast r2 r4 into r5 as Optional__6A9ZdhLQa8N;
    ternary r5.is_some r5.val 0u128 into r6;
    add r6 r0 into r7;
    lte r7 340282366920938463463374607431768211455u128 into r8;
    assert.eq r8 true;
    set r7 into token_supply__[false];
    await r1;

function withdraw_public:
    input r0 as u128.public;
    is.eq self.caller aleo1waeghjttfvzrmk68ckpp4ftnfh7aq6wcm73qxzy0m754x4cu6yxqf38zsq into r1;
    is.eq self.caller aleo18sekmsl46y6skh3kvkekmw4kqqm7d6rz79akpsg58r7wpp5klyyq0qtzqf into r2;
    or r1 r2 into r3;
    assert.eq r3 true;
    cast r0 into r4 as u64;
    cast r4 into r5 as u128;
    assert.eq r5 r0;
    call credits.aleo/transfer_public self.caller r4 into r6;
    async withdraw_public self.caller r0 r6 into r7;
    output r7 as shield_swap_arc20_credits.aleo/withdraw_public.future;

finalize withdraw_public:
    input r0 as address.public;
    input r1 as u128.public;
    input r2 as credits.aleo/transfer_public.future;
    get balances[r0] into r3;
    sub r3 r1 into r4;
    set r4 into balances[r0];
    contains token_supply__[false] into r5;
    get.or_use token_supply__[false] 0u128 into r6;
    ternary r5 r6 0u128 into r7;
    cast r5 r7 into r8 as Optional__6A9ZdhLQa8N;
    ternary r8.is_some r8.val 0u128 into r9;
    gte r9 r1 into r10;
    assert.eq r10 true;
    sub r9 r1 into r11;
    set r11 into token_supply__[false];
    await r2;

function withdraw_public_as_signer:
    input r0 as u128.public;
    is.eq self.caller aleo1waeghjttfvzrmk68ckpp4ftnfh7aq6wcm73qxzy0m754x4cu6yxqf38zsq into r1;
    is.eq self.caller aleo18sekmsl46y6skh3kvkekmw4kqqm7d6rz79akpsg58r7wpp5klyyq0qtzqf into r2;
    or r1 r2 into r3;
    assert.eq r3 true;
    cast r0 into r4 as u64;
    cast r4 into r5 as u128;
    assert.eq r5 r0;
    call credits.aleo/transfer_public self.signer r4 into r6;
    async withdraw_public_as_signer self.signer r0 r6 into r7;
    output r7 as shield_swap_arc20_credits.aleo/withdraw_public_as_signer.future;

finalize withdraw_public_as_signer:
    input r0 as address.public;
    input r1 as u128.public;
    input r2 as credits.aleo/transfer_public.future;
    get balances[r0] into r3;
    sub r3 r1 into r4;
    set r4 into balances[r0];
    contains token_supply__[false] into r5;
    get.or_use token_supply__[false] 0u128 into r6;
    ternary r5 r6 0u128 into r7;
    cast r5 r7 into r8 as Optional__6A9ZdhLQa8N;
    ternary r8.is_some r8.val 0u128 into r9;
    gte r9 r1 into r10;
    assert.eq r10 true;
    sub r9 r1 into r11;
    set r11 into token_supply__[false];
    await r2;

function withdraw_private:
    input r0 as Token.record;
    input r1 as u128.public;
    input r2 as address.private;
    input r3 as [MerkleProof; 2u32].private;
    is.eq self.caller aleo1waeghjttfvzrmk68ckpp4ftnfh7aq6wcm73qxzy0m754x4cu6yxqf38zsq into r4;
    is.eq self.caller aleo18sekmsl46y6skh3kvkekmw4kqqm7d6rz79akpsg58r7wpp5klyyq0qtzqf into r5;
    or r4 r5 into r6;
    assert.eq r6 true;
    cast r1 into r7 as u64;
    cast r7 into r8 as u128;
    assert.eq r8 r1;
    assert.eq r0.owner self.signer;
    assert.eq r0.amount r1;
    not r0.recipient_bound into r9;
    is.eq r0.bound_recipient r2 into r10;
    or r9 r10 into r11;
    assert.eq r11 true;
    call credits.aleo/transfer_public_to_private r2 r7 into r12 r13;
    async withdraw_private r1 r13 into r14;
    output r12 as credits.aleo/credits.record;
    output r14 as shield_swap_arc20_credits.aleo/withdraw_private.future;

finalize withdraw_private:
    input r0 as u128.public;
    input r1 as credits.aleo/transfer_public_to_private.future;
    contains token_supply__[false] into r2;
    get.or_use token_supply__[false] 0u128 into r3;
    ternary r2 r3 0u128 into r4;
    cast r2 r4 into r5 as Optional__6A9ZdhLQa8N;
    ternary r5.is_some r5.val 0u128 into r6;
    gte r6 r0 into r7;
    assert.eq r7 true;
    sub r6 r0 into r8;
    set r8 into token_supply__[false];
    await r1;

function burn_empty_record:
    input r0 as Token.record;
    assert.eq r0.owner self.signer;
    assert.eq r0.amount 0u128;

function transfer_public:
    input r0 as address.public;
    input r1 as u128.public;
    async transfer_public self.caller r1 r0 into r2;
    output r2 as shield_swap_arc20_credits.aleo/transfer_public.future;

finalize transfer_public:
    input r0 as address.public;
    input r1 as u128.public;
    input r2 as address.public;
    get balances[r0] into r3;
    sub r3 r1 into r4;
    set r4 into balances[r0];
    get.or_use balances[r2] 0u128 into r5;
    add r5 r1 into r6;
    set r6 into balances[r2];

function transfer_public_as_signer:
    input r0 as address.public;
    input r1 as u128.public;
    async transfer_public_as_signer self.signer r1 r0 into r2;
    output r2 as shield_swap_arc20_credits.aleo/transfer_public_as_signer.future;

finalize transfer_public_as_signer:
    input r0 as address.public;
    input r1 as u128.public;
    input r2 as address.public;
    get balances[r0] into r3;
    sub r3 r1 into r4;
    set r4 into balances[r0];
    get.or_use balances[r2] 0u128 into r5;
    add r5 r1 into r6;
    set r6 into balances[r2];

function transfer_public_to_private:
    input r0 as address.private;
    input r1 as u128.public;
    is.eq self.caller aleo1wha60jq3fw6j3spcdm88798f8s6a5pn57xa0j3yrnl86tflevvxs7jt2y7 into r2;
    is.neq r0 self.signer into r3;
    and r2 r3 into r4;
    ternary r4 self.signer r0 into r5;
    cast r5 r1 r4 r0 into r6 as Token.record;
    async transfer_public_to_private self.caller r1 into r7;
    output r6 as Token.record;
    output r7 as shield_swap_arc20_credits.aleo/transfer_public_to_private.future;

finalize transfer_public_to_private:
    input r0 as address.public;
    input r1 as u128.public;
    get balances[r0] into r2;
    sub r2 r1 into r3;
    set r3 into balances[r0];

function transfer_private:
    input r0 as Token.record;
    input r1 as address.private;
    input r2 as u128.private;
    assert.eq r0.owner self.signer;
    not r0.recipient_bound into r3;
    assert.eq r3 true;
    sub r0.amount r2 into r4;
    cast r0.owner r4 false r0.owner into r5 as Token.record;
    cast r1 r2 false r1 into r6 as Token.record;
    output r5 as Token.record;
    output r6 as Token.record;

function transfer_private_to_public:
    input r0 as Token.record;
    input r1 as address.public;
    input r2 as u128.public;
    assert.eq r0.owner self.signer;
    not r0.recipient_bound into r3;
    assert.eq r3 true;
    sub r0.amount r2 into r4;
    cast r0.owner r4 false r0.owner into r5 as Token.record;
    async transfer_private_to_public r1 r2 into r6;
    output r5 as Token.record;
    output r6 as shield_swap_arc20_credits.aleo/transfer_private_to_public.future;

finalize transfer_private_to_public:
    input r0 as address.public;
    input r1 as u128.public;
    get.or_use balances[r0] 0u128 into r2;
    add r2 r1 into r3;
    set r3 into balances[r0];

function approve_public:
    input r0 as address.public;
    input r1 as u128.public;
    cast self.caller r0 into r2 as TokenAllowance;
    hash.bhp256 r2 into r3 as field;
    async approve_public r3 r1 into r4;
    output r4 as shield_swap_arc20_credits.aleo/approve_public.future;

finalize approve_public:
    input r0 as field.public;
    input r1 as u128.public;
    get.or_use allowances[r0] 0u128 into r2;
    add r2 r1 into r3;
    set r3 into allowances[r0];

function unapprove_public:
    input r0 as address.public;
    input r1 as u128.public;
    cast self.caller r0 into r2 as TokenAllowance;
    hash.bhp256 r2 into r3 as field;
    async unapprove_public r3 r1 into r4;
    output r4 as shield_swap_arc20_credits.aleo/unapprove_public.future;

finalize unapprove_public:
    input r0 as field.public;
    input r1 as u128.public;
    get.or_use allowances[r0] 0u128 into r2;
    sub r2 r1 into r3;
    set r3 into allowances[r0];

function transfer_from_public:
    input r0 as address.public;
    input r1 as address.public;
    input r2 as u128.public;
    cast r0 self.caller into r3 as TokenAllowance;
    hash.bhp256 r3 into r4 as field;
    async transfer_from_public r4 r2 r0 r1 into r5;
    output r5 as shield_swap_arc20_credits.aleo/transfer_from_public.future;

finalize transfer_from_public:
    input r0 as field.public;
    input r1 as u128.public;
    input r2 as address.public;
    input r3 as address.public;
    get.or_use allowances[r0] 0u128 into r4;
    sub r4 r1 into r5;
    set r5 into allowances[r0];
    get balances[r2] into r6;
    sub r6 r1 into r7;
    set r7 into balances[r2];
    get.or_use balances[r3] 0u128 into r8;
    add r8 r1 into r9;
    set r9 into balances[r3];

function transfer_from_public_to_private:
    input r0 as address.public;
    input r1 as address.private;
    input r2 as u128.public;
    cast r0 self.caller into r3 as TokenAllowance;
    hash.bhp256 r3 into r4 as field;
    cast r1 r2 false r1 into r5 as Token.record;
    async transfer_from_public_to_private r4 r2 r0 into r6;
    output r5 as Token.record;
    output r6 as shield_swap_arc20_credits.aleo/transfer_from_public_to_private.future;

finalize transfer_from_public_to_private:
    input r0 as field.public;
    input r1 as u128.public;
    input r2 as address.public;
    get.or_use allowances[r0] 0u128 into r3;
    sub r3 r1 into r4;
    set r4 into allowances[r0];
    get balances[r2] into r5;
    sub r5 r1 into r6;
    set r6 into balances[r2];

function join:
    input r0 as Token.record;
    input r1 as Token.record;
    assert.eq r0.owner r1.owner;
    not r0.recipient_bound into r2;
    assert.eq r2 true;
    not r1.recipient_bound into r3;
    assert.eq r3 true;
    add r0.amount r1.amount into r4;
    cast r0.owner r4 false r0.owner into r5 as Token.record;
    output r5 as Token.record;

function split:
    input r0 as Token.record;
    input r1 as u128.private;
    not r0.recipient_bound into r2;
    assert.eq r2 true;
    cast r0.owner r1 false r0.owner into r3 as Token.record;
    sub r0.amount r1 into r4;
    cast r0.owner r4 false r0.owner into r5 as Token.record;
    output r3 as Token.record;
    output r5 as Token.record;

function update_role:
    input r0 as address.public;
    input r1 as u16.private;
    async update_role self.caller r0 r1 into r2;
    output r2 as shield_swap_arc20_credits.aleo/update_role.future;

finalize update_role:
    input r0 as address.public;
    input r1 as address.public;
    input r2 as u16.public;
    get address_to_role[r0] into r3;
    and r3 8u16 into r4;
    is.eq r4 8u16 into r5;
    assert.eq r5 true;
    is.eq r0 r1 into r6;
    branch.eq r6 false to end_then_0_0;
    and r2 8u16 into r7;
    is.eq r7 8u16 into r8;
    assert.eq r8 true;
    branch.eq true true to end_otherwise_0_1;
    position end_then_0_0;
    position end_otherwise_0_1;
    set r2 into address_to_role[r1];

view balance_of:
    input r0 as address.public;
    get.or_use balances[r0] 0u128 into r1;
    output r1 as u128.public;

view allowance:
    input r0 as address.public;
    input r1 as address.public;
    cast r0 r1 into r2 as TokenAllowance;
    hash.bhp256 r2 into r3 as field;
    get.or_use allowances[r3] 0u128 into r4;
    output r4 as u128.public;

view supply:
    contains token_supply__[false] into r0;
    get.or_use token_supply__[false] 0u128 into r1;
    ternary r0 r1 0u128 into r2;
    cast r0 r2 into r3 as Optional__6A9ZdhLQa8N;
    ternary r3.is_some r3.val 0u128 into r4;
    output r4 as u128.public;

view max_supply:
    output 340282366920938463463374607431768211455u128 as u128.public;

view decimals:
    output 6u8 as u8.public;

view name:
    output 'Wrapped_ALEO' as identifier.public;

view symbol:
    output 'ALEO' as identifier.public;

constructor:
    cast 77u8 248u8 100u8 246u8 50u8 83u8 63u8 104u8 204u8 250u8 6u8 86u8 76u8 247u8 153u8 135u8 72u8 128u8 118u8 231u8 149u8 79u8 170u8 192u8 126u8 75u8 198u8 227u8 118u8 150u8 175u8 244u8 into r0 as [u8; 32u32];
    assert.eq name/checksum r0;
    cast 235u8 74u8 194u8 27u8 47u8 200u8 186u8 202u8 17u8 138u8 230u8 164u8 65u8 64u8 181u8 126u8 100u8 173u8 108u8 65u8 110u8 156u8 179u8 21u8 158u8 88u8 72u8 93u8 61u8 84u8 65u8 2u8 into r1 as [u8; 32u32];
    assert.eq symbol/checksum r1;
    cast 79u8 184u8 10u8 23u8 76u8 231u8 192u8 227u8 113u8 114u8 203u8 21u8 227u8 203u8 76u8 60u8 106u8 67u8 110u8 246u8 121u8 247u8 230u8 98u8 155u8 236u8 37u8 144u8 182u8 125u8 48u8 168u8 into r2 as [u8; 32u32];
    assert.eq decimals/checksum r2;
    cast 205u8 178u8 247u8 132u8 253u8 223u8 249u8 127u8 47u8 226u8 176u8 159u8 28u8 113u8 162u8 63u8 192u8 245u8 28u8 142u8 229u8 97u8 243u8 122u8 9u8 163u8 70u8 84u8 253u8 150u8 63u8 127u8 into r3 as [u8; 32u32];
    assert.eq max_supply/checksum r3;
    is.eq edition 0u16 into r4;
    branch.eq r4 false to end_then_0_0;
    set 8u16 into address_to_role[aleo1z3zwzgpgakk89xpknync5rtklkjkyv33g7cvaqe0gku64zs3lv9qyux0qc];
    set 0u128 into token_supply__[false];
    branch.eq true true to end_otherwise_0_1;
    position end_then_0_0;
    position end_otherwise_0_1;
    gt edition 0u16 into r5;
    branch.eq r5 false to end_then_0_2;
    cast checksum edition into r6 as ChecksumEdition;
    hash.bhp256 r6 into r7 as field;
    cast shield_swap_arc20_credits.aleo r7 into r8 as shield_swap_multisig_core.aleo/WalletSigningOpId;
    hash.bhp256 r8 into r9 as field;
    contains shield_swap_multisig_core.aleo/completed_signing_ops[r9] into r10;
    assert.eq r10 true;
    branch.eq true true to end_otherwise_0_3;
    position end_then_0_2;
    position end_otherwise_0_3;
