// ARC-20 token interface for dynamic dispatch.
// All token wrapper programs (test_token_a, test_token_b, wrapped_native_credits, etc.)
// implement these functions. The AMM dispatches to them at runtime via the token_id field.
interface ARC20 {
    record Token;
    record Metadata;

    fn transfer_public(public recipient: address, public amount: u128) -> Final;
    fn transfer_from_public(public owner: address, public recipient: address, public amount: u128) -> Final;
    fn transfer_private_to_public(input: dyn record, to: address, amount: u128) -> (dyn record, dyn record, Final);
    fn transfer_public_to_private(recipient: address, public amount: u128) -> (dyn record, Final);
}

program leo_amm.aleo {
    // TODO: Replace with the real admin address before mainnet deployment.
    const DEPLOYER: address = aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px;


    // The PoolState struct holds the core parameters of each liquidity pool, including the token program IDs, fee tier, and enabled status.
    struct PoolState {
       // The program ID for token0
       token0: field,
      // The program ID for token1
       token1: field,
       // The fee tier. // TODO (raychu86): Confirm the documentation.
       fee: u16,
       // The flag determining if the pool is enabled.
       enabled: bool
    }

    // TODO (raychu86): Update Documentation
    struct Slot {
        tick:i32,
        tick_spacing: u32,
        sqrt_price: u128,
        fee_protocol: u8,
        liquidity:u128,
        fee_growth_global0_x_128:u128,
        fee_growth_global1_x_128:u128,
        max_liquidity_per_tick:u128,
        protocol_fees0: u128,
        protocol_fees1: u128
    }

    // TODO (raychu86): Update Documentation
    struct Tick {
        pool:field,
        liquidity_net:i128,
        liquidity_gross:u128,
        tick:i32,
        fee_growth_outside0_128:u128,
        fee_growth_outside1_128:u128
    }

    // TODO (raychu86): Update Documentation
    struct Position{
        token_id:field,
        pool:field,
        tick_lower:i32,
        tick_upper:i32,
        liquidity:u128,
        fee_growth_inside0_last_128:u128,
        fee_growth_inside1_last_128:u128,
        tokens_owed0:u128,
        tokens_owed1:u128
    }

    // TODO (raychu86): Update Documentation
    record PositionNFT {
        owner: address,
        token_id: field,
        pool: field,
        tick_lower: i32,
        tick_upper: i32
    }

    //---------------KEYS---------------------//
    //                                        //
    //----------------------------------------//
    struct PoolKey {
        token0:field,
        token1:field,
        fee:u16
    }

    struct TickKey {
        pool:field,
        tick:i32
    }

    struct SwapKey {
        pool: field,
        zero_for_one: bool,
        amount_in: u128,
        sqrt_price_limit: u128,
        recipient: address,
        nonce: u64,
        caller: address
    }

    //---------------REQUESTS-----------------//
    //                                        //
    //----------------------------------------//

    struct MintPositionRequest{
        pool:field,
        tick_lower:i32,
        tick_upper:i32,
        amount0_desired:u128,
        amount1_desired:u128,
        amount0_min:u128,
        amount1_min:u128,
        // Hint ticks for linked list insertion (the tick just below where we're inserting)
        tick_lower_hint:i32,
        tick_upper_hint:i32
    }

    struct TokenIDPreimage {
        request: MintPositionRequest,
        recipient: address,
    }

    // Swap request with 2 tick hints for bounded iteration
    struct SwapRequest {
        pool: field,
        zero_for_one: bool,
        amount_in: u128,
        amount_out_min: u128,
        sqrt_price_limit: u128,
        recipient: address,
        tick_hint_0: i32,
        tick_hint_1: i32,
        nonce: u64,  // unique per swap to prevent duplicate swap_id
        deadline: u32  // block height deadline
    }

    // Pending swap output that user can claim
    struct SwapOutput {
        recipient: address,
        caller: address,  // original caller who initiated the swap
        token_in: field,
        token_out: field,
        amount_out: u128,
        amount_remaining: u128  // remaining input tokens to refund
    }

    struct SwapHop {
        pool: field,
        zero_for_one: bool,
        tick_hint_0: i32,
        tick_hint_1: i32,
        sqrt_price_limit: u128  // price limit for this hop (prevents sandwich attacks)
    }

    // Multi-hop swap request supporting 2-3 hops
    // For single-hop swaps, use the regular swap() function
    // For 2-hop: set hop_count=2, hop2 is ignored
    // For 3-hop: set hop_count=3
    struct SwapMultiHopRequest {
        token_in: field,
        token_out: field,
        amount_in: u128,
        amount_out_min: u128,
        recipient: address,
        hop0: SwapHop,
        hop1: SwapHop,
        hop2: SwapHop,
        hop_count: u8,  // 2 or 3
        nonce: u64,
        deadline: u32,
        caller: address  // stored for claim validation
    }
    
    struct RDerivation {
        view_key: scalar,
        counter: u32
    }


    const MIN_TICK: i32 = -887272i32;
    const Q64: u128 = 9223372036854775808u128; // 2^63

    const MAGIC_1: u128 = 9222910902837697536u128;
    const MAGIC_2: u128 = 9222449791875588096u128;
    const MAGIC_4: u128 = 9221527639111677952u128;
    const MAGIC_8: u128 = 9219683610192801792u128;
    const MAGIC_16: u128 = 9215996658532725760u128;
    const MAGIC_32: u128 = 9208627177859081216u128;
    const MAGIC_64: u128 = 9193905890596798464u128;
    const MAGIC_128: u128 = 9164533880601766912u128;
    const MAGIC_256: u128 = 9106071067403056128u128;
    const MAGIC_512: u128 = 8990261907820801024u128;
    const MAGIC_1024: u128 = 8763043369415622656u128;
    const MAGIC_2048: u128 = 8325689215117605888u128;
    const MAGIC_4096: u128 = 7515375139346884608u128;
    const MAGIC_8192: u128 = 6123667489441693696u128;
    const MAGIC_16384: u128 = 4065682634442729984u128;
    const MAGIC_32768: u128 = 1792161827361994496u128;
    const MAGIC_65536: u128 = 348228825923923264u128;
    const MAGIC_131072: u128 = 13147394978735516u128;
    const MAGIC_262144: u128 = 18740867660568u128;
    const MAGIC_524288: u128 = 38079361u128;

    const START_3: u128 = 9221988703967300608u128;
    const MAX_TICK: i32 = 887272i32;
    const LOG_SQRT_10001: i128 = 1330584781654114i128;

    @noupgrade
    constructor() {}

    mapping pools: field=>PoolState;
    mapping slots: field=>Slot;
    mapping ticks: field=>Tick;
    mapping initialized_pools:field=>bool;

    mapping tick_spacings: u32=>bool;
    mapping fee_tiers: u16=>bool;
    mapping positions: field=>Position;  // keyed by token_id
    mapping swap_outputs: field=>SwapOutput;  // keyed by swap_id (used for both single and multi-hop swaps)
    mapping admin: bool=>address;  // admin address (key is always true)

    // Track the blinded addresses that have been used.
    mapping used_blinded_addresses: address=>bool;

    // Initialize admin - can only be called once via constructor or first call
    fn initialize_admin(public new_admin: address) -> Final {
        return final { finalize_initialize_admin(new_admin); };
    }

    // Transfer admin role to new address
    fn transfer_admin(public new_admin: address) -> Final {
        let caller = self.caller;
        return final { finalize_transfer_admin(caller, new_admin); };
    }

    // Add a valid tick spacing (admin only)
    fn add_tick_spacing(public tick_spacing: u32) -> Final {
        let caller = self.caller;
        return final { finalize_add_tick_spacing(caller, tick_spacing); };
    }

    fn add_fee_tier(public fee: u16) -> Final {
        let caller = self.caller;
        return final { finalize_add_fee_tier(caller, fee); };
    }

    fn set_pool_enabled(public pool_key: field, public enabled: bool) -> Final {
        let caller = self.caller;
        return final { finalize_set_pool_enabled(caller, pool_key, enabled); };
    }

    fn set_fee_protocol(public pool_key: field, public fee_protocol: u8) -> Final {
        let caller = self.caller;
        return final { finalize_set_fee_protocol(caller, pool_key, fee_protocol); };
    }

    // Collect accumulated protocol fees (admin only)
    // Inputs are:
    // - pool_key: identifies the pool to collect from
    // - amount0_requested: amount of token0 fees to collect
    // - amount1_requested: amount of token1 fees to collect
    // - token0_id: The program ID of token0
    // - token1_id: The program ID of token1
    // - recipient: address to receive the collected fees
    fn collect_protocol(
        public pool_key: field,
        public amount0_requested: u128,
        public amount1_requested: u128,
        public token0_id: field,
        public token1_id: field,
        public recipient: address
    ) -> Final {
        // Perform the first transfer call to move token0 fees to recipient.
        let transfer0_future: Final = ARC20@(token0_id)::transfer_public(recipient, amount0_requested);
        // Perform the second transfer call to move token1 fees to recipient.
        let transfer1_future: Final = ARC20@(token1_id)::transfer_public(recipient, amount1_requested);

        let caller = self.caller;
        return final { finalize_collect_protocol(
            transfer0_future,
            transfer1_future,
            caller,
            pool_key,
            amount0_requested,
            amount1_requested,
            token0_id,
            token1_id
        );};
    }

    fn create_pool(
        public token0_program_id:field,
        public token1_program_id:field,
        public fee:u16,
        public initial_sqrt_price:u128,
        public tick_spacing:u32,
        public initial_tick:i32
    ) -> (public field, public address, Final) {
        let (sorted_token0, sorted_token1) = token0_program_id < token1_program_id ? (token0_program_id, token1_program_id) : (token1_program_id, token0_program_id);
        let pool_key: field = BHP256::hash_to_field(PoolKey { token0: sorted_token0, token1: sorted_token1, fee });

        let tick_lower_bound: u128 = get_sqrt_price_at_tick(initial_tick);
        let tick_upper_bound: u128 = get_sqrt_price_at_tick(initial_tick + 1i32);

        return (pool_key,self.signer, final { finalize_create_pool(token0_program_id, token1_program_id, fee, initial_sqrt_price, tick_spacing, initial_tick, tick_lower_bound, tick_upper_bound);});
    }

   fn mint(
        private recipient: address, // TODO (raychu86): @goran This is fine as public or private, but I'm not sure if the indexer relies on this being public in any way.
        public request: MintPositionRequest,
        public token0_id: field,
        public token1_id: field
   ) -> (public field, public address, PositionNFT, Final) {
        // Compute token_id from the request and recipient - returned publicly for client access
        let token_id: field = BHP256::hash_to_field(TokenIDPreimage { request, recipient });

        let nft: PositionNFT = PositionNFT {
            owner: recipient,
            token_id: token_id,
            pool: request.pool,
            tick_lower: request.tick_lower,
            tick_upper: request.tick_upper
        };

        // Perform the first transfer call to move token0 from the signer to this contract.
        // Uses ARC-20 transfer_from_public: AMM (self.caller in token program) pulls from user (self.signer).
        let transfer0_future: Final = ARC20@(token0_id)::transfer_from_public(self.signer, self.address, request.amount0_desired);
        // Perform the second transfer call to move token1 from the signer to this contract.
        let transfer1_future: Final = ARC20@(token1_id)::transfer_from_public(self.signer, self.address, request.amount1_desired);

        // Return token_id publicly so client can use it for position queries
        return (token_id,self.signer, nft, final { finalize_mint(transfer0_future, transfer1_future, request, token_id, token0_id, token1_id);});
   }

   // Private mint: hides position owner identity using a blinded address.
   // The token_id is derived from blinded_address, making position ownership unlinkable.
   fn mint_private(
        private token0_record: dyn record,
        private token1_record: dyn record,
        private recipient: address,
        public request: MintPositionRequest,
        public token0_id: field,
        public token1_id: field
   ) -> (public field, PositionNFT, dyn record, dyn record, Final) {
        // Compute token_id from the request and recipient - returned publicly for client access
        let token_id: field = BHP256::hash_to_field(TokenIDPreimage { request, recipient });

        // NFT owner is the real recipient (private record field, encrypted on-chain)
        let nft: PositionNFT = PositionNFT {
            owner: recipient,
            token_id: token_id,
            pool: request.pool,
            tick_lower: request.tick_lower,
            tick_upper: request.tick_upper
        };

        // Perform the first transfer call to transfer token0 privately to this contract.
        let (change0, meta0, transfer0_future): (dyn record, dyn record, Final) = ARC20@(token0_id)::transfer_private_to_public(token0_record, self.address, request.amount0_desired);
        // Perform the second transfer call to transfer token1 privately to this contract.
        let (change1, meta1, transfer1_future): (dyn record, dyn record, Final) = ARC20@(token1_id)::transfer_private_to_public(token1_record, self.address, request.amount1_desired);

        return (token_id, nft, change0, change1, final { finalize_mint(transfer0_future, transfer1_future, request, token_id, token0_id, token1_id); });
   }

   fn decrease_liquidity(
        nft: PositionNFT,
        public liquidity_to_remove: u128,
        public amount0_min: u128,
        public amount1_min: u128
   ) -> (public field, PositionNFT, Final) {
        let updated_nft: PositionNFT = PositionNFT {
            owner: nft.owner,
            token_id: nft.token_id,
            pool: nft.pool,
            tick_lower: nft.tick_lower,
            tick_upper: nft.tick_upper
        };

        let nft_token_id = nft.token_id;
        let nft_pool = nft.pool;
        let nft_tick_lower = nft.tick_lower;
        let nft_tick_upper = nft.tick_upper;
        return (nft.token_id, updated_nft, final { finalize_decrease_liquidity(
            nft_token_id,
            nft_pool,
            nft_tick_lower,
            nft_tick_upper,
            liquidity_to_remove,
            amount0_min,
            amount1_min
        );});
   }

   fn increase_liquidity(
        nft: PositionNFT,
        public amount0_desired: u128,
        public amount1_desired: u128,
        public amount0_min: u128,
        public amount1_min: u128,
        public token0_id: field,
        public token1_id: field
   ) -> (public field,PositionNFT, Final) {
        let updated_nft: PositionNFT = PositionNFT {
            owner: nft.owner,
            token_id: nft.token_id,
            pool: nft.pool,
            tick_lower: nft.tick_lower,
            tick_upper: nft.tick_upper
        };

        // Perform the first transfer call to move token0 from the signer to this contract.
        let transfer0_future: Final = ARC20@(token0_id)::transfer_from_public(self.signer, self.address, amount0_desired);
        // Perform the second transfer call to move token1 from the signer to this contract.
        let transfer1_future: Final = ARC20@(token1_id)::transfer_from_public(self.signer, self.address, amount1_desired);

        let nft_token_id = nft.token_id;
        let nft_pool = nft.pool;
        let nft_tick_lower = nft.tick_lower;
        let nft_tick_upper = nft.tick_upper;
        return (nft.token_id, updated_nft, final { finalize_increase_liquidity(
            transfer0_future,
            transfer1_future,
            nft_token_id,
            nft_pool,
            nft_tick_lower,
            nft_tick_upper,
            amount0_desired,
            amount1_desired,
            amount0_min,
            amount1_min,
            token0_id,
            token1_id
        );});
   }

   fn increase_liquidity_private(
        nft: PositionNFT,
        private token0_record: dyn record,
        private token1_record: dyn record,
        public amount0_desired: u128,
        public amount1_desired: u128,
        public amount0_min: u128,
        public amount1_min: u128,
        public token0_id: field,
        public token1_id: field
   ) -> (public field, PositionNFT, dyn record, dyn record, Final) {
        let updated_nft: PositionNFT = PositionNFT {
            owner: nft.owner,
            token_id: nft.token_id,
            pool: nft.pool,
            tick_lower: nft.tick_lower,
            tick_upper: nft.tick_upper
        };

        let (change0, meta0, transfer0_future): (dyn record, dyn record, Final) = ARC20@(token0_id)::transfer_private_to_public(token0_record, self.address, amount0_desired);
        let (change1, meta1, transfer1_future): (dyn record, dyn record, Final) = ARC20@(token1_id)::transfer_private_to_public(token1_record, self.address, amount1_desired);

        let nft_token_id = nft.token_id;
        let nft_pool = nft.pool;
        let nft_tick_lower = nft.tick_lower;
        let nft_tick_upper = nft.tick_upper;
        return (nft.token_id, updated_nft, change0, change1, final { finalize_increase_liquidity(
            transfer0_future,
            transfer1_future,
            nft_token_id,
            nft_pool,
            nft_tick_lower,
            nft_tick_upper,
            amount0_desired,
            amount1_desired,
            amount0_min,
            amount1_min,
            token0_id,
            token1_id
        );});
   }

   fn collect(
        nft: PositionNFT,
        public amount0_requested: u128,
        public amount1_requested: u128,
        public token0_id: field,
        public token1_id: field,
        public recipient: address
   ) -> (PositionNFT, Final) {
        let updated_nft: PositionNFT = PositionNFT {
            owner: nft.owner,
            token_id: nft.token_id,
            pool: nft.pool,
            tick_lower: nft.tick_lower,
            tick_upper: nft.tick_upper
        };

        // Perform the first transfer call to move token0 fees to recipient
        let transfer0_future: Final = ARC20@(token0_id)::transfer_public(recipient, amount0_requested);
        // Perform the second transfer call to move token1 fees to recipient
        let transfer1_future: Final = ARC20@(token1_id)::transfer_public(recipient, amount1_requested);

        let nft_token_id = nft.token_id;
        let nft_pool = nft.pool;
        let nft_tick_lower = nft.tick_lower;
        let nft_tick_upper = nft.tick_upper;
        return (updated_nft, final { finalize_collect(
            transfer0_future,
            transfer1_future,
            nft_token_id,
            nft_pool,
            nft_tick_lower,
            nft_tick_upper,
            amount0_requested,
            amount1_requested,
            token0_id,
            token1_id
        );});
   }

   // Private collect: recipient receives private Token records, hiding their identity.
   fn collect_private(
        nft: PositionNFT,
        public amount0_requested: u128,
        public amount1_requested: u128,
        public token0_id: field,
        public token1_id: field,
        private recipient: address
   ) -> (PositionNFT, dyn record, dyn record, Final) {
        let updated_nft: PositionNFT = PositionNFT {
            owner: nft.owner,
            token_id: nft.token_id,
            pool: nft.pool,
            tick_lower: nft.tick_lower,
            tick_upper: nft.tick_upper
        };

        // Perform the first transfer call to transfer token0 to the recipient privately.
        let (token0_record, transfer0_future): (dyn record, Final) = ARC20@(token0_id)::transfer_public_to_private(recipient, amount0_requested);
        // Perform the second transfer call to transfer token1 to the recipient privately.
        let (token1_record, transfer1_future): (dyn record, Final) = ARC20@(token1_id)::transfer_public_to_private(recipient, amount1_requested);

        let nft_token_id = nft.token_id;
        let nft_pool = nft.pool;
        let nft_tick_lower = nft.tick_lower;
        let nft_tick_upper = nft.tick_upper;
        return (updated_nft, token0_record, token1_record, final { finalize_collect(
            transfer0_future,
            transfer1_future,
            nft_token_id,
            nft_pool,
            nft_tick_lower,
            nft_tick_upper,
            amount0_requested,
            amount1_requested,
            token0_id,
            token1_id
        ); } );
   }

   fn burn(nft: PositionNFT) -> (public field,public address,Final) {
        let token_id = nft.token_id;
        return (nft.token_id,self.signer, final { finalize_burn(token_id); });
   }

   fn swap(
        public request: SwapRequest,
        public token0_id: field,
        public token1_id: field
   ) -> (public field, Final) {
        let swap_id: field = BHP256::hash_to_field(SwapKey {
            pool: request.pool,
            zero_for_one: request.zero_for_one,
            amount_in: request.amount_in,
            sqrt_price_limit: request.sqrt_price_limit,
            recipient: request.recipient,
            nonce: request.nonce,
            caller: self.caller
        });

        let (token_in, token_out): (field, field) = request.zero_for_one
            ? (token0_id, token1_id)
            : (token1_id, token0_id);

        // Perform the transfer for token_in to initiate the swap.
        let transfer_in_future: Final = ARC20@(token_in)::transfer_from_public(self.signer, self.address, request.amount_in);

        let caller = self.caller;
        return (swap_id, final { finalize_swap(transfer_in_future, request, false, token0_id, token1_id, swap_id, token_in, token_out, caller); });
   }

   // Private swap: hides the caller/recipient identity using a blinded address.
   fn swap_private(
        private view_key: scalar,
        private counter: u32,
        private blinded_address: address,
        private token_in_record: dyn record,
        public pool: field,
        public zero_for_one: bool,
        public amount_in: u128,
        public amount_out_min: u128,
        public sqrt_price_limit: u128,
        public tick_hint_0: i32,
        public tick_hint_1: i32,
        public nonce: u64,
        public deadline: u32,
        public token0_id: field,
        public token1_id: field
   ) -> (public field, dyn record, Final) {
        // Derive `r` from contract address, view key , and counter.
        let r: scalar = BHP256::hash_to_scalar_raw([self.address as field, view_key as field, counter as field]);
        // Compute blinded address — unlinkable to self.signer without knowing r.
        let expected_blinded_address: address = BHP256::commit_to_address(self.signer, r);
        // Ensure that the blinded address is correctly derived from the signer and `r`.
        assert_eq(expected_blinded_address, blinded_address);

        // Check that the view key is associated with the signer.
        let calculated_address = Aleo::generator() * view_key;
        assert(calculated_address as address == self.signer);

        // Construct request with blinded address as recipient
        let request: SwapRequest = SwapRequest {
            pool: pool,
            zero_for_one: zero_for_one,
            amount_in: amount_in,
            amount_out_min: amount_out_min,
            sqrt_price_limit: sqrt_price_limit,
            recipient: blinded_address,
            tick_hint_0: tick_hint_0,
            tick_hint_1: tick_hint_1,
            nonce: nonce,
            deadline: deadline
        };

        let swap_id: field = BHP256::hash_to_field(SwapKey {
            pool: pool,
            zero_for_one: zero_for_one,
            amount_in: amount_in,
            sqrt_price_limit: sqrt_price_limit,
            recipient: blinded_address,
            nonce: nonce,
            caller: blinded_address
        });

        let (token_in, token_out): (field, field) = zero_for_one
            ? (token0_id, token1_id)
            : (token1_id, token0_id);

        // Perform the private transfer for token_in to initiate the swap.
        let (change, meta, transfer_in_future): (dyn record, dyn record, Final) = ARC20@(token_in)::transfer_private_to_public(token_in_record, self.address, amount_in);

        return (swap_id, change, final { finalize_swap(transfer_in_future, request, true, token0_id, token1_id, swap_id, token_in, token_out, blinded_address);});
   }

   fn claim_swap_output(
        public swap_id: field,
        public token_in: field,
        public token_out: field,
        public amount_out: u128,
        public amount_remaining: u128,
        public recipient: address
   ) -> Final {
        // Transfer output tokens to recipient
        let transfer_out_future: Final = ARC20@(token_out)::transfer_public(recipient, amount_out);
        // Refund remaining input tokens (if any)
        let transfer_refund_future: Final = ARC20@(token_in)::transfer_public(recipient, amount_remaining);

        let caller = self.caller;
        return final { finalize_claim_swap_output(transfer_out_future, transfer_refund_future, swap_id, token_in, token_out, amount_out, amount_remaining, recipient, caller); };
   }

   // Private claim: tokens are issued as private records to self.signer.
   // Caller proves ownership of the blinded address via view_key + counter (same values used in swap_private).
   // self.signer is used as recipient — no extra address parameter to track or leak.
   fn claim_swap_output_private(
        private view_key: scalar,
        private counter: u32,
        private blinded_address: address,
        public swap_id: field,
        public token_in: field,
        public token_out: field,
        public amount_out: u128,
        public amount_remaining: u128
   ) -> (dyn record, dyn record, Final) {
        // Derive `r` from contract address, view key , and counter.
        let r: scalar = BHP256::hash_to_scalar_raw([self.address as field, view_key as field, counter as field]);
        // Compute blinded address — unlinkable to self.signer without knowing r.
        let expected_blinded_address: address = BHP256::commit_to_address(self.signer, r);
        // Ensure that the blinded address is correctly derived from the signer and `r`.
        assert_eq(expected_blinded_address, blinded_address);

        // Check that the view key is associated with the signer.
        let calculated_address = Aleo::generator() * view_key;
        assert(calculated_address as address == self.signer);

        // TODO (raychu86): Remove the change record outputs here. It's not needed.
        // Transfer output tokens as private record to self.signer
        let (out_record, transfer_out_future): (dyn record, Final) = ARC20@(token_out)::transfer_public_to_private(self.signer, amount_out);
        // Refund remaining input tokens as private record to self.signer
        let (refund_record, transfer_refund_future): (dyn record, Final) = ARC20@(token_in)::transfer_public_to_private(self.signer, amount_remaining);

        return (out_record, refund_record, final { finalize_claim_swap_output(
            transfer_out_future, transfer_refund_future,
            swap_id, token_in, token_out, amount_out, amount_remaining,
            blinded_address, blinded_address
        ); });
   }

   fn swap_multi_hop(
        public request: SwapMultiHopRequest
   ) -> (public field, Final) {
        // Validate caller matches request (prevents front-running claim)
        assert(request.caller == self.caller);

        let swap_id: field = BHP256::hash_to_field(SwapMultiHopRequest {
            token_in: request.token_in,
            token_out: request.token_out,
            amount_in: request.amount_in,
            amount_out_min: request.amount_out_min,
            recipient: request.recipient,
            hop0: request.hop0,
            hop1: request.hop1,
            hop2: request.hop2,
            hop_count: request.hop_count,
            nonce: request.nonce,
            deadline: request.deadline,
            caller: request.caller
        });

        // Perform the transfer call for `token_in` to initiate the multi-hop swap.
        let transfer_in_future: Final = ARC20@(request.token_in)::transfer_from_public(self.signer, self.address, request.amount_in);

        return (swap_id, final { finalize_swap_multi_hop(transfer_in_future, request, false, swap_id); });
   }

   fn swap_multi_hop_private(
        private view_key: scalar,
        private counter: u32,
        private blinded_address: address,
        private token_in_record: dyn record,
        public token_in: field,
        public token_out: field,
        public amount_in: u128,
        public amount_out_min: u128,
        public hop0: SwapHop,
        public hop1: SwapHop,
        public hop2: SwapHop,
        public hop_count: u8,
        public nonce: u64,
        public deadline: u32
   ) -> (public field, dyn record, Final) {
        // Derive `r` from contract address, view key , and counter.
        let r: scalar = BHP256::hash_to_scalar_raw([self.address as field, view_key as field, counter as field]);
        // Compute blinded address — unlinkable to self.signer without knowing r.
        let expected_blinded_address: address = BHP256::commit_to_address(self.signer, r);
        // Ensure that the blinded address is correctly derived from the signer and `r`.
        assert_eq(expected_blinded_address, blinded_address);

        // Check that the view key is associated with the signer.
        let calculated_address = Aleo::generator() * view_key;
        assert(calculated_address as address == self.signer);

        // Construct request with blinded address as both recipient and caller
        let request: SwapMultiHopRequest = SwapMultiHopRequest {
            token_in: token_in,
            token_out: token_out,
            amount_in: amount_in,
            amount_out_min: amount_out_min,
            recipient: blinded_address,
            hop0: hop0,
            hop1: hop1,
            hop2: hop2,
            hop_count: hop_count,
            nonce: nonce,
            deadline: deadline,
            caller: blinded_address
        };

        let swap_id: field = BHP256::hash_to_field(SwapMultiHopRequest {
            token_in: token_in,
            token_out: token_out,
            amount_in: amount_in,
            amount_out_min: amount_out_min,
            recipient: blinded_address,
            hop0: hop0,
            hop1: hop1,
            hop2: hop2,
            hop_count: hop_count,
            nonce: nonce,
            deadline: deadline,
            caller: blinded_address
        });

        // Perform the private transfer for token_in to initiate the multi-hop swap.
        let (change, meta, transfer_in_future): (dyn record, dyn record, Final) = ARC20@(token_in)::transfer_private_to_public(token_in_record, self.address, amount_in);

        return (swap_id, change, final { finalize_swap_multi_hop(transfer_in_future, request, true, swap_id);});
   }

   fn claim_multi_hop_output(
        public swap_id: field,
        public token_in: field,
        public token_out: field,
        public amount_out: u128,
        public amount_remaining: u128,
        public recipient: address
   ) -> Final {
        // Transfer output tokens to recipient
        let transfer_out_future: Final = ARC20@(token_out)::transfer_public(recipient, amount_out);
        // Refund remaining input tokens (if any)
        let transfer_refund_future: Final = ARC20@(token_in)::transfer_public(recipient, amount_remaining);

        let caller = self.caller;
        return final { finalize_claim_swap_output(transfer_out_future, transfer_refund_future, swap_id, token_in, token_out, amount_out, amount_remaining, recipient, caller); };
   }

   // Private multi-hop claim: same pattern as claim_swap_output_private.
   // Caller proves blinded address ownership via view_key + counter.
   // Tokens issued as private records to self.signer — no separate recipient address needed.
   fn claim_multi_hop_output_private(
        private view_key: scalar,
        private counter: u32,
        private blinded_address: address,
        public swap_id: field,
        public token_in: field,
        public token_out: field,
        public amount_out: u128,
        public amount_remaining: u128
   ) -> (dyn record, dyn record, Final) {
        // Derive `r` from contract address, view key , and counter.
        let r: scalar = BHP256::hash_to_scalar_raw([self.address as field, view_key as field, counter as field]);
        // Compute blinded address — unlinkable to self.signer without knowing r.
        let expected_blinded_address: address = BHP256::commit_to_address(self.signer, r);
        // Ensure that the blinded address is correctly derived from the signer and `r`.
        assert_eq(expected_blinded_address, blinded_address);

        // Check that the view key is associated with the signer.
        let calculated_address = Aleo::generator() * view_key;
        assert(calculated_address as address == self.signer);

        // Transfer output tokens as private record to self.signer
        let (out_record, transfer_out_future): (dyn record, Final) = ARC20@(token_out)::transfer_public_to_private(self.signer, amount_out);
        // Refund remaining input tokens as private record to self.signer
        let (refund_record, transfer_refund_future): (dyn record, Final) = ARC20@(token_in)::transfer_public_to_private(self.signer, amount_remaining);

        return (out_record, refund_record, final { finalize_claim_swap_output(
            transfer_out_future, transfer_refund_future,
            swap_id, token_in, token_out, amount_out, amount_remaining,
            blinded_address, blinded_address
        );});
   }
}

//--------------------------------------FUNCTIONS----------------------------------------//
//                                                                                       //
//---------------------------------------------------------------------------------------//
final fn finalize_initialize_admin(new_admin: address) {
    // Can only set admin if not already set
    assert(!Mapping::contains(admin, true));
    assert_eq(new_admin, DEPLOYER);
    admin.set(true, new_admin);
}

final fn finalize_transfer_admin(caller: address, new_admin: address) {
    let current_admin: address = admin.get(true);
    assert(caller == current_admin);
    admin.set(true, new_admin);
}

final fn finalize_add_tick_spacing(caller: address, tick_spacing: u32) {
    let current_admin: address = admin.get(true);
    assert(caller == current_admin);
    assert(tick_spacing > 0u32);
    tick_spacings.set(tick_spacing, true);
}

final fn finalize_add_fee_tier(caller: address, fee: u16) {
    let current_admin: address = admin.get(true);
    assert(caller == current_admin);
    fee_tiers.set(fee, true);
}
final fn finalize_set_pool_enabled(caller: address, pool_key: field, enabled: bool) {
    let current_admin: address = admin.get(true);
    assert(caller == current_admin);
    let pool_state: PoolState = pools.get(pool_key);
    pools.set(pool_key, PoolState {
        token0: pool_state.token0,
        token1: pool_state.token1,
        fee: pool_state.fee,
        enabled: enabled
    });
}

final fn finalize_set_fee_protocol(caller: address, pool_key: field, fee_protocol: u8) {
    let current_admin: address = admin.get(true);
    assert(caller == current_admin);
    // fee_protocol must be 0 (disabled) or between 4-10 (representing 4/16 to 10/16 of fees)
    assert(fee_protocol == 0u8 || (fee_protocol >= 4u8 && fee_protocol <= 10u8));
    let slot: Slot = slots.get(pool_key);
    slots.set(pool_key, Slot {
        tick: slot.tick,
        tick_spacing: slot.tick_spacing,
        sqrt_price: slot.sqrt_price,
        fee_protocol: fee_protocol,
        liquidity: slot.liquidity,
        fee_growth_global0_x_128: slot.fee_growth_global0_x_128,
        fee_growth_global1_x_128: slot.fee_growth_global1_x_128,
        max_liquidity_per_tick: slot.max_liquidity_per_tick,
        protocol_fees0: slot.protocol_fees0,
        protocol_fees1: slot.protocol_fees1
    });
}

final fn finalize_collect_protocol(
    transfer0_future: Final,
    transfer1_future: Final,
    caller: address,
    pool_key: field,
    amount0_requested: u128,
    amount1_requested: u128,
    token0_id: field,
    token1_id: field
) {
    // Validate admin and amounts BEFORE executing transfers
    let current_admin: address = admin.get(true);
    assert(caller == current_admin);

    let pool_state: PoolState = pools.get(pool_key);
    assert(pool_state.token0 == token0_id && pool_state.token1 == token1_id);

    let slot: Slot = slots.get(pool_key);
    assert(amount0_requested <= slot.protocol_fees0);
    assert(amount1_requested <= slot.protocol_fees1);

    // Now execute transfers after validation passes
    transfer0_future.run();
    transfer1_future.run();

    slots.set(pool_key, Slot {
        tick: slot.tick,
        tick_spacing: slot.tick_spacing,
        sqrt_price: slot.sqrt_price,
        fee_protocol: slot.fee_protocol,
        liquidity: slot.liquidity,
        fee_growth_global0_x_128: slot.fee_growth_global0_x_128,
        fee_growth_global1_x_128: slot.fee_growth_global1_x_128,
        max_liquidity_per_tick: slot.max_liquidity_per_tick,
        protocol_fees0: slot.protocol_fees0 - amount0_requested,
        protocol_fees1: slot.protocol_fees1 - amount1_requested
    });
}

final fn finalize_create_pool(token0:field,token1:field,fee:u16,initial_sqrt_price:u128,tick_spacing:u32,initial_tick:i32,tick_lower_bound:u128,tick_upper_bound:u128){
    let (sorted_token0, sorted_token1) = token0 < token1 ? (token0, token1) : (token1, token0);
    let pool_key = get_pool_key(sorted_token0, sorted_token1, fee);

    assert_neq(token0, token1);
    assert(!Mapping::get_or_use(initialized_pools, pool_key, false));
    assert(Mapping::get_or_use(tick_spacings, tick_spacing, false));
    assert(Mapping::get_or_use(fee_tiers, fee, false));


    assert(initial_sqrt_price >= tick_lower_bound && initial_sqrt_price < tick_upper_bound);
    assert(initial_tick % tick_spacing as i32 == 0i32);


    let tick_range: u128 = 1774544u128;
    let num_ticks: u128 = tick_range / tick_spacing as u128;
    let max_liq_per_tick: u128 = 340282366920938463463374607431768211455u128 / num_ticks;

    initialized_pools.set(pool_key, true);
    pools.set(pool_key, PoolState { token0: sorted_token0, token1: sorted_token1, fee, enabled: true });
    slots.set(pool_key, Slot { sqrt_price: initial_sqrt_price, tick: initial_tick, fee_protocol: 0u8, tick_spacing, liquidity: 0u128, fee_growth_global0_x_128: 0u128, fee_growth_global1_x_128: 0u128, max_liquidity_per_tick: max_liq_per_tick, protocol_fees0: 0u128, protocol_fees1: 0u128 });
}

final fn finalize_mint(
    transfer0_future: Final,
    transfer1_future: Final,
    params: MintPositionRequest,
    token_id: field,
    token0_id: field,
    token1_id: field
){
    transfer0_future.run();
    transfer1_future.run();

    let pool_state = pools.get(params.pool);
    assert(pool_state.enabled);
    assert(pool_state.token0 == token0_id);
    assert(pool_state.token1 == token1_id);

    let slot = slots.get(params.pool);


    assert(params.tick_lower % slot.tick_spacing as i32 == 0i32);
    assert(params.tick_upper % slot.tick_spacing as i32 == 0i32);
    check_ticks(params.tick_lower, params.tick_upper);


    let sqrt_ratio_a = get_sqrt_price_at_tick(params.tick_lower);
    let sqrt_ratio_b = get_sqrt_price_at_tick(params.tick_upper);
    let liquidity = liquidity_math::get_liquidity_for_amounts(slot.sqrt_price, sqrt_ratio_a, sqrt_ratio_b, params.amount0_desired, params.amount1_desired);
    assert(liquidity > 0u128);

    let (amount0, amount1) = liquidity_math::get_amounts_for_liquidity(slot.sqrt_price, sqrt_ratio_a, sqrt_ratio_b, liquidity);
    assert(amount0 <= params.amount0_desired && amount1 <= params.amount1_desired);
    assert(amount0 >= params.amount0_min && amount1 >= params.amount1_min);


    let tick_lower_key = get_tick_key(params.pool, params.tick_lower);
    let tick_upper_key = get_tick_key(params.pool, params.tick_upper);
    let tick_lower = Mapping::get_or_use(ticks, tick_lower_key, Tick { pool: params.pool, liquidity_net: 0i128, liquidity_gross: 0u128, tick: params.tick_lower, fee_growth_outside0_128: 0u128, fee_growth_outside1_128: 0u128 });
    let tick_upper = Mapping::get_or_use(ticks, tick_upper_key, Tick { pool: params.pool, liquidity_net: 0i128, liquidity_gross: 0u128, tick: params.tick_upper, fee_growth_outside0_128: 0u128, fee_growth_outside1_128: 0u128 });


    let tick_lower_fee0 = (tick_lower.liquidity_gross == 0u128 && params.tick_lower <= slot.tick) ? slot.fee_growth_global0_x_128 : tick_lower.fee_growth_outside0_128;
    let tick_lower_fee1 = (tick_lower.liquidity_gross == 0u128 && params.tick_lower <= slot.tick) ? slot.fee_growth_global1_x_128 : tick_lower.fee_growth_outside1_128;
    let tick_upper_fee0 = (tick_upper.liquidity_gross == 0u128 && params.tick_upper <= slot.tick) ? slot.fee_growth_global0_x_128 : tick_upper.fee_growth_outside0_128;
    let tick_upper_fee1 = (tick_upper.liquidity_gross == 0u128 && params.tick_upper <= slot.tick) ? slot.fee_growth_global1_x_128 : tick_upper.fee_growth_outside1_128;


    let new_tick_lower_gross: u128 = tick_lower.liquidity_gross + liquidity;
    let new_tick_upper_gross: u128 = tick_upper.liquidity_gross + liquidity;


    assert(new_tick_lower_gross <= slot.max_liquidity_per_tick);
    assert(new_tick_upper_gross <= slot.max_liquidity_per_tick);

    ticks.set(tick_lower_key, Tick { pool: params.pool, liquidity_net: tick_lower.liquidity_net + liquidity as i128, liquidity_gross: new_tick_lower_gross, tick: params.tick_lower, fee_growth_outside0_128: tick_lower_fee0, fee_growth_outside1_128: tick_lower_fee1 });
    ticks.set(tick_upper_key, Tick { pool: params.pool, liquidity_net: tick_upper.liquidity_net - liquidity as i128, liquidity_gross: new_tick_upper_gross, tick: params.tick_upper, fee_growth_outside0_128: tick_upper_fee0, fee_growth_outside1_128: tick_upper_fee1 });


    let updated_tick_lower = ticks.get(tick_lower_key);
    let updated_tick_upper = ticks.get(tick_upper_key);
    let (fee_growth_inside0, fee_growth_inside1) = get_fee_growth_inside(updated_tick_lower, updated_tick_upper, slot.tick, slot.fee_growth_global0_x_128, slot.fee_growth_global1_x_128);

    assert(!Mapping::contains(positions, token_id));
    let excess0: u128 = params.amount0_desired - amount0;
    let excess1: u128 = params.amount1_desired - amount1;
    positions.set(token_id, Position { token_id: token_id, pool: params.pool, tick_lower: params.tick_lower, tick_upper: params.tick_upper, liquidity: liquidity, fee_growth_inside0_last_128: fee_growth_inside0, fee_growth_inside1_last_128: fee_growth_inside1, tokens_owed0: excess0, tokens_owed1: excess1 });

    let new_pool_liquidity = (slot.tick >= params.tick_lower && slot.tick < params.tick_upper) ? slot.liquidity + liquidity : slot.liquidity;
    slots.set(params.pool, Slot { tick: slot.tick, tick_spacing: slot.tick_spacing, sqrt_price: slot.sqrt_price, fee_protocol: slot.fee_protocol, liquidity: new_pool_liquidity, fee_growth_global0_x_128: slot.fee_growth_global0_x_128, fee_growth_global1_x_128: slot.fee_growth_global1_x_128, max_liquidity_per_tick: slot.max_liquidity_per_tick, protocol_fees0: slot.protocol_fees0, protocol_fees1: slot.protocol_fees1 });
}

final fn finalize_decrease_liquidity(
    token_id: field,
    pool: field,
    tick_lower: i32,
    tick_upper: i32,
    liquidity_to_remove: u128,
    amount0_min: u128,
    amount1_min: u128
) {
    let slot = slots.get(pool);
    let sqrt_ratio_a = get_sqrt_price_at_tick(tick_lower);
    let sqrt_ratio_b = get_sqrt_price_at_tick(tick_upper);
    let existing_position = positions.get(token_id);

    assert(existing_position.pool == pool && existing_position.tick_lower == tick_lower && existing_position.tick_upper == tick_upper);
    assert(liquidity_to_remove <= existing_position.liquidity);

    let (amount0, amount1) = liquidity_math::get_amounts_for_liquidity(slot.sqrt_price, sqrt_ratio_a, sqrt_ratio_b, liquidity_to_remove);
    assert(amount0 >= amount0_min && amount1 >= amount1_min);

    // Update ticks
    let tick_lower_key = get_tick_key(pool, tick_lower);
    let tick_upper_key = get_tick_key(pool, tick_upper);
    let tick_lower_data = ticks.get(tick_lower_key);
    let tick_upper_data = ticks.get(tick_upper_key);

    ticks.set(tick_lower_key, Tick { pool: tick_lower_data.pool, liquidity_net: tick_lower_data.liquidity_net - liquidity_to_remove as i128, liquidity_gross: tick_lower_data.liquidity_gross - liquidity_to_remove, tick: tick_lower_data.tick, fee_growth_outside0_128: tick_lower_data.fee_growth_outside0_128, fee_growth_outside1_128: tick_lower_data.fee_growth_outside1_128 });
    ticks.set(tick_upper_key, Tick { pool: tick_upper_data.pool, liquidity_net: tick_upper_data.liquidity_net + liquidity_to_remove as i128, liquidity_gross: tick_upper_data.liquidity_gross - liquidity_to_remove, tick: tick_upper_data.tick, fee_growth_outside0_128: tick_upper_data.fee_growth_outside0_128, fee_growth_outside1_128: tick_upper_data.fee_growth_outside1_128 });

    let updated_tick_lower = ticks.get(tick_lower_key);
    let updated_tick_upper = ticks.get(tick_upper_key);
    let (fee_growth_inside0, fee_growth_inside1) = get_fee_growth_inside(updated_tick_lower, updated_tick_upper, slot.tick, slot.fee_growth_global0_x_128, slot.fee_growth_global1_x_128);

    let tokens_owed0 = existing_position.tokens_owed0 + ((wrapping_sub(fee_growth_inside0, existing_position.fee_growth_inside0_last_128)) * existing_position.liquidity) / liquidity_math::Q128 + amount0;
    let tokens_owed1 = existing_position.tokens_owed1 + ((wrapping_sub(fee_growth_inside1, existing_position.fee_growth_inside1_last_128)) * existing_position.liquidity) / liquidity_math::Q128 + amount1;

    positions.set(token_id, Position { token_id: token_id, pool: pool, tick_lower: tick_lower, tick_upper: tick_upper, liquidity: existing_position.liquidity - liquidity_to_remove, fee_growth_inside0_last_128: fee_growth_inside0, fee_growth_inside1_last_128: fee_growth_inside1, tokens_owed0: tokens_owed0, tokens_owed1: tokens_owed1 });

    let new_pool_liquidity = (slot.tick >= tick_lower && slot.tick < tick_upper) ? slot.liquidity - liquidity_to_remove : slot.liquidity;
    slots.set(pool, Slot { tick: slot.tick, tick_spacing: slot.tick_spacing, sqrt_price: slot.sqrt_price, fee_protocol: slot.fee_protocol, liquidity: new_pool_liquidity, fee_growth_global0_x_128: slot.fee_growth_global0_x_128, fee_growth_global1_x_128: slot.fee_growth_global1_x_128, max_liquidity_per_tick: slot.max_liquidity_per_tick, protocol_fees0: slot.protocol_fees0, protocol_fees1: slot.protocol_fees1 });
}

final fn finalize_increase_liquidity(
    transfer0_future: Final,
    transfer1_future: Final,
    token_id: field,
    pool: field,
    tick_lower: i32,
    tick_upper: i32,
    amount0_desired: u128,
    amount1_desired: u128,
    amount0_min: u128,
    amount1_min: u128,
    token0_id: field,
    token1_id: field
) {
    transfer0_future.run();
    transfer1_future.run();

    let pool_state = pools.get(pool);
    assert(pool_state.enabled);
    assert(pool_state.token0 == token0_id);
    assert(pool_state.token1 == token1_id);

    let slot = slots.get(pool);
    let existing_position = positions.get(token_id);

    assert(existing_position.pool == pool && existing_position.tick_lower == tick_lower && existing_position.tick_upper == tick_upper);

    let sqrt_ratio_a = get_sqrt_price_at_tick(tick_lower);
    let sqrt_ratio_b = get_sqrt_price_at_tick(tick_upper);
    let liquidity = liquidity_math::get_liquidity_for_amounts(slot.sqrt_price, sqrt_ratio_a, sqrt_ratio_b, amount0_desired, amount1_desired);
    assert(liquidity > 0u128);

    let (amount0, amount1) = liquidity_math::get_amounts_for_liquidity(slot.sqrt_price, sqrt_ratio_a, sqrt_ratio_b, liquidity);
    assert(amount0 <= amount0_desired && amount1 <= amount1_desired);
    assert(amount0 >= amount0_min && amount1 >= amount1_min);

    // Update ticks
    let tick_lower_key = get_tick_key(pool, tick_lower);
    let tick_upper_key = get_tick_key(pool, tick_upper);
    let tick_lower_data = ticks.get(tick_lower_key);
    let tick_upper_data = ticks.get(tick_upper_key);

    let new_tick_lower_gross: u128 = tick_lower_data.liquidity_gross + liquidity;
    let new_tick_upper_gross: u128 = tick_upper_data.liquidity_gross + liquidity;

    assert(new_tick_lower_gross <= slot.max_liquidity_per_tick);
    assert(new_tick_upper_gross <= slot.max_liquidity_per_tick);

    ticks.set(tick_lower_key, Tick { pool: tick_lower_data.pool, liquidity_net: tick_lower_data.liquidity_net + liquidity as i128, liquidity_gross: new_tick_lower_gross, tick: tick_lower_data.tick, fee_growth_outside0_128: tick_lower_data.fee_growth_outside0_128, fee_growth_outside1_128: tick_lower_data.fee_growth_outside1_128 });
    ticks.set(tick_upper_key, Tick { pool: tick_upper_data.pool, liquidity_net: tick_upper_data.liquidity_net - liquidity as i128, liquidity_gross: new_tick_upper_gross, tick: tick_upper_data.tick, fee_growth_outside0_128: tick_upper_data.fee_growth_outside0_128, fee_growth_outside1_128: tick_upper_data.fee_growth_outside1_128 });

    // Calculate fee growth inside and update position
    let updated_tick_lower = ticks.get(tick_lower_key);
    let updated_tick_upper = ticks.get(tick_upper_key);
    let (fee_growth_inside0, fee_growth_inside1) = get_fee_growth_inside(updated_tick_lower, updated_tick_upper, slot.tick, slot.fee_growth_global0_x_128, slot.fee_growth_global1_x_128);

    // Collect any accrued fees and add excess tokens to tokens_owed
    let accrued_fees0 = ((wrapping_sub(fee_growth_inside0, existing_position.fee_growth_inside0_last_128)) * existing_position.liquidity) / liquidity_math::Q128;
    let accrued_fees1 = ((wrapping_sub(fee_growth_inside1, existing_position.fee_growth_inside1_last_128)) * existing_position.liquidity) / liquidity_math::Q128;
    let excess0: u128 = amount0_desired - amount0;
    let excess1: u128 = amount1_desired - amount1;

    positions.set(token_id, Position { token_id: token_id, pool: pool, tick_lower: tick_lower, tick_upper: tick_upper, liquidity: existing_position.liquidity + liquidity, fee_growth_inside0_last_128: fee_growth_inside0, fee_growth_inside1_last_128: fee_growth_inside1, tokens_owed0: existing_position.tokens_owed0 + accrued_fees0 + excess0, tokens_owed1: existing_position.tokens_owed1 + accrued_fees1 + excess1 });

    let new_pool_liquidity = (slot.tick >= tick_lower && slot.tick < tick_upper) ? slot.liquidity + liquidity : slot.liquidity;
    slots.set(pool, Slot { tick: slot.tick, tick_spacing: slot.tick_spacing, sqrt_price: slot.sqrt_price, fee_protocol: slot.fee_protocol, liquidity: new_pool_liquidity, fee_growth_global0_x_128: slot.fee_growth_global0_x_128, fee_growth_global1_x_128: slot.fee_growth_global1_x_128, max_liquidity_per_tick: slot.max_liquidity_per_tick, protocol_fees0: slot.protocol_fees0, protocol_fees1: slot.protocol_fees1 });
}

final fn finalize_collect(
    transfer0_future: Final,
    transfer1_future: Final,
    token_id: field,
    pool: field,
    tick_lower: i32,
    tick_upper: i32,
    amount0_requested: u128,
    amount1_requested: u128,
    token0_id: field,
    token1_id: field
) {
    transfer0_future.run();
    transfer1_future.run();

    let pool_state = pools.get(pool);
    assert(pool_state.token0 == token0_id && pool_state.token1 == token1_id);

    let slot = slots.get(pool);
    let existing_position = positions.get(token_id);
    assert(existing_position.pool == pool && existing_position.tick_lower == tick_lower && existing_position.tick_upper == tick_upper);

    let tick_lower_data = ticks.get(get_tick_key(pool, tick_lower));
    let tick_upper_data = ticks.get(get_tick_key(pool, tick_upper));
    let (fee_growth_inside0, fee_growth_inside1) = get_fee_growth_inside(tick_lower_data, tick_upper_data, slot.tick, slot.fee_growth_global0_x_128, slot.fee_growth_global1_x_128);

    let total_owed0 = existing_position.tokens_owed0 + ((wrapping_sub(fee_growth_inside0, existing_position.fee_growth_inside0_last_128)) * existing_position.liquidity) / liquidity_math::Q128;
    let total_owed1 = existing_position.tokens_owed1 + ((wrapping_sub(fee_growth_inside1, existing_position.fee_growth_inside1_last_128)) * existing_position.liquidity) / liquidity_math::Q128;
    assert(amount0_requested <= total_owed0 && amount1_requested <= total_owed1);

    positions.set(token_id, Position { token_id: token_id, pool: pool, tick_lower: tick_lower, tick_upper: tick_upper, liquidity: existing_position.liquidity, fee_growth_inside0_last_128: fee_growth_inside0, fee_growth_inside1_last_128: fee_growth_inside1, tokens_owed0: total_owed0 - amount0_requested, tokens_owed1: total_owed1 - amount1_requested });
}

final fn finalize_burn(token_id: field) {
    let existing_position = positions.get(token_id);

    assert(existing_position.liquidity == 0u128);
    assert(existing_position.tokens_owed0 == 0u128);
    assert(existing_position.tokens_owed1 == 0u128);

    Mapping::remove(positions, token_id);
}

final fn finalize_swap(
    transfer_in_future: Final,
    request: SwapRequest,
    is_blinded: bool,
    token0_id: field,
    token1_id: field,
    swap_id: field,
    token_in: field,
    token_out: field,
    caller: address
) {
    transfer_in_future.run();

    // Validate deadline
    assert(block.height <= request.deadline);

    let pool_state: PoolState = pools.get(request.pool);
    assert(pool_state.enabled);
    assert(pool_state.token0 == token0_id);
    assert(pool_state.token1 == token1_id);

    let slot: Slot = slots.get(request.pool);
    let fee_pips: u32 = pool_state.fee as u32;
    let lim: u128 = request.sqrt_price_limit;
    let z: bool = request.zero_for_one;

    assert(z ? lim < slot.sqrt_price : lim > slot.sqrt_price);

    // Initialize swap state
    let tick_hints: [i32; 2] = [request.tick_hint_0, request.tick_hint_1];


    assert(z ? request.tick_hint_0 <= slot.tick : request.tick_hint_0 >= slot.tick);
    assert(z ? request.tick_hint_1 <= request.tick_hint_0 : request.tick_hint_1 >= request.tick_hint_0);

    let sp: u128 = slot.sqrt_price;
    let rem: u128 = request.amount_in;
    let out: u128 = 0u128;
    let fg: u128 = z ? slot.fee_growth_global0_x_128 : slot.fee_growth_global1_x_128;
    let liq: u128 = slot.liquidity;
    let tk: i32 = slot.tick;
    let crossed: bool = true;
    let pf: u128 = 0u128;  // accumulated protocol fees for this swap


    for i: u8 in 0u8..2u8 {
        let tick_hint: i32 = tick_hints[i as u32];
        let t: Tick = ticks.get(get_tick_key(request.pool, tick_hint));
        let sp_t: u128 = get_sqrt_price_at_tick(tick_hint);
        let sp_tc: u128 = z ? (sp_t < lim ? lim : sp_t) : (sp_t > lim ? lim : sp_t);

        let (sp_new, ai, ao, f): (u128, u128, u128, u128) = rem > 0u128 && liq > 0u128 && crossed
            ? swap_math::compute_swap_step(sp, sp_tc, liq, rem, fee_pips, z)
            : (sp, 0u128, 0u128, 0u128);

        // Split fee between protocol and LPs if fee_protocol > 0
        let protocol_fee: u128 = slot.fee_protocol > 0u8 ? f * slot.fee_protocol as u128 / 16u128 : 0u128;
        let lp_fee: u128 = f - protocol_fee;
        pf = crossed ? pf + protocol_fee : pf;

        rem = crossed ? rem - ai - f : rem;
        out = crossed ? out + ao : out;
        let fd: u128 = liq > 0u128 ? (lp_fee * liquidity_math::Q128) / liq : 0u128;
        fg = crossed ? fg + fd : fg;

        let c: bool = crossed && sp_new == sp_t && sp_t != lim;
        let ut: Tick = c ? Tick {
            pool: t.pool,
            liquidity_net: t.liquidity_net,
            liquidity_gross: t.liquidity_gross,
            tick: t.tick,
            fee_growth_outside0_128: z ? wrapping_sub(fg, t.fee_growth_outside0_128) : t.fee_growth_outside0_128,
            fee_growth_outside1_128: z ? t.fee_growth_outside1_128 : wrapping_sub(fg, t.fee_growth_outside1_128)
        } : t;
        ticks.set(get_tick_key(request.pool, tick_hint), c ? ut : t);

        let ld: i128 = z ? (0i128 - t.liquidity_net) : t.liquidity_net;
        liq = c ? liquidity_math::add_delta(liq, ld) : liq;
        tk = c ? (z ? tick_hint - 1i32 : tick_hint) : get_tick_at_sqrt_price(sp_new);
        sp = sp_new;
        crossed = c;
    }


    assert(out >= request.amount_out_min);

    // Update protocol fees based on swap direction
    let new_pf0: u128 = z ? slot.protocol_fees0 + pf : slot.protocol_fees0;
    let new_pf1: u128 = z ? slot.protocol_fees1 : slot.protocol_fees1 + pf;

    let updated_slot: Slot = Slot {
        tick: tk,
        tick_spacing: slot.tick_spacing,
        sqrt_price: sp,
        fee_protocol: slot.fee_protocol,
        liquidity: liq,
        fee_growth_global0_x_128: z ? fg : slot.fee_growth_global0_x_128,
        fee_growth_global1_x_128: z ? slot.fee_growth_global1_x_128 : fg,
        max_liquidity_per_tick: slot.max_liquidity_per_tick,
        protocol_fees0: new_pf0,
        protocol_fees1: new_pf1
    };
    slots.set(request.pool, updated_slot);

    assert(!Mapping::contains(swap_outputs, swap_id));
    swap_outputs.set(swap_id, SwapOutput { recipient: request.recipient, caller: caller, token_in: token_in, token_out: token_out, amount_out: out, amount_remaining: rem });

    // Check if the blinded address has already been used.
    if is_blinded {
        assert(!Mapping::contains(used_blinded_addresses, caller));
        Mapping::set(used_blinded_addresses, caller, true);
    }
}

final fn finalize_claim_swap_output(
    transfer_out_future: Final,
    transfer_refund_future: Final,
    swap_id: field,
    token_in: field,
    token_out: field,
    amount_out: u128,
    amount_remaining: u128,
    recipient: address,
    caller: address
) {
    transfer_out_future.run();
    transfer_refund_future.run();

    let output: SwapOutput = swap_outputs.get(swap_id);

    // Only the original caller can claim their swap output
    assert(output.caller == caller);
    assert(output.recipient == recipient);
    assert(output.token_in == token_in);
    assert(output.token_out == token_out);
    assert(output.amount_out == amount_out);
    assert(output.amount_remaining == amount_remaining);

    Mapping::remove(swap_outputs, swap_id);
}

final fn finalize_swap_multi_hop(
    transfer_in_future: Final,
    request: SwapMultiHopRequest,
    is_blinded: bool,
    swap_id: field
) {
    transfer_in_future.run();
    assert(block.height <= request.deadline);
    assert(request.hop_count >= 2u8 && request.hop_count <= 3u8);

    let amt: u128 = request.amount_in;

    let pool0: PoolState = pools.get(request.hop0.pool);
    assert(pool0.enabled);
    // Validate hop0 input token matches request.token_in
    let hop0_token_in: field = request.hop0.zero_for_one ? pool0.token0 : pool0.token1;
    let hop0_token_out: field = request.hop0.zero_for_one ? pool0.token1 : pool0.token0;
    assert(hop0_token_in == request.token_in);
    let slot0: Slot = slots.get(request.hop0.pool);
    let fp0: u32 = pool0.fee as u32;
    let lim0: u128 = request.hop0.sqrt_price_limit;

    assert(request.hop0.zero_for_one ? lim0 < slot0.sqrt_price : lim0 > slot0.sqrt_price);

    assert(request.hop0.zero_for_one ? request.hop0.tick_hint_0 <= slot0.tick : request.hop0.tick_hint_0 >= slot0.tick);
    assert(request.hop0.zero_for_one ? request.hop0.tick_hint_1 <= request.hop0.tick_hint_0 : request.hop0.tick_hint_1 >= request.hop0.tick_hint_0);
    let th0: [i32; 2] = [request.hop0.tick_hint_0, request.hop0.tick_hint_1];
    let sp0: u128 = slot0.sqrt_price;
    let rem0: u128 = amt;
    let out0: u128 = 0u128;
    let fg0: u128 = request.hop0.zero_for_one ? slot0.fee_growth_global0_x_128 : slot0.fee_growth_global1_x_128;
    let liq0: u128 = slot0.liquidity;
    let tk0: i32 = slot0.tick;
    let cr0: bool = true;
    let pf0: u128 = 0u128;
    for i: u8 in 0u8..2u8 {
        let hint: i32 = th0[i as u32];
        let t: Tick = ticks.get(get_tick_key(request.hop0.pool, hint));
        let sp_t: u128 = get_sqrt_price_at_tick(hint);
        // Clamp tick target to sqrt_price_limit
        let sp_tc0: u128 = request.hop0.zero_for_one ? (sp_t < lim0 ? lim0 : sp_t) : (sp_t > lim0 ? lim0 : sp_t);
        let (sp_new, ai, ao, f): (u128, u128, u128, u128) = rem0 > 0u128 && liq0 > 0u128 && cr0
            ? swap_math::compute_swap_step(sp0, sp_tc0, liq0, rem0, fp0, request.hop0.zero_for_one)
            : (sp0, 0u128, 0u128, 0u128);
        let prot_fee: u128 = slot0.fee_protocol > 0u8 ? f * slot0.fee_protocol as u128 / 16u128 : 0u128;
        let lp_fee: u128 = f - prot_fee;
        pf0 = cr0 ? pf0 + prot_fee : pf0;
        rem0 = cr0 ? rem0 - ai - f : rem0;
        out0 = cr0 ? out0 + ao : out0;
        let fd: u128 = liq0 > 0u128 ? (lp_fee * liquidity_math::Q128) / liq0 : 0u128;
        fg0 = cr0 ? fg0 + fd : fg0;
        let c: bool = cr0 && sp_new == sp_t && sp_t != lim0;
        let ut: Tick = c ? Tick { pool: t.pool, liquidity_net: t.liquidity_net, liquidity_gross: t.liquidity_gross, tick: t.tick, fee_growth_outside0_128: request.hop0.zero_for_one ? wrapping_sub(fg0, t.fee_growth_outside0_128) : t.fee_growth_outside0_128, fee_growth_outside1_128: request.hop0.zero_for_one ? t.fee_growth_outside1_128 : wrapping_sub(fg0, t.fee_growth_outside1_128) } : t;
        ticks.set(get_tick_key(request.hop0.pool, hint), c ? ut : t);
        let ld: i128 = request.hop0.zero_for_one ? (0i128 - t.liquidity_net) : t.liquidity_net;
        liq0 = c ? liquidity_math::add_delta(liq0, ld) : liq0;
        tk0 = c ? (request.hop0.zero_for_one ? hint - 1i32 : hint) : get_tick_at_sqrt_price(sp_new);
        sp0 = sp_new;
        cr0 = c;
    }
    let npf0_0: u128 = request.hop0.zero_for_one ? slot0.protocol_fees0 + pf0 : slot0.protocol_fees0;
    let npf0_1: u128 = request.hop0.zero_for_one ? slot0.protocol_fees1 : slot0.protocol_fees1 + pf0;
    slots.set(request.hop0.pool, Slot { tick: tk0, tick_spacing: slot0.tick_spacing, sqrt_price: sp0, fee_protocol: slot0.fee_protocol, liquidity: liq0, fee_growth_global0_x_128: request.hop0.zero_for_one ? fg0 : slot0.fee_growth_global0_x_128, fee_growth_global1_x_128: request.hop0.zero_for_one ? slot0.fee_growth_global1_x_128 : fg0, max_liquidity_per_tick: slot0.max_liquidity_per_tick, protocol_fees0: npf0_0, protocol_fees1: npf0_1 });
    amt = out0;

    let pool1: PoolState = pools.get(request.hop1.pool);
    assert(pool1.enabled);
    // Validate hop1 input token matches hop0 output token
    let hop1_token_in: field = request.hop1.zero_for_one ? pool1.token0 : pool1.token1;
    let hop1_token_out: field = request.hop1.zero_for_one ? pool1.token1 : pool1.token0;
    assert(hop1_token_in == hop0_token_out);
    let slot1: Slot = slots.get(request.hop1.pool);
    let fp1: u32 = pool1.fee as u32;
    let lim1: u128 = request.hop1.sqrt_price_limit;
    // Validate sqrt_price_limit is in valid direction
    assert(request.hop1.zero_for_one ? lim1 < slot1.sqrt_price : lim1 > slot1.sqrt_price);
    // Validate tick hints direction for hop1
    assert(request.hop1.zero_for_one ? request.hop1.tick_hint_0 <= slot1.tick : request.hop1.tick_hint_0 >= slot1.tick);
    assert(request.hop1.zero_for_one ? request.hop1.tick_hint_1 <= request.hop1.tick_hint_0 : request.hop1.tick_hint_1 >= request.hop1.tick_hint_0);
    let th1: [i32; 2] = [request.hop1.tick_hint_0, request.hop1.tick_hint_1];
    let sp1: u128 = slot1.sqrt_price;
    let rem1: u128 = amt;
    let out1: u128 = 0u128;
    let fg1: u128 = request.hop1.zero_for_one ? slot1.fee_growth_global0_x_128 : slot1.fee_growth_global1_x_128;
    let liq1: u128 = slot1.liquidity;
    let tk1: i32 = slot1.tick;
    let cr1: bool = true;
    let pf1: u128 = 0u128;
    for j: u8 in 0u8..2u8 {
        let hint: i32 = th1[j as u32];
        let t: Tick = ticks.get(get_tick_key(request.hop1.pool, hint));
        let sp_t: u128 = get_sqrt_price_at_tick(hint);
        // Clamp tick target to sqrt_price_limit
        let sp_tc1: u128 = request.hop1.zero_for_one ? (sp_t < lim1 ? lim1 : sp_t) : (sp_t > lim1 ? lim1 : sp_t);
        let (sp_new, ai, ao, f): (u128, u128, u128, u128) = rem1 > 0u128 && liq1 > 0u128 && cr1
            ? swap_math::compute_swap_step(sp1, sp_tc1, liq1, rem1, fp1, request.hop1.zero_for_one)
            : (sp1, 0u128, 0u128, 0u128);
        let prot_fee: u128 = slot1.fee_protocol > 0u8 ? f * slot1.fee_protocol as u128 / 16u128 : 0u128;
        let lp_fee: u128 = f - prot_fee;
        pf1 = cr1 ? pf1 + prot_fee : pf1;
        rem1 = cr1 ? rem1 - ai - f : rem1;
        out1 = cr1 ? out1 + ao : out1;
        let fd: u128 = liq1 > 0u128 ? (lp_fee * liquidity_math::Q128) / liq1 : 0u128;
        fg1 = cr1 ? fg1 + fd : fg1;
        let c: bool = cr1 && sp_new == sp_t && sp_t != lim1;
        let ut: Tick = c ? Tick { pool: t.pool, liquidity_net: t.liquidity_net, liquidity_gross: t.liquidity_gross, tick: t.tick, fee_growth_outside0_128: request.hop1.zero_for_one ? wrapping_sub(fg1, t.fee_growth_outside0_128) : t.fee_growth_outside0_128, fee_growth_outside1_128: request.hop1.zero_for_one ? t.fee_growth_outside1_128 : wrapping_sub(fg1, t.fee_growth_outside1_128) } : t;
        ticks.set(get_tick_key(request.hop1.pool, hint), c ? ut : t);
        let ld: i128 = request.hop1.zero_for_one ? (0i128 - t.liquidity_net) : t.liquidity_net;
        liq1 = c ? liquidity_math::add_delta(liq1, ld) : liq1;
        tk1 = c ? (request.hop1.zero_for_one ? hint - 1i32 : hint) : get_tick_at_sqrt_price(sp_new);
        sp1 = sp_new;
        cr1 = c;
    }
    let npf1_0: u128 = request.hop1.zero_for_one ? slot1.protocol_fees0 + pf1 : slot1.protocol_fees0;
    let npf1_1: u128 = request.hop1.zero_for_one ? slot1.protocol_fees1 : slot1.protocol_fees1 + pf1;
    slots.set(request.hop1.pool, Slot { tick: tk1, tick_spacing: slot1.tick_spacing, sqrt_price: sp1, fee_protocol: slot1.fee_protocol, liquidity: liq1, fee_growth_global0_x_128: request.hop1.zero_for_one ? fg1 : slot1.fee_growth_global0_x_128, fee_growth_global1_x_128: request.hop1.zero_for_one ? slot1.fee_growth_global1_x_128 : fg1, max_liquidity_per_tick: slot1.max_liquidity_per_tick, protocol_fees0: npf1_0, protocol_fees1: npf1_1 });
    amt = out1;

    let do_hop2: bool = request.hop_count == 3u8;
    let pool2: PoolState = pools.get(request.hop2.pool);
    assert(!do_hop2 || pool2.enabled);
    // Validate hop2 token chain and final output token
    let hop2_token_in: field = request.hop2.zero_for_one ? pool2.token0 : pool2.token1;
    let hop2_token_out: field = request.hop2.zero_for_one ? pool2.token1 : pool2.token0;
    assert(!do_hop2 || hop2_token_in == hop1_token_out);
    let final_token_out: field = do_hop2 ? hop2_token_out : hop1_token_out;
    assert(final_token_out == request.token_out);
    let slot2: Slot = slots.get(request.hop2.pool);
    let fp2: u32 = pool2.fee as u32;
    let lim2: u128 = request.hop2.sqrt_price_limit;

    assert(!do_hop2 || (request.hop2.zero_for_one ? lim2 < slot2.sqrt_price : lim2 > slot2.sqrt_price));

    assert(!do_hop2 || (request.hop2.zero_for_one ? request.hop2.tick_hint_0 <= slot2.tick : request.hop2.tick_hint_0 >= slot2.tick));
    assert(!do_hop2 || (request.hop2.zero_for_one ? request.hop2.tick_hint_1 <= request.hop2.tick_hint_0 : request.hop2.tick_hint_1 >= request.hop2.tick_hint_0));
    let th2: [i32; 2] = [request.hop2.tick_hint_0, request.hop2.tick_hint_1];
    let sp2: u128 = slot2.sqrt_price;
    let rem2: u128 = amt;
    let out2: u128 = 0u128;
    let fg2: u128 = request.hop2.zero_for_one ? slot2.fee_growth_global0_x_128 : slot2.fee_growth_global1_x_128;
    let liq2: u128 = slot2.liquidity;
    let tk2: i32 = slot2.tick;
    let cr2: bool = do_hop2;
    let pf2: u128 = 0u128;
    for k: u8 in 0u8..2u8 {
        let hint: i32 = th2[k as u32];
        let t: Tick = ticks.get(get_tick_key(request.hop2.pool, hint));
        let sp_t: u128 = get_sqrt_price_at_tick(hint);

        let sp_tc2: u128 = request.hop2.zero_for_one ? (sp_t < lim2 ? lim2 : sp_t) : (sp_t > lim2 ? lim2 : sp_t);
        let (sp_new, ai, ao, f): (u128, u128, u128, u128) = rem2 > 0u128 && liq2 > 0u128 && cr2
            ? swap_math::compute_swap_step(sp2, sp_tc2, liq2, rem2, fp2, request.hop2.zero_for_one)
            : (sp2, 0u128, 0u128, 0u128);
        let prot_fee: u128 = slot2.fee_protocol > 0u8 ? f * slot2.fee_protocol as u128 / 16u128 : 0u128;
        let lp_fee: u128 = f - prot_fee;
        pf2 = cr2 ? pf2 + prot_fee : pf2;
        rem2 = cr2 ? rem2 - ai - f : rem2;
        out2 = cr2 ? out2 + ao : out2;
        let fd: u128 = liq2 > 0u128 ? (lp_fee * liquidity_math::Q128) / liq2 : 0u128;
        fg2 = cr2 ? fg2 + fd : fg2;
        let c: bool = cr2 && sp_new == sp_t && sp_t != lim2;
        let ut: Tick = c ? Tick { pool: t.pool, liquidity_net: t.liquidity_net, liquidity_gross: t.liquidity_gross, tick: t.tick, fee_growth_outside0_128: request.hop2.zero_for_one ? wrapping_sub(fg2, t.fee_growth_outside0_128) : t.fee_growth_outside0_128, fee_growth_outside1_128: request.hop2.zero_for_one ? t.fee_growth_outside1_128 : wrapping_sub(fg2, t.fee_growth_outside1_128) } : t;
        ticks.set(get_tick_key(request.hop2.pool, hint), c ? ut : t);
        let ld: i128 = request.hop2.zero_for_one ? (0i128 - t.liquidity_net) : t.liquidity_net;
        liq2 = c ? liquidity_math::add_delta(liq2, ld) : liq2;
        tk2 = c ? (request.hop2.zero_for_one ? hint - 1i32 : hint) : get_tick_at_sqrt_price(sp_new);
        sp2 = sp_new;
        cr2 = c;
    }
    let npf2_0: u128 = request.hop2.zero_for_one ? slot2.protocol_fees0 + pf2 : slot2.protocol_fees0;
    let npf2_1: u128 = request.hop2.zero_for_one ? slot2.protocol_fees1 : slot2.protocol_fees1 + pf2;
    slots.set(request.hop2.pool, do_hop2 ? Slot { tick: tk2, tick_spacing: slot2.tick_spacing, sqrt_price: sp2, fee_protocol: slot2.fee_protocol, liquidity: liq2, fee_growth_global0_x_128: request.hop2.zero_for_one ? fg2 : slot2.fee_growth_global0_x_128, fee_growth_global1_x_128: request.hop2.zero_for_one ? slot2.fee_growth_global1_x_128 : fg2, max_liquidity_per_tick: slot2.max_liquidity_per_tick, protocol_fees0: npf2_0, protocol_fees1: npf2_1 } : slot2);

    let final_amt: u128 = do_hop2 ? out2 : amt;
    assert(final_amt >= request.amount_out_min);
    assert(!Mapping::contains(swap_outputs, swap_id));
    let final_rem: u128 = do_hop2 ? rem2 : rem1;
    swap_outputs.set(swap_id, SwapOutput { recipient: request.recipient, caller: request.caller, token_in: request.token_in, token_out: request.token_out, amount_out: final_amt, amount_remaining: final_rem });

    // Check if the blinded address has already been used.
    if is_blinded {
        assert(!Mapping::contains(used_blinded_addresses, request.caller));
        Mapping::set(used_blinded_addresses, request.caller, true);
    }
}

fn get_sqrt_price_at_tick(tick: i32) -> u128 {
    let abs_tick_i32: i32=-1;


    if tick < 0i32 {
        abs_tick_i32 = 0i32 - tick;
    } else {
        abs_tick_i32 = tick;
    }

    assert(abs_tick_i32 >= 0i32);

    let abs_tick: u32 = abs_tick_i32 as u32;

    let low_bits: u32 = abs_tick & 0x3u32;
    let ratio: u128 = low_bits == 0u32 ? Q64 :
                      low_bits == 1u32 ? MAGIC_1 :
                      low_bits == 2u32 ? MAGIC_2 : START_3;

    // Bit 2 (value 4)
    if (abs_tick & 0x4u32 != 0u32) {
        ratio = (ratio * MAGIC_4) >> 63u8;
    }
    // Bit 3 (value 8)
    if (abs_tick & 0x8u32 != 0u32) {
        ratio = (ratio * MAGIC_8) >> 63u8;
    }
    // Bit 4 (value 16)
    if (abs_tick & 0x10u32 != 0u32) {
        ratio = (ratio * MAGIC_16) >> 63u8;
    }
    // Bit 5 (value 32)
    if (abs_tick & 0x20u32 != 0u32) {
        ratio = (ratio * MAGIC_32) >> 63u8;
    }
    // Bit 6 (value 64)
    if (abs_tick & 0x40u32 != 0u32) {
        ratio = (ratio * MAGIC_64) >> 63u8;
    }
    // Bit 7 (value 128)
    if (abs_tick & 0x80u32 != 0u32) {
        ratio = (ratio * MAGIC_128) >> 63u8;
    }
    // Bit 8 (value 256)
    if (abs_tick & 0x100u32 != 0u32) {
        ratio = (ratio * MAGIC_256) >> 63u8;
    }
    // Bit 9 (value 512)
    if (abs_tick & 0x200u32 != 0u32) {
        ratio = (ratio * MAGIC_512) >> 63u8;
    }
    // Bit 10 (value 1024)
    if (abs_tick & 0x400u32 != 0u32) {
        ratio = (ratio * MAGIC_1024) >> 63u8;
    }
    // Bit 11 (value 2048)
    if (abs_tick & 0x800u32 != 0u32) {
        ratio = (ratio * MAGIC_2048) >> 63u8;
    }
    // Bit 12 (value 4096)
    if (abs_tick & 0x1000u32 != 0u32) {
        ratio = (ratio * MAGIC_4096) >> 63u8;
    }
    // Bit 13 (value 8192)
    if (abs_tick & 0x2000u32 != 0u32) {
        ratio = (ratio * MAGIC_8192) >> 63u8;
    }
    // Bit 14 (value 16384)
    if (abs_tick & 0x4000u32 != 0u32) {
        ratio = (ratio * MAGIC_16384) >> 63u8;
    }
    // Bit 15 (value 32768)
    if (abs_tick & 0x8000u32 != 0u32) {
        ratio = (ratio * MAGIC_32768) >> 63u8;
    }
    // Bit 16 (value 65536)
    if (abs_tick & 0x10000u32 != 0u32) {
        ratio = (ratio * MAGIC_65536) >> 63u8;
    }
    // Bit 17 (value 131072)
    if (abs_tick & 0x20000u32 != 0u32) {
        ratio = (ratio * MAGIC_131072) >> 63u8;
    }
    // Bit 18 (value 262144)
    if (abs_tick & 0x40000u32 != 0u32) {
        ratio = (ratio * MAGIC_262144) >> 63u8;
    }
    // Bit 19 (value 524288)
    if (abs_tick & 0x80000u32 != 0u32) {
        ratio = (ratio * MAGIC_524288) >> 63u8;
    }

    // For positive ticks, we need the inverse: sqrt(1.0001^tick) = 1 / sqrt(1.0001^(-tick))
    // Q64 * Q64 = 2^126 which fits in u128 (max is ~2^128)
    if (tick > 0i32) {
        ratio = (Q64 * Q64) / ratio;
    }

    return ratio;
}

fn most_significant_bit(x: u128) -> u32 {
    let result: u32 = 0u32;
    let value: u128 = x;
    if (value >= 18446744073709551616u128) { value = value >> 64u8; result = result + 64u32; }
    if (value >= 4294967296u128) { value = value >> 32u8; result = result + 32u32; }
    if (value >= 65536u128) { value = value >> 16u8; result = result + 16u32; }
    if (value >= 256u128) { value = value >> 8u8; result = result + 8u32; }
    if (value >= 16u128) { value = value >> 4u8; result = result + 4u32; }
    if (value >= 4u128) { value = value >> 2u8; result = result + 2u32; }
    if (value >= 2u128) { result = result + 1u32; }
    return result;
}

// Computes fractional bits of log2 for a normalized input in [2^63, 2^64).
// Uses 14 iterations (bits 63..50) matching Uniswap V3 precision.
// Each iteration: square y in Q63, extract top bit to see if y >= 2.0, accumulate.
fn get_log2_fractional(x: u128) -> u128 {
    let result: u128 = 0u128;
    let y: u128 = x;
    y = (y * y) >> 63u8; let b63: u128 = y >> 64u8; result = result | (b63 << 63u8); y = y >> b63 as u8;
    y = (y * y) >> 63u8; let b62: u128 = y >> 64u8; result = result | (b62 << 62u8); y = y >> b62 as u8;
    y = (y * y) >> 63u8; let b61: u128 = y >> 64u8; result = result | (b61 << 61u8); y = y >> b61 as u8;
    y = (y * y) >> 63u8; let b60: u128 = y >> 64u8; result = result | (b60 << 60u8); y = y >> b60 as u8;
    y = (y * y) >> 63u8; let b59: u128 = y >> 64u8; result = result | (b59 << 59u8); y = y >> b59 as u8;
    y = (y * y) >> 63u8; let b58: u128 = y >> 64u8; result = result | (b58 << 58u8); y = y >> b58 as u8;
    y = (y * y) >> 63u8; let b57: u128 = y >> 64u8; result = result | (b57 << 57u8); y = y >> b57 as u8;
    y = (y * y) >> 63u8; let b56: u128 = y >> 64u8; result = result | (b56 << 56u8); y = y >> b56 as u8;
    y = (y * y) >> 63u8; let b55: u128 = y >> 64u8; result = result | (b55 << 55u8); y = y >> b55 as u8;
    y = (y * y) >> 63u8; let b54: u128 = y >> 64u8; result = result | (b54 << 54u8); y = y >> b54 as u8;
    y = (y * y) >> 63u8; let b53: u128 = y >> 64u8; result = result | (b53 << 53u8); y = y >> b53 as u8;
    y = (y * y) >> 63u8; let b52: u128 = y >> 64u8; result = result | (b52 << 52u8); y = y >> b52 as u8;
    y = (y * y) >> 63u8; let b51: u128 = y >> 64u8; result = result | (b51 << 51u8); y = y >> b51 as u8;
    y = (y * y) >> 63u8; let b50: u128 = y >> 64u8; result = result | (b50 << 50u8);
    return result;
}

fn get_tick_at_sqrt_price(sqrt_price: u128) -> i32 {
    let msb: u32 = most_significant_bit(sqrt_price);
    // Normalize to [2^63, 2^64) range using safe arithmetic (no underflow).
    let larger: u32 = msb >= 63u32 ? msb : 63u32;
    let smaller: u32 = msb >= 63u32 ? 63u32 : msb;
    let shift: u8 = (larger - smaller) as u8;
    let normalized: u128 = msb >= 63u32
        ? (sqrt_price >> shift)
        : (sqrt_price << shift);
    let log2_frac: u128 = get_log2_fractional(normalized);
    let log2_shifted: i128 = ((msb as i128 - 63i128) << 64u8) + log2_frac as i128;
    let tick_estimate: i128 = log2_shifted / LOG_SQRT_10001;
    let tick: i32 = tick_estimate as i32;
    // With 14-bit precision, estimate is always exact or 1 too low.
    // Check if tick+1 is the correct answer.
    let sqrt_at_next: u128 = get_sqrt_price_at_tick(tick + 1i32);
    return sqrt_price >= sqrt_at_next ? tick + 1i32 : tick;
}

fn get_pool_key(token0:field,token1:field,fee:u16)->field{
    let (pool_token0,pool_token_1)=token0<token1?(token0,token1):(token1,token0);
   return BHP256::hash_to_field(PoolKey{
    token0:pool_token0,
    token1:pool_token_1,
    fee
   });
}

fn get_tick_key(pool:field,tick:i32)->field{
    return BHP256::hash_to_field(TickKey{
        pool,
        tick
    });
}


fn check_ticks(tick_lower:i32,tick_upper:i32){
    assert(tick_lower<tick_upper);
    assert(tick_lower>=MIN_TICK);
    assert(tick_upper<=MAX_TICK);
}


// Ternary-safe wrapping subtraction for u128.
// Both branches must be safe for ALL inputs because Aleo ternary evaluates both.
fn wrapping_sub(a: u128, b: u128) -> u128 {
    let larger: u128 = a >= b ? a : b;
    let smaller: u128 = a >= b ? b : a;
    let diff: u128 = larger - smaller;
    // For wrapping case: need U128_MAX - diff + 1, but overflows when diff = 0.
    // Use max(diff, 1) so the +1 never overflows (result not used when diff = 0 anyway).
    let safe_diff: u128 = diff > 0u128 ? diff : 1u128;
    let wrapping: u128 = (340282366920938463463374607431768211455u128 - safe_diff) + 1u128;
    return a >= b ? diff : wrapping;
}

fn get_fee_growth_inside(
    tick_lower_info: Tick,
    tick_upper_info: Tick,
    tick_current: i32,
    fee_growth_global0: u128,
    fee_growth_global1: u128
) -> (u128, u128) {
    let fee_growth_below0: u128 = 0u128;
    let fee_growth_below1: u128 = 0u128;
    if tick_current >= tick_lower_info.tick {
        fee_growth_below0 = tick_lower_info.fee_growth_outside0_128;
        fee_growth_below1 = tick_lower_info.fee_growth_outside1_128;
    } else {
        fee_growth_below0 = wrapping_sub(fee_growth_global0, tick_lower_info.fee_growth_outside0_128);
        fee_growth_below1 = wrapping_sub(fee_growth_global1, tick_lower_info.fee_growth_outside1_128);
    }

    let fee_growth_above0: u128 = 0u128;
    let fee_growth_above1: u128 = 0u128;
    if tick_current < tick_upper_info.tick {
        fee_growth_above0 = tick_upper_info.fee_growth_outside0_128;
        fee_growth_above1 = tick_upper_info.fee_growth_outside1_128;
    } else {
        fee_growth_above0 = wrapping_sub(fee_growth_global0, tick_upper_info.fee_growth_outside0_128);
        fee_growth_above1 = wrapping_sub(fee_growth_global1, tick_upper_info.fee_growth_outside1_128);
    }

    let fee_growth_inside0 = wrapping_sub(wrapping_sub(fee_growth_global0, fee_growth_below0), fee_growth_above0);
    let fee_growth_inside1 = wrapping_sub(wrapping_sub(fee_growth_global1, fee_growth_below1), fee_growth_above1);

    return (fee_growth_inside0, fee_growth_inside1);
}
