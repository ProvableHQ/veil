import token_registry.aleo;
program wrapped_token_registry.aleo;

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

function deposit_token_public_signer:
    input r0 as u128.public;
    call token_registry.aleo/transfer_public_as_signer 99999field wrapped_token_registry.aleo r0 into r1;
    async deposit_token_public_signer self.signer r0 r1 into r2;
    output r2 as wrapped_token_registry.aleo/deposit_token_public_signer.future;

finalize deposit_token_public_signer:
    input r0 as address.public;
    input r1 as u128.public;
    input r2 as token_registry.aleo/transfer_public_as_signer.future;
    get.or_use balances[r0] 0u128 into r3;
    add r3 r1 into r4;
    set r4 into balances[r0];
    contains token_info__[false] into r5;
    cast 0u128 0u128 0u8 0u128 0u128 into r6 as TokenInfo;
    get.or_use token_info__[false] r6 into r7;
    cast 0u128 0u128 0u8 0u128 0u128 into r8 as TokenInfo;
    ternary r5 r7.name r8.name into r9;
    ternary r5 r7.symbol r8.symbol into r10;
    ternary r5 r7.decimals r8.decimals into r11;
    ternary r5 r7.supply r8.supply into r12;
    ternary r5 r7.max_supply r8.max_supply into r13;
    cast r9 r10 r11 r12 r13 into r14 as TokenInfo;
    cast r5 r14 into r15 as Optional__An66AtVsP75;
    cast 18019742092562515u128 4933470u128 6u8 0u128 18000000000000000u128 into r16 as TokenInfo;
    ternary r15.is_some r15.val.name r16.name into r17;
    ternary r15.is_some r15.val.symbol r16.symbol into r18;
    ternary r15.is_some r15.val.decimals r16.decimals into r19;
    ternary r15.is_some r15.val.supply r16.supply into r20;
    ternary r15.is_some r15.val.max_supply r16.max_supply into r21;
    cast r17 r18 r19 r20 r21 into r22 as TokenInfo;
    add r22.supply r1 into r23;
    lte r23 r22.max_supply into r24;
    assert.eq r24 true;
    cast r22.name r22.symbol r22.decimals r23 r22.max_supply into r25 as TokenInfo;
    set r25 into token_info__[false];
    await r2;

function withdraw_token_public:
    input r0 as u128.public;
    call token_registry.aleo/transfer_public 99999field self.caller r0 into r1;
    async withdraw_token_public self.caller r0 r1 into r2;
    output r2 as wrapped_token_registry.aleo/withdraw_token_public.future;

finalize withdraw_token_public:
    input r0 as address.public;
    input r1 as u128.public;
    input r2 as token_registry.aleo/transfer_public.future;
    get balances[r0] into r3;
    sub r3 r1 into r4;
    set r4 into balances[r0];
    contains token_info__[false] into r5;
    cast 0u128 0u128 0u8 0u128 0u128 into r6 as TokenInfo;
    get.or_use token_info__[false] r6 into r7;
    cast 0u128 0u128 0u8 0u128 0u128 into r8 as TokenInfo;
    ternary r5 r7.name r8.name into r9;
    ternary r5 r7.symbol r8.symbol into r10;
    ternary r5 r7.decimals r8.decimals into r11;
    ternary r5 r7.supply r8.supply into r12;
    ternary r5 r7.max_supply r8.max_supply into r13;
    cast r9 r10 r11 r12 r13 into r14 as TokenInfo;
    cast r5 r14 into r15 as Optional__An66AtVsP75;
    cast 18019742092562515u128 4933470u128 6u8 0u128 18000000000000000u128 into r16 as TokenInfo;
    ternary r15.is_some r15.val.name r16.name into r17;
    ternary r15.is_some r15.val.symbol r16.symbol into r18;
    ternary r15.is_some r15.val.decimals r16.decimals into r19;
    ternary r15.is_some r15.val.supply r16.supply into r20;
    ternary r15.is_some r15.val.max_supply r16.max_supply into r21;
    cast r17 r18 r19 r20 r21 into r22 as TokenInfo;
    sub r22.supply r1 into r23;
    cast r22.name r22.symbol r22.decimals r23 r22.max_supply into r24 as TokenInfo;
    set r24 into token_info__[false];
    await r2;

function withdraw_token_public_signer:
    input r0 as u128.public;
    call token_registry.aleo/transfer_public 99999field self.signer r0 into r1;
    async withdraw_token_public_signer self.signer r0 r1 into r2;
    output r2 as wrapped_token_registry.aleo/withdraw_token_public_signer.future;

finalize withdraw_token_public_signer:
    input r0 as address.public;
    input r1 as u128.public;
    input r2 as token_registry.aleo/transfer_public.future;
    get balances[r0] into r3;
    sub r3 r1 into r4;
    set r4 into balances[r0];
    contains token_info__[false] into r5;
    cast 0u128 0u128 0u8 0u128 0u128 into r6 as TokenInfo;
    get.or_use token_info__[false] r6 into r7;
    cast 0u128 0u128 0u8 0u128 0u128 into r8 as TokenInfo;
    ternary r5 r7.name r8.name into r9;
    ternary r5 r7.symbol r8.symbol into r10;
    ternary r5 r7.decimals r8.decimals into r11;
    ternary r5 r7.supply r8.supply into r12;
    ternary r5 r7.max_supply r8.max_supply into r13;
    cast r9 r10 r11 r12 r13 into r14 as TokenInfo;
    cast r5 r14 into r15 as Optional__An66AtVsP75;
    cast 18019742092562515u128 4933470u128 6u8 0u128 18000000000000000u128 into r16 as TokenInfo;
    ternary r15.is_some r15.val.name r16.name into r17;
    ternary r15.is_some r15.val.symbol r16.symbol into r18;
    ternary r15.is_some r15.val.decimals r16.decimals into r19;
    ternary r15.is_some r15.val.supply r16.supply into r20;
    ternary r15.is_some r15.val.max_supply r16.max_supply into r21;
    cast r17 r18 r19 r20 r21 into r22 as TokenInfo;
    sub r22.supply r1 into r23;
    cast r22.name r22.symbol r22.decimals r23 r22.max_supply into r24 as TokenInfo;
    set r24 into token_info__[false];
    await r2;

function withdraw_token_private:
    input r0 as u128.public;
    call token_registry.aleo/transfer_public_to_private 99999field self.signer r0 false into r1 r2;
    async withdraw_token_private self.signer r0 r2 into r3;
    output r1 as token_registry.aleo/Token.record;
    output r3 as wrapped_token_registry.aleo/withdraw_token_private.future;

finalize withdraw_token_private:
    input r0 as address.public;
    input r1 as u128.public;
    input r2 as token_registry.aleo/transfer_public_to_private.future;
    get balances[r0] into r3;
    sub r3 r1 into r4;
    set r4 into balances[r0];
    contains token_info__[false] into r5;
    cast 0u128 0u128 0u8 0u128 0u128 into r6 as TokenInfo;
    get.or_use token_info__[false] r6 into r7;
    cast 0u128 0u128 0u8 0u128 0u128 into r8 as TokenInfo;
    ternary r5 r7.name r8.name into r9;
    ternary r5 r7.symbol r8.symbol into r10;
    ternary r5 r7.decimals r8.decimals into r11;
    ternary r5 r7.supply r8.supply into r12;
    ternary r5 r7.max_supply r8.max_supply into r13;
    cast r9 r10 r11 r12 r13 into r14 as TokenInfo;
    cast r5 r14 into r15 as Optional__An66AtVsP75;
    cast 18019742092562515u128 4933470u128 6u8 0u128 18000000000000000u128 into r16 as TokenInfo;
    ternary r15.is_some r15.val.name r16.name into r17;
    ternary r15.is_some r15.val.symbol r16.symbol into r18;
    ternary r15.is_some r15.val.decimals r16.decimals into r19;
    ternary r15.is_some r15.val.supply r16.supply into r20;
    ternary r15.is_some r15.val.max_supply r16.max_supply into r21;
    cast r17 r18 r19 r20 r21 into r22 as TokenInfo;
    sub r22.supply r1 into r23;
    cast r22.name r22.symbol r22.decimals r23 r22.max_supply into r24 as TokenInfo;
    set r24 into token_info__[false];
    await r2;

function transfer_public:
    input r0 as address.public;
    input r1 as u128.public;
    async transfer_public self.caller r1 r0 into r2;
    output r2 as wrapped_token_registry.aleo/transfer_public.future;

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
    output r2 as wrapped_token_registry.aleo/transfer_public_as_signer.future;

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
    output r3 as wrapped_token_registry.aleo/transfer_public_to_private.future;

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
    output r5 as wrapped_token_registry.aleo/transfer_private_to_public.future;

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
    output r3 as wrapped_token_registry.aleo/approve_public.future;

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
    output r3 as wrapped_token_registry.aleo/unapprove_public.future;

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
    output r4 as wrapped_token_registry.aleo/transfer_from_public.future;

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
    output r5 as wrapped_token_registry.aleo/transfer_from_public_to_private.future;

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
    cast 18019742092562515u128 4933470u128 6u8 0u128 18000000000000000u128 into r11 as TokenInfo;
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
    cast 18019742092562515u128 4933470u128 6u8 0u128 18000000000000000u128 into r11 as TokenInfo;
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
    cast 18019742092562515u128 4933470u128 6u8 0u128 18000000000000000u128 into r11 as TokenInfo;
    ternary r10.is_some r10.val.name r11.name into r12;
    ternary r10.is_some r10.val.symbol r11.symbol into r13;
    ternary r10.is_some r10.val.decimals r11.decimals into r14;
    ternary r10.is_some r10.val.supply r11.supply into r15;
    ternary r10.is_some r10.val.max_supply r11.max_supply into r16;
    cast r12 r13 r14 r15 r16 into r17 as TokenInfo;
    output r17.decimals as u8.public;

view name:
    contains token_info__[false] into r0;
    cast 0u128 0u128 0u8 0u128 0u128 into r1 as TokenInfo;
    get.or_use token_info__[false] r1 into r2;
    output 'wTokReg' as identifier.public;

view symbol:
    contains token_info__[false] into r0;
    cast 0u128 0u128 0u8 0u128 0u128 into r1 as TokenInfo;
    get.or_use token_info__[false] r1 into r2;
    output 'wTR' as identifier.public;

constructor:
    assert.eq edition 0u16;
