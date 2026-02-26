# OUTCRY — Project Context

## What This Is

OUTCRY is a real-time live auction protocol on Solana for the Graveyard Hackathon (deadline: Feb 27, 2026). Tagline: "Going, going, onchain."

Artists list NFTs, collectors compete in real-time, spectators watch. Every bid is an onchain transaction at sub-50ms latency via MagicBlock Ephemeral Rollups. Social layer via Tapestry. Compressed NFT badges via Bubblegum.

## Target Bounties

- **MagicBlock** ($5K) — First non-gaming use of Ephemeral Rollups (real-time commerce)
- **Exchange Art** ($5K) — Art/NFT project with enforced royalties
- **Tapestry** ($5K) — Social profiles, follows, content, discovery
- **DRiP** ($2.5K) — Compressed NFT badges for auction participants
- **Overall prizes** ($30K pool)

## Current Status

- Program deployed to devnet: `J7r5mzvVUjSNQteoqn6Hd3LjZ3ksmwoD5xsnUvMJwPZo`
- Frontend running (Next.js dev server)
- Full L1 lifecycle works (create, start, deposit, settle, refund, cancel)
- MagicBlock ER integration wired up (delegation, place_bid, end_auction, undelegation)
- Tapestry social layer integrated (profiles, follows, likes, comments)
- Bubblegum badge system integrated (Present, Contender, Victor badges)
- Testing bidding via ER on devnet (blockhash fix in progress)

## Architecture — Non-Negotiable Decisions

1. **Standard Anchor** — NOT BOLT ECS. Auctions are state machines, not game entities.
2. **Deposit-then-bid** (Shield Poker pattern) — SOL stays in vault on L1 via BidderDeposit PDAs. Only AuctionState delegates to ER. The ER never touches money.
3. **BidderDeposit PDAs** — Separate per-bidder accounts on L1 (never delegated). Deposits work anytime, even while auction is delegated to ER.
4. **Deferred deposit validation** — `place_bid` on ER doesn't check deposits. `settle_auction` on L1 verifies winner's deposit >= winning bid.
5. **English auction only for MVP** — Dutch and Sealed-bid are stretch goals.
6. **Standard NFTs first** — pNFT (Token Auth Rules) royalty enforcement is a stretch goal.
7. **No custom backend** — Magic Router for real-time, Tapestry REST for social, Umi for badges.
8. **Session keys implemented** — Ephemeral keypair + SessionToken PDA enables popup-free bidding via `place_bid_session`.

## Program Design

### Accounts

- `AuctionState` — Seeds: `[b"auction", seller, nft_mint]`. Fixed-size (no Vec). Delegated to ER during live bidding. Tracks current_bid, highest_bidder, end_time, status, bid_count.
- `AuctionVault` — Seeds: `[b"vault", auction_state]`. NEVER delegated. Holds SOL deposits on L1.
- `BidderDeposit` — Seeds: `[b"deposit", auction_state, bidder]`. Per-bidder deposit tracking. Stays on L1, never delegated. Uses `init_if_needed`.
- `SessionToken` — Seeds: `[b"session", auction_state, bidder]`. Links ephemeral browser keypair to real wallet for popup-free bidding. Stays on L1 (ER clones read-only).

### Instructions

| Instruction | Layer | Purpose |
|-------------|-------|---------|
| create_auction | L1 | Init state + vault, escrow NFT |
| deposit | L1 | Bidder deposits SOL to vault (works anytime, even during ER delegation) |
| start_auction | L1 | Set Active, start timer |
| delegate_auction | L1 | Delegate AuctionState to ER (requires Active status) |
| place_bid | ER | Update current_bid + highest_bidder (sub-50ms, no deposit check) |
| place_bid_session | ER | Same as place_bid but signed by ephemeral session key |
| end_auction | ER | Set Ended status (permissionless, anyone can crank) |
| undelegate_auction | ER→L1 | Commit state back to L1 (permissionless) |
| settle_auction | L1 | Transfer NFT to winner, distribute SOL with royalties (verifies winner deposit >= bid) |
| forfeit_auction | L1 | Handle winner default — NFT to seller, deposit slashed (permissionless) |
| claim_refund | L1 | Losers reclaim deposits from BidderDeposit PDA |
| claim_refund_for | L1 | Permissionless: refund a specific bidder (anyone pays gas) |
| cancel_auction | L1 | Seller cancels (only if Created or Ended with 0 bids) |
| close_auction | L1 | Close accounts, reclaim rent (requires empty vault) |
| force_close_auction | L1 | Seller sweeps unclaimed deposits after 7-day grace period |
| create_session | L1 | Register ephemeral key → real wallet link for session bidding |
| emergency_refund | L1 | Recover deposits stuck in ER-delegated auctions |

### Instruction Flow

```
create_auction (L1)
  → deposit (L1, anytime)
  → start_auction (L1)
  → delegate_auction (L1)
  → deposit (L1, still works!)
  → create_session (L1, optional — enables popup-free bidding)
  → place_bid (ER, sub-50ms) OR place_bid_session (ER, ephemeral key)
  → end_auction (ER)
  → undelegate_auction (ER→L1)
  → settle_auction (L1, checks deposit + enforces royalties)
  → claim_refund (L1, losers) OR claim_refund_for (L1, permissionless)
```

### Status Flow

```
Created → Active → Ended → Settled
Created → Cancelled (if no bids)
```

### Anti-Sniping

If a bid arrives within `extension_window` (default 300s) of `end_time`, extend `end_time` by `extension_seconds` (default 300s).

### Anti-Shill-Bidding

Seller cannot bid on their own auction (enforced on-chain via `SellerCannotBid` constraint).

### Settlement Logic

1. Verify winner's BidderDeposit >= winning bid
2. Deduct winning bid from winner's deposit
3. Calculate royalties from Metaplex metadata (seller_fee_basis_points, creator splits)
4. Transfer SOL: royalties to creators, protocol fee to treasury, remainder to seller
5. Transfer NFT from escrow to winner
6. Losers claim refunds separately via `claim_refund` or `claim_refund_for`

## Tech Stack

### Rust Program
- anchor-lang 0.32.1 (with init-if-needed feature)
- anchor-spl 0.32.1 (token, associated_token features)
- ephemeral-rollups-sdk 0.6.5 (features: anchor, disable-realloc)

### Frontend
- Next.js 16 (App Router, React 19)
- Tailwind CSS (dark premium theme — jet black + warm gold accents)
- @coral-xyz/anchor 0.32.1
- @solana/web3.js ^1.98
- @solana/wallet-adapter-react + wallet-adapter-react-ui
- @magicblock-labs/ephemeral-rollups-sdk 0.8.5 (ConnectionMagicRouter)
- @metaplex-foundation/umi + mpl-bubblegum (badge minting)
- framer-motion (animations)

### Dev Environment
- Anchor CLI: 0.32.1
- Solana CLI: 2.0.0
- Rust: 1.93.0
- Node.js: v25.2.1

## MagicBlock ER Specifics

### Endpoints
- **Delegation Program:** `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`
- **Magic Router (devnet):** `https://devnet-router.magicblock.app/`
- **Magic Router WebSocket:** `wss://devnet-router.magicblock.app/`

### How It Works
- `ConnectionMagicRouter` auto-routes: delegated accounts → ER, non-delegated → L1
- `#[ephemeral]` goes before `#[program]` in lib.rs
- `#[delegate]` macro requires `AccountInfo` with `del` constraint (not `Account<>`)
- `#[commit]` macro auto-adds `magic_context` and `magic_program` accounts
- Delegation programs don't exist on localnet — test L1 logic locally, ER on devnet

### CRITICAL: Sending ER Transactions from Browser Wallets

**Do NOT use Anchor's `.rpc()` for ER-routed transactions.** It calls `getLatestBlockhash()` which returns L1 blockhash, but the ER has its own blockhash progression. The wallet signs with the wrong blockhash → "Blockhash not found" error.

**Correct pattern** (used in `useAuctionActions.ts`):
```typescript
// 1. Build unsigned transaction
const tx = await erProgram.methods.placeBid(amount).accounts({...}).transaction();
tx.feePayer = publicKey;

// 2. Get correct blockhash from Magic Router's getBlockhashForAccounts API
const { blockhash } = await getMagicBlockhash(connection.rpcEndpoint, tx);
tx.recentBlockhash = blockhash;

// 3. Sign with wallet adapter
const signed = await wallet.signTransaction(tx);

// 4. Send raw bytes (bypasses problematic sendTransaction override)
const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true });
```

### Frontend Connection Pattern
- **Dual connections**: Standard devnet `Connection` for L1 ops, `ConnectionMagicRouter` for ER ops
- `l1Program` for: createAuction, deposit, startAuction, delegateAuction, settleAuction, claimRefund
- `erProgram` for: placeBid, endAuction, undelegateAuction
- Magic Router doesn't support `getProgramAccounts` — use devnet for listing, Magic Router for individual fetches
- Delegation status checked via delegation record PDA: `["delegation", account.key()]` under delegation program

### Deposit Architecture (BidderDeposit PDAs)
- Deposits use `UncheckedAccount` for `auction_state` (works even when delegated — L1 owner changes to delegation program)
- BidderDeposit PDA validated implicitly via vault PDA seeds constraint
- Deposits can happen before, during, or after ER delegation
- `place_bid` on ER does NOT check deposits (deferred to settlement)
- `settle_auction` on L1 verifies `winner_deposit.amount >= auction_state.current_bid`

## Tapestry Specifics

- **Base URL:** `https://api.usetapestry.dev/v1/`
- **Auth:** API key as query param (`?apiKey=xxx`)
- **Key endpoints:** /profiles, /followers, /follows, /contents, /comments, /likes
- **Execution modes:** FAST_UNCONFIRMED (~1s), QUICK_SIGNATURE (~5s), CONFIRMED_AND_PARSED (~15s)
- **API key must be proxied** — never expose to client. Use Next.js API routes (`app/src/app/api/tapestry/`).
- Integrated features: profile display, follow/unfollow, likes, comments on auctions, auction result posts

## Metaplex Specifics

- **Token Metadata Program:** `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`
- **Bubblegum Program:** `BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY`
- Badge tree: depth 14 = 16,384 cNFTs, canopy depth 11
- Badge types: Present (spectator), Contender (bidder), Victor (winner)
- Uses Helius DAS API for cNFT fetching

## Constants

```
PROTOCOL_FEE_BPS = 250 (2.5%)
DEFAULT_EXTENSION_SECONDS = 300 (5 min)
DEFAULT_EXTENSION_WINDOW = 300 (5 min)
DEFAULT_MIN_BID_INCREMENT = 100_000_000 (0.1 SOL)
MIN_AUCTION_DURATION = 300 (5 minutes)
MAX_AUCTION_DURATION = 604_800 (7 days)
```

## Key File Paths

### Program
- `programs/outcry/src/lib.rs` — Program entry (#[ephemeral] + #[program])
- `programs/outcry/src/state/auction.rs` — AuctionState, AuctionVault, BidderDeposit, AuctionStatus
- `programs/outcry/src/instructions/` — All 11 instruction handlers
- `programs/outcry/src/constants.rs` — Seeds and numeric constants
- `programs/outcry/src/errors.rs` — Custom error codes
- `programs/outcry/src/events.rs` — Event definitions
- `target/idl/outcry.json` — Generated IDL

### Frontend
- `app/src/app/page.tsx` — Homepage (auction listing)
- `app/src/app/auction/create/page.tsx` — Create auction form
- `app/src/app/auction/[id]/page.tsx` — Auction room (main UI)
- `app/src/app/profile/[address]/page.tsx` — User profile
- `app/src/hooks/useAuctionActions.ts` — All program interactions (L1 + ER)
- `app/src/hooks/useAuction.ts` — Single auction fetch + WebSocket subscription
- `app/src/hooks/useAuctions.ts` — All auctions listing (devnet + Magic Router)
- `app/src/hooks/useBidderDeposit.ts` — User's BidderDeposit PDA fetch
- `app/src/hooks/useSessionBidding.ts` — Ephemeral keypair + session-based popup-free bidding
- `app/src/lib/program.ts` — Anchor program + PDA helpers
- `app/src/lib/magic-router.ts` — ConnectionMagicRouter singleton
- `app/src/lib/constants.ts` — Program ID, seeds, endpoints
- `app/src/lib/idl.json` — Copy of IDL for frontend (keep in sync!)
- `app/src/lib/tapestry.ts` — Tapestry API client
- `app/src/lib/badges.ts` — Bubblegum badge minting
- `app/src/components/auction/BidPanel.tsx` — Deposit + bid UI

### Tests
- `tests/outcry.ts` — Anchor tests (L1 lifecycle; needs update for BidderDeposit refactor)

## Build Priority Order

If time runs short, cut from the bottom:
1. ~~Core program (L1 auction lifecycle)~~ — DONE
2. ~~MagicBlock ER integration~~ — DONE
3. ~~Frontend auction room~~ — DONE
4. ~~Tapestry social layer~~ — DONE
5. ~~Bubblegum badges~~ — DONE
6. ~~Visual polish + animations~~ — DONE
7. ~~Royalty enforcement at settlement~~ — DONE (Metaplex metadata royalties)
8. ~~Session keys (popup-free bidding)~~ — DONE
9. ~~Permissionless refunds + emergency refund~~ — DONE
10. End-to-end devnet testing — IN PROGRESS
11. Dutch auction format — STRETCH
12. pNFT royalty enforcement (Token Auth Rules) — STRETCH
13. Sealed-bid (TEE) — STRETCH

## Design Language

- Dark theme, jet black backgrounds, warm gold accents
- Serif for auction titles (gravitas), sans-serif for data (precision)
- Art is the hero — full-bleed, generous whitespace
- Timer: white → amber → red with pulse
- Bid flash: golden flash on price update
- ER delegation status: green pulsing "ER Live" badge or grey "L1" badge
- Seller sees "you cannot bid" message instead of bid controls
- Mobile-first responsive

## What NOT To Do

- Don't use BOLT ECS — we already decided against it
- Don't store SOL in ER-delegated accounts — always keep value on L1
- Don't use Anchor `.rpc()` for ER transactions — use `.transaction()` + manual blockhash
- Don't import `magic-router-sdk` directly in browser code — it uses Node.js `assert`; inline the logic instead
- Don't expose Tapestry API key to client — proxy through API routes
- Don't build Dutch/Sealed-bid before English is perfect
- Don't add pNFT complexity before standard NFTs work
- Don't over-engineer the frontend — polish comes last
- Don't skip tests on the program — settlement bugs lose money

## Reference

- Full pitch: `../PITCH.md`
- Build plan: `./BUILD-PLAN.md`
- Hackathon research: `../HACKATHON-RESEARCH.md`
