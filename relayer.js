// scripts/relayer-basic.js
import 'dotenv/config';
// import fs from 'fs';
// import path from 'path';
// import { fileURLToPath } from 'url';
import { getAddress } from 'ethers';
import { ethers } from 'ethers';

// const __filename = fileURLToPath(import.meta.url);
// const __dirname  = path.dirname(__filename);

/* ========= ENV ========= */
const RPC_B_WS        = process.env.WSS_B;              // Chain B WS (for listening)
const RPC_A_HTTP      = process.env.RPC_A;            // Chain A HTTP (for sending)
const VOTE_VERIFIER   = getAddress(process.env.VOTE_VERIFIER); // VoteVerifier on B
const EXECUTOR_A      = getAddress(process.env.EXECUTOR_A);    // GovernanceExecutor on A
const RELAYER_KEY_A   = process.env.PRIVATE_KEY;         // private key to call executor on A
const PUBLISHER      = getAddress(process.env.PUBLISHER);    // GovernanceRootPublisher on A

if (!RPC_B_WS || !RPC_A_HTTP || !VOTE_VERIFIER || !EXECUTOR_A || !RELAYER_KEY_A) {
  throw new Error("Missing required env: RPC_B_WS, RPC_A_HTTP, VOTE_VERIFIER, EXECUTOR_A, RELAYER_KEY_A");
}

/* ========= Files =========
   A tiny map from proposalId -> how to build actionData
   You create this when you create your proposal (or hardcode one entry).
   Format shown below. */
// const ACTIONS_PATH = path.join(__dirname, 'actions.json');

/* ========= ABIs ========= */
const VERIFIER_ABI = [
  "event ProposalPassed(uint256 indexed proposalId, bytes32 actionDataHash)"
];
const EXECUTOR_ABI = [
  // your executor on Chain A
  "function executeIfAuthorized(bytes calldata actionData) external returns (bool)",
  "function commitAction(bytes32 actionDataHash) external"
];

const PUBLISHER_ABI = [
  "function proposals(uint256) view returns (bytes32 actionDataHash, uint64 votingStart, uint64 votingEnd, uint256 snapshotBlock, uint256 snapshotER, uint256 deadline, bytes32 powerRoot, uint256 totalPower, uint256 quorum, uint256 threshold, bool frozen)"
];

// /* ========= Helpers ========= */
// function loadActions() {
//   try { return JSON.parse(fs.readFileSync(ACTIONS_PATH, 'utf8')); }
//   catch { return {}; }
// }

// Encode actionData exactly as your GovernanceExecutor expects.
// Common pattern used here: abi.encode(address target, uint256 value, bytes data)
// function buildActionData(record) {
//   const { chainA_target, value = "0", fnSig, args = [] } = record;
//   const iface  = new Interface([`function ${fnSig}`]);
//   const fnName = fnSig.slice(0, fnSig.indexOf('('));
//   const data   = iface.encodeFunctionData(fnName, args);
//   const abi    = new AbiCoder();
//   return abi.encode(["address","uint256","bytes"], [getAddress(chainA_target), BigInt(value), data]);
// }

/* ========= Main ========= */
async function main() {
  console.log("Relayer (basic) starting…");

  const providerB = new ethers.WebSocketProvider(RPC_B_WS);
  const providerA = new ethers.JsonRpcProvider(RPC_A_HTTP);
  const signerA   = new ethers.Wallet(RELAYER_KEY_A, providerA);

  const verifier  = new ethers.Contract(VOTE_VERIFIER, VERIFIER_ABI, providerB);
  const executor  = new ethers.Contract(EXECUTOR_A, EXECUTOR_ABI, signerA);
  const publisher = new ethers.Contract(PUBLISHER, PUBLISHER_ABI, providerA);

  console.log("Listening on B:", VOTE_VERIFIER);
  console.log("Executing on A:", EXECUTOR_A, "as", await signerA.getAddress());
//   console.log("Actions source:", ACTIONS_PATH);

  // In-memory guard to avoid duplicate execution in one process
  const executed = new Set();

  verifier.on("ProposalPassed", async (proposalId, actionDataHashEmit, ev) => {

    const proposalData = await publisher.proposals(proposalId);
    const { actionDataHash } = proposalData;
    if (actionDataHash !== actionDataHashEmit) {
      console.error(`Hash mismatch for pid=${proposalId}\n  event: ${actionDataHashEmit}\n  publisher: ${actionDataHash}`);
      return;
    }
    try {
      const pid = proposalId.toString();
      if (executed.has(pid)) {
        console.log(`(skip) Already executed pid=${pid} in this run`);
        return;
      }
      const data = "0x000000000000000000000000689801367256cf9752d26e7c9f8cd39dbd9c2acb0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000247da153df00000000000000000000000000000000000000000000000000000000000000c800000000000000000000000000000000000000000000000000000000"
      console.log(`[B] ProposalPassed pid=${pid} hash=${actionDataHash} (block ${ev.blockNumber})`);
    //   const actions = loadActions();
    //   const rec = actions[pid];

    //   if (!rec) {
    //     console.error(`No action configured for proposal ${pid} in ${ACTIONS_PATH}`);
    //     return;
    //   }

    //   // 1) Build actionData and confirm hash matches event
    //   const actionData = buildActionData(rec);
    //   const computedHash = keccak256(actionData);
    //   if (computedHash.toLowerCase() !== actionDataHash.toLowerCase()) {
    //     console.error(`Hash mismatch for pid=${pid}\n  local: ${computedHash}\n  event: ${actionDataHash}`);
    //     return;
    //   }

      // 2) Execute on Chain A
    //   console.log(`[A] Calling commitAction(pid=${pid})…`);
    //   const tx0 = await executor.commitAction(actionDataHash);
    //   await tx0.wait();
      console.log(`[A] Calling executeIfAuthorized(pid=${pid})…`);
      const tx = await executor.executeIfAuthorized(data);
      console.log(`tx sent: ${tx.hash}`);
      const rcpt = await tx.wait();
      console.log(`✅ Executed in block ${rcpt.blockNumber}`);

      executed.add(pid);
    } catch (e) {
      console.error("Relayer error:", e);
    }
  });

  process.on("SIGINT", () => {
    console.log("Shutting down relayer…");
    providerB.destroy?.();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
