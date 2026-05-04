import "dotenv/config";
import { loadNetwork } from "@veil/provable";
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
    createLoyaltyRewardsContract,
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

// Account — set ALEO_PRIVATE_KEY to override, or use the SDK demo account (funded on testnet)
const DEMO_PRIVATE_KEY = process.env.ALEO_PRIVATE_KEY ?? "APrivateKey1zkp6aEqdUdRpZs1fnfGBEitWZNzxNhPz4kb2W382nuX8G42";

// Load the SDK for testnet and create clients
const aleo = await loadNetwork("testnet");
const { publicClient, walletClient, account } = aleo.createAleoClient({
    privateKey: DEMO_PRIVATE_KEY,
    networkUrl,
    provingMode,
    ...(dpsUrl && { proverUrl: dpsUrl }),
    ...(dpsApiKey && { apiKey: dpsApiKey }),
    ...(consumerId && { consumerId }),
});

// Create typed contracts — named params, typed returns, autocomplete
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
// Simulate helpers — local execution, no broadcast, instant results
// ============================================================================

async function mintCard(recipient: string, initialPoints: number) {
    const nonce = Math.floor(Math.random() * 1e9);
    return tokenContract.simulate.mint_card({
        recipient,
        initial_points: BigInt(initialPoints),
        nonce: `${nonce}field`,
    });
}

async function addPoints(card: LoyaltyCard, pointsToAdd: number) {
    return tokenContract.simulate.add_points({
        card,
        points_earned: BigInt(pointsToAdd),
    });
}

async function splitCardV2(card: LoyaltyCard, pointsToKeep: number) {
    if (pointsToKeep >= Number(card.points)) {
        throw new Error(`pointsToKeep (${pointsToKeep}) must be less than card points (${card.points})`);
    }
    return tokenContract.simulate.split_card_v2({
        card,
        points_to_keep: BigInt(pointsToKeep),
    });
}

async function redeemForVoucher(card: LoyaltyCard, rewardType: RewardType, pointsCost: number) {
    if (Number(card.points) < pointsCost) {
        throw new Error(`Insufficient points: have ${card.points}, need ${pointsCost}`);
    }
    // Cross-program call: pass _record for foreign record input, returns [RecordValue, RewardVoucher]
    const [updatedCardRecord, voucher] = await rewardsContract.simulate.redeem_points_for_voucher({
        card: card._record,
        reward_type: rewardType,
        points_to_spend: BigInt(pointsCost),
    });
    return { card: toLoyaltyCard(updatedCardRecord), voucher };
}

async function useVoucher(voucher: RewardVoucher) {
    await rewardsContract.simulate.use_voucher({ voucher });
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
// Demos
// ============================================================================

const address = account.address;

const demos: Record<string, () => Promise<void>> = {

    // ── simulate: local execution, no network, instant ────────────────

    async simulate() {
        logHeader("Simulate: Full Loyalty Program Flow");

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
        const [keptCard, splitCard] = await splitCardV2(card, 3000);
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

    // ── execute: prove, broadcast, confirm on-chain ───────────────────

    async execute() {
        logHeader(`Execute: On-Chain Flow (${provingMode} proving)`);

        const nonce = Math.floor(Math.random() * 1e9);

        console.log("\n  Minting card with 1000 points on-chain...");
        const mint = await tokenContract.execute.mint_card({
            recipient: address,
            initial_points: 1000n,
            nonce: `${nonce}field`,
            fee: 500_000n,
        });
        console.log(`  ${C.dim}tx:${C.reset} ${mint.transactionId}`);
        logCard(mint.result);
    },

    // ── read: public mapping lookups ──────────────────────────────────

    async read() {
        logHeader("Read: Public Mappings");

        const cardField = "1field";
        const exists = await tokenContract.read.card_exists({ key: cardField });
        console.log(`  card_exists(${cardField}): ${exists ?? "not set"}`);

        const totalPoints = await tokenContract.read.total_points_issued({ key: cardField });
        console.log(`  total_points_issued(${cardField}): ${totalPoints ?? "not set"}`);
    },

    // ── shortcuts ─────────────────────────────────────────────────────

    async mint_card() {
        logHeader("Simulate: Mint Card");
        const card = await mintCard(address, 1000);
        logCard(card);
    },

    async add_points() {
        logHeader("Simulate: Add Points");
        const card = await mintCard(address, 500);
        console.log("  Initial card:");
        logCard(card);
        const updated = await addPoints(card, 600);
        console.log(`  After +600 points:`);
        logCard(updated);
    },

    async redeem_for_voucher() {
        logHeader("Simulate: Redeem for Voucher");
        const card = await mintCard(address, 1000);
        const { card: updated, voucher } = await redeemForVoucher(card, RewardType.Discount, 500);
        logCard(updated, "Card:");
        logVoucher(voucher);
    },
};

async function main() {
    const selected = process.argv[2] ?? "simulate";
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
