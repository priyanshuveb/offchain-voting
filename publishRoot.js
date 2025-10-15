// scripts/publishRoot.js
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {getAddress } from 'ethers';
import { ethers } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ------- ENV -------
const RPC_A_HTTP   = process.env.RPC_A;            // Chain A RPC
const PUBLISHER    = getAddress(process.env.PUBLISHER); // GovernanceRootPublisher on Chain A
const OWNER_KEY    = process.env.PRIVATE_KEY;             // private key of Publisher owner
const VOTE_VERIFIER = getAddress(process.env.VOTE_VERIFIER);     // VoteVerifier (B)

if (!RPC_A_HTTP)  throw new Error("RPC_A_HTTP not set");
if (!PUBLISHER)   throw new Error("PUBLISHER not set");
if (!OWNER_KEY)   throw new Error("OWNER_KEY not set");


const quorum     = process.env.QUORUM;
const threshold  = process.env.THRESHOLD;

// ------- Load merkle artifact -------
const MERKLE_PATH = path.join(__dirname, 'data', 'merkle.json');
if (!fs.existsSync(MERKLE_PATH)) {
  throw new Error(`Missing ${MERKLE_PATH}. Run your /api/merkle/:id freeze first.`);
}
const merkle = JSON.parse(fs.readFileSync(MERKLE_PATH, 'utf8'));

// Validate powerRoot
if (typeof merkle.root !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(merkle.root)) {
  throw new Error(`Invalid root in merkle.json: ${merkle.root}`);
}

// Resolve params
const proposalId = merkle.proposalId;
if (proposalId == null) throw new Error("proposalId missing in merkle.json");

const totalPower = merkle?.counts?.totalCounted;
if (totalPower == null) throw new Error("totalCounted missing in merkle.json counts");

console.log("Preparing publishRoot with:");
console.log({
  proposalId: String(proposalId),
  powerRoot: merkle.root,
  totalPower: String(totalPower),
  quorum,
  threshold
});

// ------- Contract call -------
const ABI = [
  "function publishRoot(uint256 proposalId, bytes32 powerRoot, uint256 totalPower, uint256 quorum, uint256 threshold) external",
  "function proposals(uint256) view returns (bytes32 actionDataHash, uint64 votingStart, uint64 votingEnd, uint256 snapshotBlock, uint256 snapshotER, uint256 deadline, bytes32 powerRoot, uint256 totalPower, uint256 quorum, uint256 threshold, bool frozen)"
];
const VERIFIER_ABI = [
  "function freezeProposal(uint256 proposalId, bytes32 powerRoot, bytes32 actionDataHash, uint64 votingStart, uint64 votingEnd, uint256 quorum, uint256 threshold) external"
];
const provider = new ethers.JsonRpcProvider(RPC_A_HTTP);
const signer   = new ethers.Wallet(OWNER_KEY, provider);
const publisherA= new ethers.Contract(PUBLISHER, ABI, signer);
const verifierB  = new ethers.Contract(VOTE_VERIFIER, VERIFIER_ABI, signer);

(async () => {
    console.log(RPC_A_HTTP);
    
console.log(PUBLISHER, VOTE_VERIFIER, provider);

  // Send tx
  const tx1 = await publisherA.publishRoot(
    BigInt(proposalId),
    merkle.root,
    BigInt(totalPower),
    BigInt(quorum),
    BigInt(threshold)
  );
  console.log("tx1 sent:", tx1.hash);
  const rcpt = await tx1.wait();
  if(rcpt.status === 0) {
      throw new Error(`tx1 failed: ${tx1.hash}`);
    }
  console.log("✅ RootPublished in block", rcpt.blockNumber);

    const proposalData = await publisherA.proposals(proposalId);
    const { actionDataHash, votingStart, votingEnd } = proposalData;
    console.log({ actionDataHash, votingStart, votingEnd });
    
    const tx2 = await verifierB.freezeProposal(
    BigInt(proposalId),
    merkle.root,
    actionDataHash,
    Number(votingStart), 
    Number(votingEnd),   
    BigInt(quorum),
    BigInt(threshold)
  );
    console.log("tx2 sent:", tx2.hash);
    const rcpt2 = await tx2.wait();
    console.log("✅ ProposalFrozen in block", rcpt2.blockNumber);

  
})().catch((e) => {
  console.error("publishRoot failed:", e);
  process.exit(1);
});
