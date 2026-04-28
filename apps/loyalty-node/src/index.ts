import "dotenv/config";
import { parseRecordPlaintextLoose, serializeRecord } from "@veil/core";
import type { RecordValue } from "@veil/core";
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
    PROGRAM_ID as REWARDS_PROGRAM,
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

interface CardWithRecord extends LoyaltyCard {
    record: RecordValue;
}

interface VoucherWithRecord extends RewardVoucher {
    record: RecordValue;
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

// Create typed contracts — autocomplete on function and mapping names
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
// Record helpers — generated mappers + RecordValue for re-consumption
// ============================================================================

function parseCard(outputStr: string): CardWithRecord {
    const record = parseRecordPlaintextLoose(outputStr, TOKEN_PROGRAM, 'LoyaltyCard');
    return { ...toLoyaltyCard(record), record };
}

function parseVoucher(outputStr: string): VoucherWithRecord {
    const record = parseRecordPlaintextLoose(outputStr, REWARDS_PROGRAM, 'RewardVoucher');
    return { ...toRewardVoucher(record), record };
}

// ============================================================================
// Card Operations — using contract.simulate proxy
// ============================================================================

async function mintCard(recipient: string, initialPoints: number): Promise<CardWithRecord> {
    const nonce = Math.floor(Math.random() * 1e9);
    const result = await tokenContract.simulate.mint_card({
        inputs: [recipient, `${initialPoints}u64`, `${nonce}field`],
    });
    return parseCard(result.outputs[0]);
}

async function addPoints(card: CardWithRecord, pointsToAdd: number): Promise<CardWithRecord> {
    const result = await tokenContract.simulate.add_points({
        inputs: [serializeRecord(card.record), `${pointsToAdd}u64`],
    });
    return parseCard(result.outputs[0]);
}

async function splitCardV2(card: CardWithRecord, pointsToKeep: number): Promise<{ keptCard: CardWithRecord; splitCard: CardWithRecord }> {
    if (pointsToKeep >= Number(card.points)) {
        throw new Error(`pointsToKeep (${pointsToKeep}) must be less than card points (${card.points})`);
    }
    const result = await tokenContract.simulate.split_card_v2({
        inputs: [serializeRecord(card.record), `${pointsToKeep}u64`],
    });
    return { keptCard: parseCard(result.outputs[0]), splitCard: parseCard(result.outputs[1]) };
}

// ============================================================================
// Voucher Operations — imports configured on contract, no per-call setup
// ============================================================================

async function redeemForVoucher(
    card: CardWithRecord,
    rewardType: RewardType,
    pointsCost: number,
): Promise<{ card: CardWithRecord; voucher: VoucherWithRecord }> {
    if (Number(card.points) < pointsCost) {
        throw new Error(`Insufficient points: have ${card.points}, need ${pointsCost}`);
    }
    const result = await rewardsContract.simulate.redeem_points_for_voucher({
        inputs: [serializeRecord(card.record), `${rewardType}u8`, `${pointsCost}u64`],
    });
    return { card: parseCard(result.outputs[0]), voucher: parseVoucher(result.outputs[1]) };
}

async function useVoucher(voucher: VoucherWithRecord): Promise<void> {
    await rewardsContract.simulate.use_voucher({
        inputs: [serializeRecord(voucher.record)],
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

function logCard(card: CardWithRecord, label?: string): void {
    if (label) console.log(`  ${C.dim}${label}${C.reset}`);
    console.log(`  ${C.dim}├─${C.reset} Points: ${C.bright}${card.points}${C.reset}, Tier: ${C.bright}${CardTier[Number(card.tier)]}${C.reset}`);
}

function logVoucher(voucher: VoucherWithRecord): void {
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
