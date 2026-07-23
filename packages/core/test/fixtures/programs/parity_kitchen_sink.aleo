program parity_kitchen_sink.aleo;

struct Inner:
    tag as field;

struct Outer:
    inner as Inner;
    grid as [[u8; 2u32]; 2u32];

record Item:
    owner as address.private;
    score as u64.private;

mapping totals:
    key as boolean.public;
    value as u128.public;

function mix:
    input r0 as Outer.private;
    input r1 as Item.record;
    input r2 as u8.public;
    input r3 as [Inner; 3u32].public;
    cast r1.owner 5u64 into r4 as Item.record;
    output r0 as Outer.private;
    output r4 as Item.record;
    output r3 as [Inner; 3u32].public;

view peek:
    input r0 as boolean.public;
    get.or_use totals[r0] 0u128 into r1;
    cast r1 into r2 as field;
    cast r2 into r3 as Inner;
    output r3 as Inner.public;

constructor:
    assert.eq edition 0u16;
