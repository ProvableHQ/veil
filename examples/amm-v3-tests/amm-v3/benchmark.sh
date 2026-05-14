#!/bin/bash

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

# Signer address from .env
SIGNER="aleo1a9c65vydlrru0d8ca0ruw2fg66r7mrve5w8ek89vz8akkd2djsfqy3x6kw"

# Function to run benchmark and measure time
benchmark() {
    local name=$1
    local cmd=$2

    echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Benchmarking:${NC} ${WHITE}${name}${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    # Run command and capture time
    local start_time=$(date +%s.%N)
    eval "$cmd" 2>&1
    local exit_code=$?
    local end_time=$(date +%s.%N)

    # Calculate duration
    local duration=$(echo "$end_time - $start_time" | bc)

    echo -e "\n${CYAN}──────────────────────────────────────────────────────────────────────────${NC}"
    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}[SUCCESS]${NC} ${WHITE}${name}${NC}"
    else
        echo -e "${RED}[FAILED]${NC} ${WHITE}${name}${NC} (exit code: ${exit_code})"
    fi
    echo -e "${MAGENTA}Duration:${NC} ${WHITE}${duration}s${NC}"
    echo -e "${CYAN}──────────────────────────────────────────────────────────────────────────${NC}"

    # Store result for summary
    results+=("${name}|${duration}|${exit_code}")
}

# Array to store results
declare -a results

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════════════════════╗"
echo "║                     LEO AMM PROOF GENERATION BENCHMARK                    ║"
echo "╚═══════════════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Benchmark create_pool
benchmark "create_pool" \
    'leo execute --yes create_pool 1field 2field 3000u16 340282366920938463463374607431768211455u128 60u32 0i32'

# Benchmark mint
benchmark "mint" \
    "leo execute --yes mint ${SIGNER} \"{pool: 0field, tick_lower: 0i32, tick_upper: 120i32, amount0_desired: 1000000u128, amount1_desired: 1000000u128, amount0_min: 0u128, amount1_min: 0u128, tick_lower_hint: -887272i32, tick_upper_hint: 0i32}\" 1field 2field"

# Benchmark decrease_liquidity (COMMENTED OUT IN CONTRACT)
# benchmark "decrease_liquidity" \
#     "leo execute --yes decrease_liquidity \"{owner: ${SIGNER}.private, token_id: 1field.private, pool: 1field.private, tick_lower: -100i32.private, tick_upper: 100i32.private, _nonce: 0group.public}\" 500u128 0u128 0u128 -887272i32 -100i32"

# Benchmark collect
benchmark "collect" \
    "leo execute --yes collect \"{ owner: ${SIGNER}.private, token_id: 1field.private, pool: 1field.private, tick_lower: -100i32.private, tick_upper: 100i32.private, _nonce: 0group.public }\" 1000000u128 1000000u128 1field 2field ${SIGNER}"

# Benchmark burn (COMMENTED OUT IN CONTRACT)
# benchmark "burn" \
#     "leo execute --yes burn \"{owner: ${SIGNER}.private, token_id: 1field.private, pool: 1field.private, tick_lower: -100i32.private, tick_upper: 100i32.private, _nonce: 0group.public}\""

# Benchmark swap (2 tick crossings)
benchmark "swap" \
    "leo execute --yes swap \"{pool: 0field, zero_for_one: true, amount_in: 10000u128, amount_out_min: 0u128, sqrt_price_limit: 1u128, recipient: ${SIGNER}, tick_hint_0: 60i32, tick_hint_1: 0i32, nonce: 0u64, deadline: 1000000u32}\" 1field 2field"

# Benchmark claim_swap_output (swap_id, token_in, token_out, amount_out, amount_remaining, recipient)
benchmark "claim_swap_output" \
    "leo execute --yes claim_swap_output 1field 1field 2field 1000u128 0u128 ${SIGNER}"

# Print summary
echo -e "\n${BLUE}"
echo "╔═══════════════════════════════════════════════════════════════════════════╗"
echo "║                              BENCHMARK SUMMARY                            ║"
echo "╚═══════════════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

echo -e "${WHITE}TRANSITION                DURATION        STATUS${NC}"
echo -e "${CYAN}───────────────────────────────────────────────────────────${NC}"

total_time=0
for result in "${results[@]}"; do
    IFS='|' read -r name duration exit_code <<< "$result"
    total_time=$(echo "$total_time + $duration" | bc)

    if [ "$exit_code" -eq 0 ]; then
        status="${GREEN}PASS${NC}"
    else
        status="${RED}FAIL${NC}"
    fi

    echo -e "$(printf '%-25s' "$name") ${MAGENTA}$(printf '%-15s' "${duration}s")${NC} $status"
done

echo -e "${CYAN}───────────────────────────────────────────────────────────${NC}"
echo -e "${WHITE}Total time:${NC} ${MAGENTA}${total_time}s${NC}"
echo -e "\n${GREEN}Benchmark complete!${NC}\n"
