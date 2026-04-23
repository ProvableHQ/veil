import "dotenv/config";
import { parseAbi, parseRecordPlaintext, encodeInputs, simulateContract, toString as recordToString } from "@veil/core";
import type { ABI, RecordDef } from "@veil/core";
import { createAleoClient } from "@veil/provable";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { RecordValue } from "@veil/core";

// ============================================================================
// Types
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

interface LoyaltyCard {
    owner: string;
    cardId: string;
    points: number;
    tier: CardTier;
    record: RecordValue;
}

interface RewardVoucher {
    owner: string;
    voucherId: string;
    rewardType: RewardType;
    value: number;
    record: RecordValue;
}

// ============================================================================
// Setup
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load ABIs and program sources
// Note: Leo compiler outputs "transitions" but parseAbi expects "functions" (the canonical name).
// Normalize here until the compiler output aligns.
function loadAbi(path: string) {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    if (raw.transitions && !raw.functions) {
        raw.functions = raw.transitions;
        delete raw.transitions;
    }
    // Normalize field names between Leo compiler versions
    if (raw.functions) {
        for (const fn of raw.functions) {
            // is_async → is_final
            if ('is_async' in fn && !('is_final' in fn)) {
                fn.is_final = fn.is_async;
            }
            // "Future" → "Final" in output types
            if (fn.outputs) {
                for (const output of fn.outputs) {
                    if (output.ty === 'Future') output.ty = 'Final';
                }
            }
        }
    }
    return raw;
}
const tokenAbi: ABI = parseAbi(loadAbi(join(__dirname, "../loyalty_token/build/abi.json")));
const rewardsAbi: ABI = parseAbi(loadAbi(join(__dirname, "../loyalty_rewards/build/abi.json")));
const tokenSource = readFileSync(join(__dirname, "../loyalty_token/build/main.aleo"), "utf-8").trim();
const rewardsSource = readFileSync(join(__dirname, "../loyalty_rewards/build/main.aleo"), "utf-8").trim();

// Look up RecordDefs from ABI for parsing outputs
const loyaltyCardDef: RecordDef = tokenAbi.records.find(r => r.path[r.path.length - 1] === 'LoyaltyCard')!;
const rewardVoucherDef: RecordDef = rewardsAbi.records.find(r => r.path[r.path.length - 1] === 'RewardVoucher')!;

// Look up function input types for encoding
function getInputTypes(abi: ABI, fnName: string) {
    const fn = abi.functions.find(f => f.name === fnName);
    if (!fn) throw new Error(`Function ${fnName} not found in ABI`);
    return fn.inputs.map(input => {
        if (input.type.kind === 'plaintext') return input.type.type;
        // Record inputs — return a placeholder, will be passed as string
        return { kind: 'primitive' as const, primitive: 'field' as const };
    });
}

// Read configuration from environment
const provingMode = process.env.ALEO_PROVING_MODE === "delegated" ? "delegated" : "local" as const;
const networkUrl = process.env.ALEO_NETWORK_URL ?? "https://api.explorer.provable.com/v1";
const dpsUrl = process.env.ALEO_DPS_URL;
const dpsApiKey = process.env.ALEO_DPS_API_KEY;
const consumerId = process.env.ALEO_CONSUMER_ID;

// Demo account
const DEMO_PRIVATE_KEY = "APrivateKey1zkp8CZNn3yeCseEtxuVPbDCwSyhGW6yZKUYKfgXmcpoGPWH";

// Create clients
const { walletClient, account } = createAleoClient({
    privateKey: DEMO_PRIVATE_KEY,
    networkUrl,
    provingMode,
    ...(dpsUrl && { proverUrl: dpsUrl }),
    ...(dpsApiKey && { apiKey: dpsApiKey }),
    ...(consumerId && { consumerId }),
});

// ============================================================================
// Record helpers — parse output strings into typed interfaces
// ============================================================================

function toLoyaltyCard(outputStr: string): LoyaltyCard {
    const record = parseRecordPlaintext(outputStr, loyaltyCardDef, 'loyalty_token.aleo');
    return {
        owner: record.owner,
        cardId: String(record.fields.card_id?.value ?? ''),
        points: Number(record.fields.points?.value ?? 0),
        tier: Number(record.fields.tier?.value ?? 0) as CardTier,
        record,
    };
}

function toRewardVoucher(outputStr: string): RewardVoucher {
    const record = parseRecordPlaintext(outputStr, rewardVoucherDef, 'loyalty_rewards.aleo');
    return {
        owner: record.owner,
        voucherId: String(record.fields.voucher_id?.value ?? ''),
        rewardType: Number(record.fields.reward_type?.value ?? 0) as RewardType,
        value: Number(record.fields.amount?.value ?? 0),
        record,
    };
}

// ============================================================================
// Execute helper — uses simulateContract for local, executeTransaction for delegated
// ============================================================================

async function execute(
    program: string,
    programSource: string,
    fn: string,
    inputs: string[],
    imports?: Record<string, string>,
): Promise<string[]> {
    const result = await simulateContract(walletClient, {
        program,
        programSource,
        function: fn,
        inputs,
        imports,
    });
    return result.outputs;
}

// ============================================================================
// Card Operations
// ============================================================================

async function mintCard(recipient: string, initialPoints: number): Promise<LoyaltyCard> {
    const nonce = Math.floor(Math.random() * 1e9);
    const inputTypes = getInputTypes(tokenAbi, 'mint_card');
    const encoded = encodeInputs([recipient, BigInt(initialPoints), BigInt(nonce)], inputTypes);
    const outputs = await execute('loyalty_token.aleo', tokenSource, 'mint_card', encoded);
    return toLoyaltyCard(outputs[0]);
}

async function addPoints(card: LoyaltyCard, pointsToAdd: number): Promise<LoyaltyCard> {
    const inputTypes = getInputTypes(tokenAbi, 'add_points');
    const encoded = encodeInputs([recordToString(card.record), BigInt(pointsToAdd)], inputTypes);
    const outputs = await execute('loyalty_token.aleo', tokenSource, 'add_points', encoded);
    return toLoyaltyCard(outputs[0]);
}

async function splitCardV2(card: LoyaltyCard, pointsToKeep: number): Promise<{ keptCard: LoyaltyCard; splitCard: LoyaltyCard }> {
    if (pointsToKeep >= card.points) {
        throw new Error(`pointsToKeep (${pointsToKeep}) must be less than card points (${card.points})`);
    }
    const inputTypes = getInputTypes(tokenAbi, 'split_card_v2');
    const encoded = encodeInputs([recordToString(card.record), BigInt(pointsToKeep)], inputTypes);
    const outputs = await execute('loyalty_token.aleo', tokenSource, 'split_card_v2', encoded);
    return { keptCard: toLoyaltyCard(outputs[0]), splitCard: toLoyaltyCard(outputs[1]) };
}

// ============================================================================
// Voucher Operations
// ============================================================================

async function redeemForVoucher(
    card: LoyaltyCard,
    rewardType: RewardType,
    pointsCost: number,
): Promise<{ card: LoyaltyCard; voucher: RewardVoucher }> {
    if (card.points < pointsCost) {
        throw new Error(`Insufficient points: have ${card.points}, need ${pointsCost}`);
    }
    const inputTypes = getInputTypes(rewardsAbi, 'redeem_points_for_voucher');
    const encoded = encodeInputs([recordToString(card.record), BigInt(rewardType), BigInt(pointsCost)], inputTypes);
    const outputs = await execute(
        'loyalty_rewards.aleo', rewardsSource, 'redeem_points_for_voucher', encoded,
        { 'loyalty_token.aleo': tokenSource },
    );
    return { card: toLoyaltyCard(outputs[0]), voucher: toRewardVoucher(outputs[1]) };
}

async function useVoucher(voucher: RewardVoucher): Promise<void> {
    const inputTypes = getInputTypes(rewardsAbi, 'use_voucher');
    const encoded = encodeInputs([recordToString(voucher.record)], inputTypes);
    await execute(
        'loyalty_rewards.aleo', rewardsSource, 'use_voucher', encoded,
        { 'loyalty_token.aleo': tokenSource },
    );
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
    console.log(`  ${C.dim}├─${C.reset} Points: ${C.bright}${card.points}${C.reset}, Tier: ${C.bright}${CardTier[card.tier]}${C.reset}`);
}

function logVoucher(voucher: RewardVoucher): void {
    console.log(`  ${C.dim}├─${C.reset} Type: ${C.bright}${RewardType[voucher.rewardType]}${C.reset}, Value: ${C.bright}${voucher.value}${C.reset}`);
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
