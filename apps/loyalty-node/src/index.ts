import "dotenv/config";
import type { RecordValue } from "@veil/core";
import type { ParsedOutput } from "@veil/core";
import { createAleoClient } from "@veil/provable";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Generated types and factories — run `pnpm generate` after `leo build`
import {
    createLoyaltyTokenContract, toLoyaltyCard,
    PROGRAM_ID as TOKEN_PROGRAM,
    type LoyaltyCard,
} from "./generated/loyalty_token.js";
import {
    createLoyaltyRewardsContract, toRewardVoucher,
    type RewardVoucher,
} from "./generated/loyalty_rewards.js";

// ============================================================================
// App-level types (semantic meaning not in the ABI)
// ============================================================================

enum RewardType {
    Discount = 1,
    Freebie = 2,
    Upgrade = 3,
}

enum CardTier {
    Bronze = 0,
    Silver = 1,
    Gold = 2,
}

// ============================================================================
// Setup
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Program sources needed for proving
const tokenSource = readFileSync(join(__dirname, "../loyalty_token/build/main.aleo"), "utf-8").trim();
const rewardsSource = readFileSync(join(__dirname, "../loyalty_rewards/build/main.aleo"), "utf-8").trim();

// Read configuration from environment
const provingMode = process.env.ALEO_PROVING_MODE === "delegated" ? "delegated" : "local" as const;
const networkUrl = process.env.ALEO_NETWORK_URL ?? "https://api.explorer.provable.com/v1";
const dpsUrl = process.env.ALEO_DPS_URL;
const dpsApiKey = process.env.ALEO_DPS_API_KEY;
const consumerId = process.env.ALEO_CONSUMER_ID;

// Demo account
const DEMO_PRIVATE_KEY = "APrivateKey1zkp8CZNn3yeCseEtxuVPbDCwSyhGW6yZKUYKfgXmcpoGPWH";

// Create clients
const { publicClient, walletClient, account } = createAleoClient({
    privateKey: DEMO_PRIVATE_KEY,
    networkUrl,
    provingMode,
    ...(dpsUrl && { proverUrl: dpsUrl }),
    ...(dpsApiKey && { apiKey: dpsApiKey }),
    ...(consumerId && { consumerId }),
});

// Create typed contracts — auto-encode inputs, auto-parse outputs
const tokenContract = createLoyaltyTokenContract({
    publicClient,
    walletClient,
    programSource: tokenSource,
});

const rewardsContract = createLoyaltyRewardsContract({
    publicClient,
    walletClient,
    programSource: rewardsSource,
    imports: { [TOKEN_PROGRAM]: tokenSource },
});

// ============================================================================
// Helpers — extract RecordValue from auto-parsed output
// ============================================================================

function asRecord(output: ParsedOutput): RecordValue {
    if (typeof output === 'string') throw new Error(`Expected record, got string: ${output}`);
    return output;
}

function toCard(output: ParsedOutput): LoyaltyCard & { record: RecordValue } {
    const record = asRecord(output);
    return { ...toLoyaltyCard(record), record };
}

function toVoucher(output: ParsedOutput): RewardVoucher & { record: RecordValue } {
    const record = asRecord(output);
    return { ...toRewardVoucher(record), record };
}

// ============================================================================
// Card Operations — native values in, typed records out
// ============================================================================

async function mintCard(recipient: string, initialPoints: number) {
    const nonce = Math.floor(Math.random() * 1e9);
    const result = await tokenContract.simulate.mint_card({
        inputs: [recipient, BigInt(initialPoints), BigInt(nonce)],
    });
    return toCard(result.outputs[0]);
}

async function addPoints(card: LoyaltyCard & { record: RecordValue }, pointsToAdd: number) {
    const result = await tokenContract.simulate.add_points({
        inputs: [card.record, BigInt(pointsToAdd)],
    });
    return toCard(result.outputs[0]);
}

async function splitCardV2(card: LoyaltyCard & { record: RecordValue }, pointsToKeep: number) {
    if (pointsToKeep >= Number(card.points)) {
        throw new Error(`pointsToKeep (${pointsToKeep}) must be less than card points (${card.points})`);
    }
    const result = await tokenContract.simulate.split_card_v2({
        inputs: [card.record, BigInt(pointsToKeep)],
    });
    return { keptCard: toCard(result.outputs[0]), splitCard: toCard(result.outputs[1]) };
}

// ============================================================================
// Voucher Operations
// ============================================================================

async function redeemForVoucher(
    card: LoyaltyCard & { record: RecordValue },
    rewardType: RewardType,
    pointsCost: number,
) {
    if (Number(card.points) < pointsCost) {
        throw new Error(`Insufficient points: have ${card.points}, need ${pointsCost}`);
    }
    const result = await rewardsContract.simulate.redeem_points_for_voucher({
        inputs: [card.record, BigInt(rewardType), BigInt(pointsCost)],
    });
    return { card: toCard(result.outputs[0]), voucher: toVoucher(result.outputs[1]) };
}

async function useVoucher(voucher: RewardVoucher & { record: RecordValue }) {
    await rewardsContract.simulate.use_voucher({
        inputs: [voucher.record],
    });
}

// ============================================================================
// Logging
// ============================================================================

const C = {
    reset: "\x1b[0m", bright: "\x1b[1m", dim: "\x1b[2m",
    cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", blue: "\x1b[34m",
};

function logHeader(title: string): void {
    console.log(`\n${C.cyan}${"═".repeat(60)}${C.reset}`);
    console.log(`${C.cyan}  ${C.bright}${title}${C.reset}`);
    console.log(`${C.cyan}${"═".repeat(60)}${C.reset}`);
}

function logCard(card: LoyaltyCard, label?: string): void {
    if (label) console.log(`  ${C.dim}${label}${C.reset}`);
    console.log(`  ${C.dim}├─${C.reset} Points: ${C.bright}${card.points}${C.reset}, Tier: ${C.bright}${CardTier[Number(card.tier)]}${C.reset}`);
}

function logVoucher(voucher: RewardVoucher): void {
    console.log(`  ${C.dim}├─${C.reset} Type: ${C.bright}${RewardType[Number(voucher.reward_type)]}${C.reset}, Value: ${C.bright}${voucher.amount}${C.reset}`);
}

// ============================================================================
// Demo
// ============================================================================

const address = account.address;

const demos: Record<string, () => Promise<void>> = {
    async full_flow() {
        logHeader("Full Loyalty Program Flow");

        console.log("\n1. Minting card with 100 points...");
        let card = await mintCard(address, 100);
        logCard(card);

        console.log("\n2. Adding 900 points (upgrade to Silver)...");
        card = await addPoints(card, 900);
        logCard(card);

        console.log("\n3. Adding 9900 points (upgrade to Gold)...");
        card = await addPoints(card, 9900);
        logCard(card);

        console.log("\n4. Splitting card (keep 3000)...");
        const { keptCard, splitCard } = await splitCardV2(card, 3000);
        logCard(keptCard, "Kept:");
        logCard(splitCard, "Split:");

        console.log("\n5. Redeeming 2000 points for Upgrade voucher...");
        const { card: updatedCard, voucher } = await redeemForVoucher(keptCard, RewardType.Upgrade, 2000);
        logCard(updatedCard, "Card after redemption:");
        logVoucher(voucher);

        console.log("\n6. Using the voucher...");
        await useVoucher(voucher);
        console.log(`  ${C.green}✓${C.reset} Voucher consumed!`);
    },

    async mint_card() {
        logHeader("Minting Loyalty Card");
        const card = await mintCard(address, 1000);
        logCard(card);
    },

    async add_points() {
        logHeader("Adding Points");
        const card = await mintCard(address, 500);
        console.log("  Initial card:");
        logCard(card);
        const updated = await addPoints(card, 600);
        console.log(`  After +600 points:`);
        logCard(updated);
    },

    async redeem_for_voucher() {
        logHeader("Redeeming Points for Voucher");
        const card = await mintCard(address, 1000);
        const { card: updated, voucher } = await redeemForVoucher(card, RewardType.Discount, 500);
        logCard(updated, "Card:");
        logVoucher(voucher);
    },

    async local() {
        await demos.full_flow();
    },

    async delegated() {
        if (!dpsUrl) {
            console.error(`\n${C.yellow}Delegated proving requires ALEO_DPS_URL${C.reset}`);
            process.exit(1);
        }
        await demos.full_flow();
    },
};

async function main() {
    const selected = process.argv[2] ?? "full_flow";
    const fn = demos[selected];

    if (!fn) {
        console.error(`Unknown command: ${selected}`);
        console.error(`Available: ${Object.keys(demos).join(", ")}`);
        process.exit(1);
    }

    console.log(`${C.dim}Mode: ${provingMode.toUpperCase()} | Account: ${address.slice(0, 20)}...${C.reset}`);
    await fn();
    console.log(`\n${C.green}✓${C.reset} Done!\n`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
