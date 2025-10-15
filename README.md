# Mini Cross-Chain Governance — Frontend

A minimal UI to demo **Liquid Staking + Off-Chain Voting + Cross-Chain Execution** across two chains:

- **Chain A** — Staking & Governance Publisher (snapshots, root publish, on-chain execution)  
- **Chain B** — Vote Verifier (EIP-712 signature verification + Merkle multiproof tally)

This frontend focuses on user-facing actions (depositing, voting, proof creation). Privileged steps (root freeze, proposal freeze, relay) are provided as scripts.

---

## Features (UI)

1. **Claim ASSET** (demo faucet)
2. **Approve & Deposit** into **LiquidStakingVault** (Chain A)
3. **Create Proposal** (Chain A, owner-gated)
4. **Load Proposal** (snapshot block/ER, voting window)
5. **Vote (gasless)** via **EIP-712** (stored off-chain)
6. **Create Merkle Root & Multiproof** (server builds from recorded votes)

> Owner/relayer steps are scripted (not in UI):
> - `./publishRoot.js`
> - `./batchVerifyAndTally.js`
> - `./relayer.js`
> - `./actionData.js`

---

## Repository Layout

```
/public
  index.html              # Single-page UI
/server.js                # Express backend: vote ingest, power @ snapshot, Merkle build
/data
  votes.json              # Off-chain votes (dedup by highest nonce per voter)
  merkle.json             # Frozen artifact (root, ordered leaves, tallies)
/publishRoot.js
/batchVerifyAndTally.js
/relayer.js
/actionData.js
.env.example
README.md
```

---

## Prerequisites

- Node.js 18+
- MetaMask (or any EIP-1193 wallet)
- Deployed contracts (addresses available):
  - **Asset** (ERC20)
  - **LiquidStakingVault**
  - **WithdrawalNFT**
  - **GovernanceRootPublisher** (Chain A)
  - **VoteVerifier** (Chain B)
  - **GovernanceExecutor** (Chain A)

---

## Environment

Create a `.env` file from `.env.example`:

```ini
# ---------- Chain A ----------
RPC_A=https://<your-chain-a-rpc>
PUBLISHER=0x...          # GovernanceRootPublisher (Chain A)
EXECUTOR=0x...           # GovernanceExecutor (Chain A)
ASSET=0x...              # ERC20 Asset (Chain A)
LST=0x...                # LST (Vault share) on Chain A
VAULT=0x...              # LiquidStakingVault (Chain A)

# ---------- Chain B ----------
RPC_B=https://<your-chain-b-rpc>
VOTE_VERIFIER=0x...      # VoteVerifier (Chain B)
CHAIN_B_ID=84532         # Example: Base Sepolia (use your chainId)

# ---------- Server/Relayer wallet (testnets only) ----------
PRIVATE_KEY=0x...

# ---------- Governance params (examples) ----------
QUORUM=100000000000000000000
THRESHOLD=1000000000000000000
```

---

## Install & Run

```bash
npm install
npm start
```

- App: http://localhost:3000/  
- Static UI: `/public/index.html`  
- API: `/api/*`

> The server also acts as a mini-Snapshot backend: recomputes voting power at snapshot, verifies EIP-712, stores votes, builds Merkle roots/multiproofs.

---

## Using the UI

### 0) Connect Wallet
Click **Connect Wallet**. Used for EIP-712 signing and owner-gated tx (e.g., `createProposal`).

### 1) Claim ASSET (optional)
Click **Get ASSET** to call `Asset.getAsset()` and receive 100 ASSET for demo.

### 2) Approve & Deposit (Chain A)
- **Approve Vault** for desired ASSET amount.
- **Deposit via Relay** — backend calls `vault.depositFor(owner, receiver, assets)` once you’ve approved the vault.

### 3) Create Proposal (Chain A)
- Inputs:
  - `actionDataHash` (0x-32 bytes)
  - `votingStart`, `votingEnd` (unix seconds)
- Requires publisher owner.
- The UI makes a static call to get the **proposalId**, then sends the tx.

### 4) Load Proposal
Displays:
- Snapshot block
- Snapshot exchange rate (ER)
- Voting window
- EIP-712 domain (verifier address + chainId)

### 5) Vote (gasless EIP-712)
- Choose **Yes / No / Abstain** → **Sign & Submit**
- Backend:
  - Recomputes power at snapshot:  
    `power = ASSET_at_snapshot + floor(LST_at_snapshot * ER_snapshot / 1e18)`
  - Verifies signature, dedups by highest nonce per voter
  - Stores in `data/votes.json`

### 6) Create Merkle Root
- **Freeze**: dedup votes (highest nonce), sort, build leaves `keccak256(abi.encode(voter,power))`, compute root → `data/merkle.json`
- **Multiproof**: returns `leaves`, `proof`, `proofFlags` (all voters by default)

> For production, freezing should be restricted until `votingEnd`. Demo can freeze anytime.

---

## Scripted / Privileged Steps

### A) Publish root on Chain A (and optionally freeze on Chain B)
```bash
node scripts/publishRoot.js
```
- Calls `GovernanceRootPublisher.publishRoot(proposalId, powerRoot, totalPower, quorum, threshold)` on **Chain A**
- Optionally calls `VoteVerifier.freezeProposal(...)` on **Chain B**

### B) Verify & Tally (Chain B)
```bash
node scripts/batchVerifyAndTally.js
```
- Calls `VoteVerifier.batchVerifyAndTally(votes, leaves, proof, proofFlags)`
- Emits `ProposalPassed(proposalId, actionDataHash)` if quorum + threshold met

### C) Relay execution to Chain A
```bash
node scripts/relayer.js
```
- Listens to **VoteVerifier** `ProposalPassed` (Chain B)
- Calls **GovernanceExecutor** `executeIfAuthorized(actionData)` on **Chain A**

### D) Build action data & hash
```bash
node scripts/actionData.js
```
- Produces:
  - `actionData = abi.encode(target, value, calldata)`
  - `actionDataHash = keccak256(actionData)`
- Use `actionDataHash` at proposal creation/freeze; the relayer submits `actionData` when executing.

---

## Assumptions & Design Choices

- **Off-chain votes**: EIP-712 signatures are gathered in the UI and stored server-side.
- **Snapshot power**:  
  `power = ASSET_balance(snapshotBlock) + floor(LST_balance(snapshotBlock) * ER_snapshot / 1e18)`
- **Rounding**: Favor **floor** to avoid rounding exploits.
- **Merkle**: Leaves are `keccak256(abi.encode(voter, power))`; multiproof verified on Chain B.
- **Nonces**: Highest nonce per (proposal, voter) is counted.
- **Bridging**: No production bridge; `relayer.js` simulates cross-chain by listening on B and executing on A.

---

## End-to-End Flow

1. User deposits ASSET → receives LST (shares).  
2. Owner creates proposal on Chain A (snapshot taken).  
3. Users vote off-chain (EIP-712). Backend stores votes.  
4. Owner runs `publishRoot.js` to publish/freeze root(s).  
5. Run `batchVerifyAndTally.js` on Chain B to verify multiproof & tally.  
6. If passed, `ProposalPassed` is emitted on Chain B.  
7. `relayer.js` catches it → executes `actionData` on Chain A.

---

## Troubleshooting

- **“outside voting window”**: Current time not within `[votingStart, votingEnd]`.
- **Bad signature**: Check EIP-712 domain (chainId, verifyingContract), typed data, voter address.
- **Empty multiproof**: Valid when proving all leaves in small trees (flags suffice).
- **`onlyOwner` reverts**: Ensure connected account is the contract owner.

---

## Security Notes (demo level)

- `PRIVATE_KEY` is a hot key for scripts/relays — use testnets only.
- No rate limiting on vote ingestion.
- No production bridge; relayer is a simple listener/executor.
- The deployed addresses and PRIVATE_KEY(Owner) can be provided for a quick testing

---

## License

MIT. Demo code; use at your own risk.