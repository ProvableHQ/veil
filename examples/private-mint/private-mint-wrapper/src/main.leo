import test_usdcx_bridge.aleo;
import test_usdcx_stablecoin.aleo;
import test_usdcx_multisig_core.aleo;
import test_usdcx_freezelist.aleo;
import merkle_tree.aleo;

const NATIVE_DOMAIN: u32 = 1002u32;
const ETH_ADDRESS: [u8;32] = [0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 30u8, 25u8, 109u8, 10u8, 125u8, 129u8, 137u8, 5u8, 76u8, 77u8, 183u8, 68u8, 171u8, 51u8, 64u8, 195u8, 241u8, 198u8, 139u8, 25u8];

fn get_amount_from_bytes(amount_bytes: [u8; 16]) -> u128 {
    let sum: u128 = 0;
        for i in 0u8..16u8 {
            sum = sum + (amount_bytes[i] as u128) * (2u128.pow(8u32 * (15u32 - (i as u32))) as u128);
        }
    return sum;
}

// The 'wrapper demo' program.
program wrapper_demo.aleo {
    @custom()
    constructor() {
        if self.edition > 0u16 {
            assert_eq(self.program_owner, aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px);
        }
    }

    fn mint_and_send_private(payload: [u8; 240], sig: [u8; 65], hash: [u8; 32], hook_data: [u8; 32], recipient: address) -> (test_usdcx_stablecoin.aleo::Token, Final) {
        let amount_bytes: [u8; 16] =[0u8; 16]; // Initialize an array to hold the amount bytes
        for i in 0u8..16u8{
                amount_bytes[i] = payload[24u8 + i];
            }
        let amount: u128 = get_amount_from_bytes(amount_bytes);
        let mint_to_vault_final: Final = test_usdcx_bridge.aleo::mint_public(payload, sig, hash, hook_data);

        // let mint_to_hyp_vault: Final = hyp_warp_token_usad::process(...);

        let (receipt, token_record, transfer_final) = test_usdcx_stablecoin.aleo::transfer_public_to_private(recipient, amount);
        return (token_record, final {
            mint_to_vault_final.run();
            transfer_final.run();
        });
    }

    fn mint_and_send_public(payload: [u8; 240], sig: [u8; 65], hash: [u8; 32], hook_data: [u8; 32]) -> Final {
        assert_eq(self.caller, aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px);
        let amount_bytes: [u8; 16] =[0u8; 16]; // Initialize an array to hold the amount bytes
        for i in 0u8..16u8{
                amount_bytes[i] = payload[24u8 + i];
            }
        let amount: u128 = get_amount_from_bytes(amount_bytes);
        let mint_to_vault_final: Final = test_usdcx_bridge.aleo::mint_public(payload, sig, hash, hook_data);
        let transfer_final = test_usdcx_stablecoin.aleo::transfer_public(self.signer, amount);
        return final {
            mint_to_vault_final.run();
            transfer_final.run();
        };
    }

    fn deposit_public_usdcx_to_vault(amount: u128)-> Final {
        let transfer_final: Final = test_usdcx_stablecoin.aleo::transfer_public_as_signer(self.address, amount);
        return final {
            transfer_final.run();
        };
    }

    fn deposit_private_usdcx_to_vault(amount: u128, user_record: test_usdcx_stablecoin.aleo::Token, merkle_proof: [test_usdcx_stablecoin.aleo::MerkleProof; 2]) -> Final {
        let (receipt, return_token, transfer_final) = test_usdcx_stablecoin.aleo::transfer_private_to_public(self.address, amount, user_record, merkle_proof);
        return final {
            transfer_final.run();
        };
    }

    fn withdraw_from_vault_public(amount: u128) -> Final {
        let transfer_final = test_usdcx_stablecoin.aleo::transfer_public(self.signer, amount);
        return final {
            transfer_final.run();
        };
    }

    fn withdraw_from_vault_private(amount: u128, recipient: address) -> Final {
        let (receipt, token_record, transfer_final) = test_usdcx_stablecoin.aleo::transfer_public_to_private(self.signer, amount);
        return final {
            transfer_final.run();
        };
    }

    fn burn_private(user_record: test_usdcx_stablecoin.aleo::Token, amount: u128, merkle_proof: [test_usdcx_stablecoin.aleo::MerkleProof; 2]) -> Final {
        let (receipt, return_token, transfer_final) = test_usdcx_stablecoin.aleo::transfer_private_to_public(self.address, amount, user_record, merkle_proof);
        let burn_final = test_usdcx_bridge.aleo::burn_public(amount, NATIVE_DOMAIN, ETH_ADDRESS);
        return final {
            transfer_final.run();
            burn_final.run();
        };
    }
}