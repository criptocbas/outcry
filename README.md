<p align="center">
  <strong style="font-size: 2em;">OUTCRY</strong>
</p>

<h3 align="center"><em>Going, going, onchain.</em></h3>

<p align="center">
  Real-time live auctions on Solana. Every bid confirms in under 50 milliseconds.
</p>

<p align="center">
  <a href="#architecture">Architecture</a> &middot;
  <a href="#getting-started">Getting Started</a> &middot;
  <a href="#program">Program</a> &middot;
  <a href="#frontend">Frontend</a> &middot;
  <a href="#bounties">Bounties</a>
</p>

---

## What is OUTCRY?

OUTCRY is a real-time live auction protocol on Solana where artists list NFTs, collectors compete in real-time, and spectators watch — all onchain. Built for the [Graveyard Hackathon](https://www.colosseum.org/).

Traditional onchain auctions suffer from ~400ms block times. OUTCRY uses **MagicBlock Ephemeral Rollups** to achieve sub-50ms bid confirmations while keeping all value (SOL deposits, NFT escrow) safely on L1. The result is an auction experience that feels instant.

### Key Features

- **Sub-50ms bidding** via MagicBlock Ephemeral Rollups
- **Deposit-then-bid architecture** — SOL stays on L1, only auction state enters the ER
- **Anti-sniping** — late bids extend the auction timer
- **Anti-shill** — sellers cannot bid on their own auctions (enforced onchain)
- **Social layer** — profiles, follows, likes, and comments via Tapestry
- **Compressed NFT badges** — Contender and Victor badges via Bubblegum
- **Automatic settlement** — end auction, undelegate, settle, and mint badges in one click
- **Session keys (popup-free bidding)** — enable quick bidding with one click, then bid instantly with zero wallet popups
- **Bid speed indicator** — every bid shows confirmation time (e.g. "confirmed in 42ms")
- **Explorer links** — every transaction toast links directly to Solana Explorer
- **ER fallback** — automatic L1 fallback when Magic Router is unavailable
- **Permissionless refunds** — sellers can refund all bidders in one click, unblocking auction closure
- **Force close** — sellers can recover stuck accounts after 7-day grace period
- **Mobile-first responsive design** with dark theme and warm gold accents

---

## Architecture

```
                    ┌──────────────────────────────┐
                    │         OUTCRY Frontend       │
                    │     Next.js 16 / React 19     │
                    └──────┬───────────┬────────────┘
                           │           │
                    L1 ops │           │ ER ops
                           │           │
              ┌────────────▼──┐  ┌─────▼──────────────┐
              │  Solana L1    │  │  MagicBlock ER      │
              │  (devnet)     │  │  (Ephemeral Rollup) │
              │               │  │                     │
              │ create_auction│  │ place_bid  (<50ms)  │
              │ deposit       │  │ place_bid_session   │
              │ start_auction │  │  (popup-free, <50ms)│
              │ delegate      │  │ end_auction         │
              │ create_session│  │ undelegate_auction   │
              │ settle_auction│  └─────────────────────┘
              │ claim_refund  │
              │ cancel_auction│
              │ close_auction │
              │ forfeit       │
              └───────────────┘

    ┌─────────────────┐  ┌──────────────┐  ┌───────────────┐
    │  Tapestry API   │  │  Helius DAS  │  │  Metaplex     │
    │  (Social Layer) │  │  (cNFT Fetch)│  │  (Bubblegum)  │
    └─────────────────┘  └──────────────┘  └───────────────┘
```

### The Deposit-Then-Bid Pattern

OUTCRY uses a "Shield Poker" pattern to separate value custody from real-time state:

1. **BidderDeposit PDAs** live on L1 — each bidder has a per-auction deposit account that is **never delegated** to the ER
2. **AuctionState** delegates to the ER for sub-50ms bid updates
3. **Deposits work anytime** — even while the auction is delegated, because the deposit instruction uses `UncheckedAccount` for the auction state
4. **`place_bid` on ER skips deposit validation** — it only updates the bid. This is safe because...
5. **`settle_auction` on L1 verifies** the winner's deposit >= their winning bid before transferring anything

This means the ER never touches money. All SOL stays in the vault on L1.

### Auction Lifecycle

```
create_auction (L1)  ─── Artist escrows NFT, sets reserve price + duration
     │
     ├── deposit (L1)  ─── Bidders deposit SOL anytime (even during ER delegation)
     │
     ├── start_auction (L1)  ─── Timer begins
     │
     ├── delegate_auction (L1 → ER)  ─── AuctionState moves to Ephemeral Rollup
     │
     ├── create_session (L1, optional)  ─── Enable popup-free bidding
     │
     ├── place_bid (ER)  ─── Sub-50ms confirmations, anti-snipe extension
     │     └── (or place_bid_session — same speed, zero wallet popups)
     │
     ├── end_auction (ER)  ─── Timer expired, status → Ended
     │
     ├── undelegate_auction (ER → L1)  ─── State returns to L1
     │
     ├── settle_auction (L1)  ─── NFT → winner, SOL → seller (verifies deposit)
     │
     ├── claim_refund (L1)  ─── Losing bidders reclaim their deposits
     │     └── (or claim_refund_for — anyone can trigger refund to a bidder)
     │
     └── close_auction (L1)  ─── Close accounts, reclaim rent
```

### Status Flow

```
Created ──→ Active ──→ Ended ──→ Settled
   │
   └──→ Cancelled  (only if no bids placed)
```

---

## Program

**Program ID:** `J7r5mzvVUjSNQteoqn6Hd3LjZ3ksmwoD5xsnUvMJwPZo`

**Deployed to:** Solana Devnet

### Accounts

| Account | Seeds | Purpose |
|---------|-------|---------|
| `AuctionState` | `["auction", seller, nft_mint]` | Core auction data — delegated to ER during live bidding |
| `AuctionVault` | `["vault", auction_state]` | Holds SOL deposits — **never** delegated |
| `BidderDeposit` | `["deposit", auction_state, bidder]` | Per-bidder deposit tracking — stays on L1 |
| `SessionToken` | `["session", auction_state, bidder]` | Links ephemeral browser key to real wallet for popup-free bidding — stays on L1 |

### Instructions

| Instruction | Layer | Description |
|-------------|-------|-------------|
| `create_auction` | L1 | Initialize auction state + vault, escrow NFT into token account |
| `deposit` | L1 | Bidder deposits SOL to vault (works anytime, even during ER delegation) |
| `start_auction` | L1 | Set status to Active, start countdown timer |
| `delegate_auction` | L1 | Delegate AuctionState to MagicBlock Ephemeral Rollup |
| `place_bid` | ER | Update current bid + highest bidder (sub-50ms, no deposit check) |
| `place_bid_session` | ER | Same as `place_bid` but signed by ephemeral session key (zero wallet popups) |
| `create_session` | L1 | Register ephemeral browser key → real wallet link for session bidding |
| `end_auction` | ER | Set status to Ended when timer expires |
| `undelegate_auction` | ER→L1 | Commit final state back to L1 |
| `settle_auction` | L1 | Transfer NFT to winner, distribute SOL to seller. Verifies winner's deposit >= bid |
| `claim_refund` | L1 | Losing bidders reclaim their BidderDeposit |
| `claim_refund_for` | L1 | Permissionless refund — anyone can trigger a refund to a specific bidder |
| `cancel_auction` | L1 | Seller cancels (only if Created, no bids placed) |
| `close_auction` | L1 | Close all accounts, reclaim rent (only after all refunds claimed) |
| `forfeit_auction` | L1 | Handle winner default — slash deposit, return NFT to seller |
| `force_close_auction` | L1 | Force-close after 7-day grace period, drain unclaimed deposits to seller |

### Safety Mechanisms

- **Anti-sniping:** Bids within the last 5 minutes extend the timer by 5 minutes
- **Anti-shill:** `SellerCannotBid` constraint enforced onchain
- **Deposit verification:** Settlement atomically checks `winner_deposit.amount >= auction_state.current_bid`
- **Vault protection:** `close_auction` verifies vault is empty (rent-exempt only) before closing
- **NFT mint validation:** Settlement and forfeit verify the correct NFT is being transferred
- **Overflow protection:** All arithmetic uses checked operations
- **ER fallback:** Transparent L1 fallback when Magic Router is unavailable
- **Permissionless refunds:** Sellers (or anyone) can trigger refunds for bidders via `claim_refund_for`, unblocking auction closure without waiting for each bidder to claim individually
- **Force close:** 7-day grace period prevents permanent account lockup from unclaimed deposits
- **Session keys:** Ephemeral browser keypairs linked to real wallets via `SessionToken` PDA — bidder identity is always the real wallet for settlement and deposit matching

### Session Keys (Popup-Free Bidding)

In a competitive bidding war, wallet approval popups kill the real-time feel. OUTCRY implements session keys to eliminate this friction:

1. **Enable session** — User clicks "Enable Quick Bidding" (one wallet popup): deposits SOL, funds an ephemeral browser keypair, and creates a `SessionToken` PDA on L1 linking the ephemeral key to their real wallet
2. **Bid instantly** — Every subsequent bid is signed by the ephemeral key and sent directly to the ER — zero popups, ~50ms per bid
3. **Identity preserved** — `place_bid_session` reads the `SessionToken` to set `highest_bidder` to the real wallet, so settlement, deposit verification, and anti-shill checks all work identically to normal bids

The `SessionToken` PDA lives on L1 (never delegated). The ER clones it as a read-only account when processing `place_bid_session`. If the user refreshes the page, the ephemeral key is lost and they re-enable with one popup (`init_if_needed` updates the session signer).

See [SECURITY.md](SECURITY.md) for the full threat model and access control matrix.

### Error Codes

```
BidTooLow              — Bid doesn't meet minimum increment
AuctionEnded           — Timer has expired
BelowReserve           — First bid must meet reserve price
InsufficientDeposit    — Winner didn't deposit enough for their bid
SellerCannotBid        — Sellers can't bid on their own auctions
OutstandingDeposits    — Can't close auction while deposits remain
CannotCancelWithBids   — Can only cancel before any bids
```

### Build & Deploy

```bash
# Build the program
anchor build

# Run tests (localnet)
anchor test

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Deploy with custom RPC (recommended for reliability)
anchor deploy --provider.cluster https://devnet.helius-rpc.com/?api-key=YOUR_KEY
```

---

## Frontend

### Tech Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| Next.js | 16 | App Router, React Server Components |
| React | 19 | UI framework |
| Tailwind CSS | 4 | Styling with custom theme |
| Framer Motion | 12 | Animations and transitions |
| Anchor | 0.32.1 | Program client (IDL-based) |
| @solana/web3.js | 1.98 | Solana RPC and transactions |
| @solana/wallet-adapter | latest | Wallet connection (Phantom, Solflare, etc.) |
| MagicBlock SDK | 0.8.5 | ConnectionMagicRouter for ER transaction routing |
| Metaplex Umi + Bubblegum | latest | Compressed NFT badge minting and fetching |

### Design System

| Token | Value | Usage |
|-------|-------|-------|
| `gold` | `#C6A961` | Primary accent, CTAs, bid amounts |
| `gold-light` | `#D4B872` | Hover states |
| `gold-dark` | `#A68B4B` | Active states |
| `cream` | `#F5F0E8` | Primary text |
| `jet` | `#050505` | Background |
| `charcoal` | `#1A1A1A` | Card backgrounds |
| `charcoal-light` | `#2A2A2A` | Borders, dividers |
| `muted` | `#6B6B6B` | Secondary text |
| Font (headings) | Playfair Display | Serif — gravitas for auction titles |
| Font (body) | DM Sans | Sans-serif — precision for data |

### Pages

| Route | Description |
|-------|-------------|
| `/` | Homepage — hero section + auction discovery grid |
| `/auction/create` | Create auction form with live NFT preview |
| `/auction/[id]` | Auction room — bidding, countdown, bid history, social |
| `/profile/[address]` | User profile — badges, auction history, social stats |

### Key Components

- **BidPanel** — Unified deposit + bid flow with quick-bid buttons, minimum bid validation, and multi-step progress labels
- **CountdownTimer** — Real-time countdown with color states (white → amber → red pulse)
- **BidHistory** — Animated bid feed with Tapestry username resolution
- **AuctionCard** — Compact auction preview with NFT art, live timer, bid count
- **ProfileBadge** — Avatar + username with Tapestry profile lookup
- **BadgeGrid** — Compressed NFT badge display (Contender / Victor)
- **CommentSection** — Real-time comments with avatar hashing
- **FollowButton** — Follow/unfollow with hover state ("Following" → "Unfollow")
- **LikeButton** — Optimistic like toggle with count polling

### Getting Started

```bash
# Clone the repository
git clone https://github.com/criptocbas/outcry.git
cd outcry

# Install program dependencies
npm install

# Install frontend dependencies
cd app
npm install

# Set up environment variables
cp .env.local.example .env.local
# Edit .env.local with your keys:
#   TAPESTRY_API_KEY=your_tapestry_api_key
#   NEXT_PUBLIC_HELIUS_RPC=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
#   NEXT_PUBLIC_BADGE_MERKLE_TREE=your_merkle_tree_address
#   BADGE_TREE_AUTHORITY_KEY=your_tree_authority_keypair_json

# Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TAPESTRY_API_KEY` | Yes | Tapestry API key for social features (server-side only) |
| `NEXT_PUBLIC_HELIUS_RPC` | Yes | Helius RPC endpoint for DAS API support |
| `NEXT_PUBLIC_BADGE_MERKLE_TREE` | For badges | Bubblegum merkle tree address |
| `BADGE_TREE_AUTHORITY_KEY` | For badges | JSON keypair for tree authority (server-side only) |

### Project Structure

```
app/src/
├── app/                          # Next.js App Router pages
│   ├── layout.tsx                # Root layout (fonts, providers, header)
│   ├── page.tsx                  # Homepage (hero + auction grid)
│   ├── globals.css               # Tailwind theme + custom animations
│   ├── auction/
│   │   ├── create/page.tsx       # Create auction form
│   │   └── [id]/page.tsx         # Auction room
│   ├── profile/
│   │   └── [address]/page.tsx    # User profile + badges
│   └── api/                      # API routes (Tapestry proxy, badge minting)
│       ├── badges/mint/route.ts
│       └── tapestry/             # Proxied Tapestry endpoints
├── components/
│   ├── layout/Header.tsx         # Navigation + wallet connect
│   ├── auction/                  # Auction-specific components
│   ├── social/                   # Profile, follow, like, comment
│   ├── badges/                   # Badge display components
│   └── ui/Spinner.tsx            # Shared spinner
├── hooks/                        # React hooks
│   ├── useAuctionActions.ts      # All program interactions (L1 + ER)
│   ├── useAuction.ts             # Single auction fetch + polling
│   ├── useAuctions.ts            # All auctions listing
│   ├── useBidderDeposit.ts       # User's deposit PDA
│   ├── useNftMetadata.ts         # NFT metadata via Helius DAS
│   ├── useTapestryProfile.ts     # Tapestry profile resolution
│   ├── useFollowStatus.ts        # Follow/unfollow with rapid-click guard
│   ├── useAuctionLike.ts         # Like with optimistic updates + rollback
│   ├── useAuctionComments.ts     # Real-time comments
│   ├── useSessionBidding.ts     # Ephemeral keypair + popup-free session bidding
│   └── useBadges.ts              # Badge fetching via DAS
├── lib/
│   ├── constants.ts              # Program IDs, RPC endpoints, seeds
│   ├── program.ts                # Anchor program + PDA helpers
│   ├── magic-router.ts           # ConnectionMagicRouter singleton
│   ├── tapestry.ts               # Typed Tapestry API client
│   ├── badges.ts                 # Bubblegum badge minting + fetching
│   ├── idl.json                  # Anchor IDL (keep in sync with program!)
│   └── utils.ts                  # formatSOL, truncateAddress, etc.
└── providers/
    ├── Providers.tsx              # Wallet + connection providers
    └── UmiProvider.tsx            # Metaplex Umi context
```

---

## Bounties

OUTCRY targets five bounty tracks:

### MagicBlock ($5K) — First non-gaming use of Ephemeral Rollups

OUTCRY is the first real-time commerce application on Ephemeral Rollups. The deposit-then-bid architecture cleanly separates value custody (L1) from real-time state updates (ER), proving ERs work beyond gaming.

**Key technical decisions:**
- `AuctionState` delegates to ER; `AuctionVault` and `BidderDeposit` stay on L1
- Deposits use `UncheckedAccount` for auction state (works during delegation)
- `place_bid` defers deposit validation to settlement
- Manual blockhash fetching from Magic Router (wallet adapters can't use ER blockhash natively)
- `ConnectionMagicRouter` singleton auto-routes delegated vs non-delegated accounts

### Exchange Art ($5K) — Art/NFT auction platform

Full English auction implementation with:
- Reserve price enforcement
- Anti-sniping (5-minute extension on late bids)
- Anti-shill bidding (seller can't bid, enforced onchain)
- NFT escrow during auction
- Automatic royalty distribution at settlement via Metaplex metadata

### Tapestry ($5K) — Social profiles and discovery

Complete social layer integration:
- Profile creation and editing (username, bio, avatar)
- Follow/unfollow between users
- Like and comment on auctions
- Auction settlement result posts
- All Tapestry API calls proxied through Next.js API routes (API key never exposed to client)

### DRiP ($2.5K) — Compressed NFT badges

Bubblegum-powered badge system:
- **Victor** — Awarded to the auction winner (includes winning bid amount)
- **Contender** — Awarded to all other bidders
- Merkle tree: depth 14 (16,384 max badges), canopy depth 11
- On-chain verification: badge endpoint checks auction is in Settled status before minting
- Deduplication: in-memory guard prevents double-minting per auction
- Badge display on user profiles via Helius DAS API

### Overall Prizes ($30K pool)

End-to-end auction platform with polished UX:
- Framer Motion animations throughout (staggered card entrance, bid flash, timer pulse)
- Mobile sticky bid bar for small screens
- Skeleton loading states
- Toast notifications with accessibility (`role="alert"`)
- Two-click confirmation for settlement
- Outbid notifications
- Wallet-optional browsing (read-only mode without wallet)

---

## Protocol Constants

| Constant | Value | Description |
|----------|-------|-------------|
| Protocol fee | 2.5% | Deducted from winning bid at settlement |
| Min bid increment | 0.1 SOL | Default; configurable per auction |
| Extension window | 5 minutes | Bids in this window trigger anti-snipe |
| Extension time | 5 minutes | Added to timer on late bids |
| Min duration | 5 minutes | Minimum auction length |
| Max duration | 7 days | Maximum auction length |
| Badge tree capacity | 16,384 | Max compressed NFT badges |
| Force close grace | 7 days | Grace period before sellers can force-close |

---

## Development

### Prerequisites

- [Rust](https://rustup.rs/) 1.75+
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) 2.0+
- [Anchor CLI](https://www.anchor-lang.com/docs/installation) 0.32.1
- [Node.js](https://nodejs.org/) 20+

### Commands

```bash
# Program
anchor build                    # Build the Rust program
anchor test                     # Run localnet tests
anchor deploy --provider.cluster devnet  # Deploy to devnet

# Frontend
cd app
npm run dev                     # Start dev server (port 3000)
npm run build                   # Production build
npm run lint                    # ESLint check
npm test                        # Run Vitest test suite (37 tests)
```

### Testing

```bash
# Unit tests (localnet — clones Token Metadata from mainnet)
anchor test

# E2E tests (devnet — requires deployed program)
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/devnet-e2e.ts
```

### Critical: ER Transaction Pattern

Wallet adapters call `getLatestBlockhash()` which returns the L1 blockhash, but the ER has its own blockhash progression. Sending ER transactions with `.rpc()` will fail with "Blockhash not found."

The correct pattern (used in `useAuctionActions.ts`):

```typescript
// 1. Build unsigned transaction
const tx = await erProgram.methods.placeBid(amount).accounts({...}).transaction();
tx.feePayer = publicKey;

// 2. Get ER-correct blockhash from Magic Router
const { blockhash } = await getMagicBlockhash(connection.rpcEndpoint, tx);
tx.recentBlockhash = blockhash;

// 3. Sign with wallet adapter
const signed = await wallet.signTransaction(tx);

// 4. Send raw bytes (bypass wallet's sendTransaction override)
const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true });
```

---

## Demo Flow

Here's the full end-to-end flow on devnet:

1. **Connect wallet** — Phantom or Solflare on devnet
2. **Create auction** — Select an NFT from your wallet, set reserve price (e.g. 1 SOL), duration (e.g. 10 min)
3. **Start + Delegate** — Click "Go Live" to start the timer and delegate to the Ephemeral Rollup
4. **Deposit SOL** — From a second wallet, deposit enough SOL to cover your maximum bid
5. **Enable Quick Bidding** (optional) — Click "Enable Quick Bidding" for popup-free bids (one wallet approval)
6. **Place bids** — Bid in real-time — each bid confirms in under 50ms with a speed indicator (zero popups with session keys)
7. **Anti-snipe** — Bid in the last 5 minutes to see the timer extend
8. **Settle** — After the timer expires, click "Settle" to transfer the NFT and distribute SOL
9. **Claim refund** — Losing bidders click "Claim Refund", or the seller clicks "Refund All Bidders" to return all deposits at once
10. **Badges** — Winner receives a Victor badge, bidders receive Contender badges (visible on profile page)

Every transaction shows an explorer link in the toast notification for on-chain verification.

---

## License

ISC

---

<p align="center">
  <em>Built for the <a href="https://www.colosseum.org/">Graveyard Hackathon</a> on Solana</em>
</p>
