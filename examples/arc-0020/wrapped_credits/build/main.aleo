import credits.aleo;
program wrapped_credits.aleo;

record Token:
    owner as address.private;
    amount as u128.private;

struct TokenInfo:
    name as u128;
    symbol as u128;
    decimals as u8;
    supply as u128;
    max_supply as u128;

struct TokenAllowance:
    account as address;
    spender as address;

struct Optional__An66AtVsP75:
    is_some as boolean;
    val as TokenInfo;

mapping balances:
    key as address.public;
    value as u128.public;

mapping allowances:
    key as TokenAllowance.public;
    value as u128.public;

mapping token_info__:
    key as boolean.public;
    value as TokenInfo.public;

function deposit_credits_public_signer:
    input r0 as u64.public;
    call credits.aleo/transfer_public_as_signer wrapped_credits.aleo r0 into r1;
    async deposit_credits_public_signer self.signer r0 r1 into r2;
    output r2 as wrapped_credits.aleo/deposit_credits_public_signer.future;

finalize deposit_credits_public_signer:
    input r0 as address.public;
    input r1 as u64.public;
    input r2 as credits.aleo/transfer_public_as_signer.future;
    get.or_use balances[r0] 0u128 into r3;
    cast r1 into r4 as u128;
    add r3 r4 into r5;
    set r5 into balances[r0];
    cast r1 into r6 as u128;
    contains token_info__[false] into r7;
    cast 0u128 0u128 0u8 0u128 0u128 into r8 as TokenInfo;
    get.or_use token_info__[false] r8 into r9;
    cast 0u128 0u128 0u8 0u128 0u128 into r10 as TokenInfo;
    ternary r7 r9.name r10.name into r11;
    ternary r7 r9.symbol r10.symbol into r12;
    ternary r7 r9.decimals r10.decimals into r13;
    ternary r7 r9.supply r10.supply into r14;
    ternary r7 r9.max_supply r10.max_supply into r15;
    cast r11 r12 r13 r14 r15 into r16 as TokenInfo;
    cast r7 r16 into r17 as Optional__An66AtVsP75;
    cast 138438205403108515442419u128 580610435347u128 6u8 0u128 18000000000000000u128 into r18 as TokenInfo;
    ternary r17.is_some r17.val.name r18.name into r19;
    ternary r17.is_some r17.val.symbol r18.symbol into r20;
    ternary r17.is_some r17.val.decimals r18.decimals into r21;
    ternary r17.is_some r17.val.supply r18.supply into r22;
    ternary r17.is_some r17.val.max_supply r18.max_supply into r23;
    cast r19 r20 r21 r22 r23 into r24 as TokenInfo;
    add r24.supply r6 into r25;
    lte r25 r24.max_supply into r26;
    assert.eq r26 true;
    cast r24.name r24.symbol r24.decimals r25 r24.max_supply into r27 as TokenInfo;
    set r27 into token_info__[false];
    await r2;

function deposit_credits_private:
    input r0 as credits.aleo/credits.record;
    input r1 as u64.public;
    call credits.aleo/transfer_private_to_public r0 wrapped_credits.aleo r1 into r2 r3;
    cast r1 into r4 as u128;
    cast self.signer r4 into r5 as Token.record;
    async deposit_credits_private r1 r3 into r6;
    output r2 as credits.aleo/credits.record;
    output r5 as Token.record;
    output r6 as wrapped_credits.aleo/deposit_credits_private.future;

finalize deposit_credits_private:
    input r0 as u64.public;
    input r1 as credits.aleo/transfer_private_to_public.future;
    cast r0 into r2 as u128;
    contains token_info__[false] into r3;
    cast 0u128 0u128 0u8 0u128 0u128 into r4 as TokenInfo;
    get.or_use token_info__[false] r4 into r5;
    cast 0u128 0u128 0u8 0u128 0u128 into r6 as TokenInfo;
    ternary r3 r5.name r6.name into r7;
    ternary r3 r5.symbol r6.symbol into r8;
    ternary r3 r5.decimals r6.decimals into r9;
    ternary r3 r5.supply r6.supply into r10;
    ternary r3 r5.max_supply r6.max_supply into r11;
    cast r7 r8 r9 r10 r11 into r12 as TokenInfo;
    cast r3 r12 into r13 as Optional__An66AtVsP75;
    cast 138438205403108515442419u128 580610435347u128 6u8 0u128 18000000000000000u128 into r14 as TokenInfo;
    ternary r13.is_some r13.val.name r14.name into r15;
    ternary r13.is_some r13.val.symbol r14.symbol into r16;
    ternary r13.is_some r13.val.decimals r14.decimals into r17;
    ternary r13.is_some r13.val.supply r14.supply into r18;
    ternary r13.is_some r13.val.max_supply r14.max_supply into r19;
    cast r15 r16 r17 r18 r19 into r20 as TokenInfo;
    add r20.supply r2 into r21;
    lte r21 r20.max_supply into r22;
    assert.eq r22 true;
    cast r20.name r20.symbol r20.decimals r21 r20.max_supply into r23 as TokenInfo;
    set r23 into token_info__[false];
    await r1;

function withdraw_credits_public:
    input r0 as u64.public;
    call credits.aleo/transfer_public self.caller r0 into r1;
    async withdraw_credits_public self.caller r0 r1 into r2;
    output r2 as wrapped_credits.aleo/withdraw_credits_public.future;

finalize withdraw_credits_public:
    input r0 as address.public;
    input r1 as u64.public;
    input r2 as credits.aleo/transfer_public.future;
    get balances[r0] into r3;
    cast r1 into r4 as u128;
    sub r3 r4 into r5;
    set r5 into balances[r0];
    cast r1 into r6 as u128;
    contains token_info__[false] into r7;
    cast 0u128 0u128 0u8 0u128 0u128 into r8 as TokenInfo;
    get.or_use token_info__[false] r8 into r9;
    cast 0u128 0u128 0u8 0u128 0u128 into r10 as TokenInfo;
    ternary r7 r9.name r10.name into r11;
    ternary r7 r9.symbol r10.symbol into r12;
    ternary r7 r9.decimals r10.decimals into r13;
    ternary r7 r9.supply r10.supply into r14;
    ternary r7 r9.max_supply r10.max_supply into r15;
    cast r11 r12 r13 r14 r15 into r16 as TokenInfo;
    cast r7 r16 into r17 as Optional__An66AtVsP75;
    cast 138438205403108515442419u128 580610435347u128 6u8 0u128 18000000000000000u128 into r18 as TokenInfo;
    ternary r17.is_some r17.val.name r18.name into r19;
    ternary r17.is_some r17.val.symbol r18.symbol into r20;
    ternary r17.is_some r17.val.decimals r18.decimals into r21;
    ternary r17.is_some r17.val.supply r18.supply into r22;
    ternary r17.is_some r17.val.max_supply r18.max_supply into r23;
    cast r19 r20 r21 r22 r23 into r24 as TokenInfo;
    sub r24.supply r6 into r25;
    cast r24.name r24.symbol r24.decimals r25 r24.max_supply into r26 as TokenInfo;
    set r26 into token_info__[false];
    await r2;

function withdraw_credits_public_signer:
    input r0 as u64.public;
    call credits.aleo/transfer_public self.signer r0 into r1;
    async withdraw_credits_public_signer self.signer r0 r1 into r2;
    output r2 as wrapped_credits.aleo/withdraw_credits_public_signer.future;

finalize withdraw_credits_public_signer:
    input r0 as address.public;
    input r1 as u64.public;
    input r2 as credits.aleo/transfer_public.future;
    get balances[r0] into r3;
    cast r1 into r4 as u128;
    sub r3 r4 into r5;
    set r5 into balances[r0];
    cast r1 into r6 as u128;
    contains token_info__[false] into r7;
    cast 0u128 0u128 0u8 0u128 0u128 into r8 as TokenInfo;
    get.or_use token_info__[false] r8 into r9;
    cast 0u128 0u128 0u8 0u128 0u128 into r10 as TokenInfo;
    ternary r7 r9.name r10.name into r11;
    ternary r7 r9.symbol r10.symbol into r12;
    ternary r7 r9.decimals r10.decimals into r13;
    ternary r7 r9.supply r10.supply into r14;
    ternary r7 r9.max_supply r10.max_supply into r15;
    cast r11 r12 r13 r14 r15 into r16 as TokenInfo;
    cast r7 r16 into r17 as Optional__An66AtVsP75;
    cast 138438205403108515442419u128 580610435347u128 6u8 0u128 18000000000000000u128 into r18 as TokenInfo;
    ternary r17.is_some r17.val.name r18.name into r19;
    ternary r17.is_some r17.val.symbol r18.symbol into r20;
    ternary r17.is_some r17.val.decimals r18.decimals into r21;
    ternary r17.is_some r17.val.supply r18.supply into r22;
    ternary r17.is_some r17.val.max_supply r18.max_supply into r23;
    cast r19 r20 r21 r22 r23 into r24 as TokenInfo;
    sub r24.supply r6 into r25;
    cast r24.name r24.symbol r24.decimals r25 r24.max_supply into r26 as TokenInfo;
    set r26 into token_info__[false];
    await r2;

function withdraw_credits_private:
    input r0 as Token.record;
    input r1 as u64.public;
    call credits.aleo/transfer_public_to_private self.signer r1 into r2 r3;
    cast r1 into r4 as u128;
    sub r0.amount r4 into r5;
    cast r0.owner r5 into r6 as Token.record;
    async withdraw_credits_private r1 r3 into r7;
    output r2 as credits.aleo/credits.record;
    output r6 as Token.record;
    output r7 as wrapped_credits.aleo/withdraw_credits_private.future;

finalize withdraw_credits_private:
    input r0 as u64.public;
    input r1 as credits.aleo/transfer_public_to_private.future;
    cast r0 into r2 as u128;
    contains token_info__[false] into r3;
    cast 0u128 0u128 0u8 0u128 0u128 into r4 as TokenInfo;
    get.or_use token_info__[false] r4 into r5;
    cast 0u128 0u128 0u8 0u128 0u128 into r6 as TokenInfo;
    ternary r3 r5.name r6.name into r7;
    ternary r3 r5.symbol r6.symbol into r8;
    ternary r3 r5.decimals r6.decimals into r9;
    ternary r3 r5.supply r6.supply into r10;
    ternary r3 r5.max_supply r6.max_supply into r11;
    cast r7 r8 r9 r10 r11 into r12 as TokenInfo;
    cast r3 r12 into r13 as Optional__An66AtVsP75;
    cast 138438205403108515442419u128 580610435347u128 6u8 0u128 18000000000000000u128 into r14 as TokenInfo;
    ternary r13.is_some r13.val.name r14.name into r15;
    ternary r13.is_some r13.val.symbol r14.symbol into r16;
    ternary r13.is_some r13.val.decimals r14.decimals into r17;
    ternary r13.is_some r13.val.supply r14.supply into r18;
    ternary r13.is_some r13.val.max_supply r14.max_supply into r19;
    cast r15 r16 r17 r18 r19 into r20 as TokenInfo;
    sub r20.supply r2 into r21;
    cast r20.name r20.symbol r20.decimals r21 r20.max_supply into r22 as TokenInfo;
    set r22 into token_info__[false];
    await r1;

function transfer_public:
    input r0 as address.public;
    input r1 as u128.public;
    async transfer_public self.caller r1 r0 into r2;
    output r2 as wrapped_credits.aleo/transfer_public.future;

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
    output r2 as wrapped_credits.aleo/transfer_public_as_signer.future;

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
    cast r0 r1 into r2 as Token.record;
    async transfer_public_to_private self.caller r1 into r3;
    output r2 as Token.record;
    output r3 as wrapped_credits.aleo/transfer_public_to_private.future;

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
    sub r0.amount r2 into r3;
    cast r0.owner r3 into r4 as Token.record;
    cast r1 r2 into r5 as Token.record;
    output r4 as Token.record;
    output r5 as Token.record;

function transfer_private_to_public:
    input r0 as Token.record;
    input r1 as address.public;
    input r2 as u128.public;
    sub r0.amount r2 into r3;
    cast r0.owner r3 into r4 as Token.record;
    async transfer_private_to_public r1 r2 into r5;
    output r4 as Token.record;
    output r5 as wrapped_credits.aleo/transfer_private_to_public.future;

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
    async approve_public r2 r1 into r3;
    output r3 as wrapped_credits.aleo/approve_public.future;

finalize approve_public:
    input r0 as TokenAllowance.public;
    input r1 as u128.public;
    get.or_use allowances[r0] 0u128 into r2;
    add r2 r1 into r3;
    set r3 into allowances[r0];

function unapprove_public:
    input r0 as address.public;
    input r1 as u128.public;
    cast self.caller r0 into r2 as TokenAllowance;
    async unapprove_public r2 r1 into r3;
    output r3 as wrapped_credits.aleo/unapprove_public.future;

finalize unapprove_public:
    input r0 as TokenAllowance.public;
    input r1 as u128.public;
    get allowances[r0] into r2;
    sub r2 r1 into r3;
    set r3 into allowances[r0];

function transfer_from_public:
    input r0 as address.public;
    input r1 as address.public;
    input r2 as u128.public;
    cast r0 self.caller into r3 as TokenAllowance;
    async transfer_from_public r3 r2 r0 r1 into r4;
    output r4 as wrapped_credits.aleo/transfer_from_public.future;

finalize transfer_from_public:
    input r0 as TokenAllowance.public;
    input r1 as u128.public;
    input r2 as address.public;
    input r3 as address.public;
    get allowances[r0] into r4;
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
    cast r1 r2 into r4 as Token.record;
    async transfer_from_public_to_private r3 r2 r0 into r5;
    output r4 as Token.record;
    output r5 as wrapped_credits.aleo/transfer_from_public_to_private.future;

finalize transfer_from_public_to_private:
    input r0 as TokenAllowance.public;
    input r1 as u128.public;
    input r2 as address.public;
    get allowances[r0] into r3;
    sub r3 r1 into r4;
    set r4 into allowances[r0];
    get balances[r2] into r5;
    sub r5 r1 into r6;
    set r6 into balances[r2];

function join:
    input r0 as Token.record;
    input r1 as Token.record;
    assert.eq r0.owner r1.owner;
    add r0.amount r1.amount into r2;
    cast r0.owner r2 into r3 as Token.record;
    output r3 as Token.record;

function split:
    input r0 as Token.record;
    input r1 as u128.private;
    cast r0.owner r1 into r2 as Token.record;
    sub r0.amount r1 into r3;
    cast r0.owner r3 into r4 as Token.record;
    output r2 as Token.record;
    output r4 as Token.record;

view balance_of:
    input r0 as address.public;
    get.or_use balances[r0] 0u128 into r1;
    output r1 as u128.public;

view allowance:
    input r0 as address.public;
    input r1 as address.public;
    cast r0 r1 into r2 as TokenAllowance;
    get.or_use allowances[r2] 0u128 into r3;
    output r3 as u128.public;

view supply:
    contains token_info__[false] into r0;
    cast 0u128 0u128 0u8 0u128 0u128 into r1 as TokenInfo;
    get.or_use token_info__[false] r1 into r2;
    cast 0u128 0u128 0u8 0u128 0u128 into r3 as TokenInfo;
    ternary r0 r2.name r3.name into r4;
    ternary r0 r2.symbol r3.symbol into r5;
    ternary r0 r2.decimals r3.decimals into r6;
    ternary r0 r2.supply r3.supply into r7;
    ternary r0 r2.max_supply r3.max_supply into r8;
    cast r4 r5 r6 r7 r8 into r9 as TokenInfo;
    cast r0 r9 into r10 as Optional__An66AtVsP75;
    cast 138438205403108515442419u128 580610435347u128 6u8 0u128 18000000000000000u128 into r11 as TokenInfo;
    ternary r10.is_some r10.val.name r11.name into r12;
    ternary r10.is_some r10.val.symbol r11.symbol into r13;
    ternary r10.is_some r10.val.decimals r11.decimals into r14;
    ternary r10.is_some r10.val.supply r11.supply into r15;
    ternary r10.is_some r10.val.max_supply r11.max_supply into r16;
    cast r12 r13 r14 r15 r16 into r17 as TokenInfo;
    output r17.supply as u128.public;

view max_supply:
    contains token_info__[false] into r0;
    cast 0u128 0u128 0u8 0u128 0u128 into r1 as TokenInfo;
    get.or_use token_info__[false] r1 into r2;
    cast 0u128 0u128 0u8 0u128 0u128 into r3 as TokenInfo;
    ternary r0 r2.name r3.name into r4;
    ternary r0 r2.symbol r3.symbol into r5;
    ternary r0 r2.decimals r3.decimals into r6;
    ternary r0 r2.supply r3.supply into r7;
    ternary r0 r2.max_supply r3.max_supply into r8;
    cast r4 r5 r6 r7 r8 into r9 as TokenInfo;
    cast r0 r9 into r10 as Optional__An66AtVsP75;
    cast 138438205403108515442419u128 580610435347u128 6u8 0u128 18000000000000000u128 into r11 as TokenInfo;
    ternary r10.is_some r10.val.name r11.name into r12;
    ternary r10.is_some r10.val.symbol r11.symbol into r13;
    ternary r10.is_some r10.val.decimals r11.decimals into r14;
    ternary r10.is_some r10.val.supply r11.supply into r15;
    ternary r10.is_some r10.val.max_supply r11.max_supply into r16;
    cast r12 r13 r14 r15 r16 into r17 as TokenInfo;
    output r17.max_supply as u128.public;

view decimals:
    contains token_info__[false] into r0;
    cast 0u128 0u128 0u8 0u128 0u128 into r1 as TokenInfo;
    get.or_use token_info__[false] r1 into r2;
    cast 0u128 0u128 0u8 0u128 0u128 into r3 as TokenInfo;
    ternary r0 r2.name r3.name into r4;
    ternary r0 r2.symbol r3.symbol into r5;
    ternary r0 r2.decimals r3.decimals into r6;
    ternary r0 r2.supply r3.supply into r7;
    ternary r0 r2.max_supply r3.max_supply into r8;
    cast r4 r5 r6 r7 r8 into r9 as TokenInfo;
    cast r0 r9 into r10 as Optional__An66AtVsP75;
    cast 138438205403108515442419u128 580610435347u128 6u8 0u128 18000000000000000u128 into r11 as TokenInfo;
    ternary r10.is_some r10.val.name r11.name into r12;
    ternary r10.is_some r10.val.symbol r11.symbol into r13;
    ternary r10.is_some r10.val.decimals r11.decimals into r14;
    ternary r10.is_some r10.val.supply r11.supply into r15;
    ternary r10.is_some r10.val.max_supply r11.max_supply into r16;
    cast r12 r13 r14 r15 r16 into r17 as TokenInfo;
    output r17.decimals as u8.public;

view name:
    output 'wCredits' as identifier.public;

view symbol:
    output 'wCRD' as identifier.public;

constructor:
    assert.eq edition 0u16;
