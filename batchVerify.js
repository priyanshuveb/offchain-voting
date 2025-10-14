import { ethers } from "ethers";
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DATA_DIR = path.join(__dirname, 'data')
const VOTES_PATH = path.join(DATA_DIR, 'votes.json')

let proposalId = 2; //
// 1) fetch multiproof for ALL voters (or pass a subset in body)
const mp = await fetch(`http://localhost:3000/api/multiproof/${proposalId}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({})  // or { voters: ["0xA","0xB"] }
}).then(r => r.json());
console.log("mp:", mp);

// 2) load the stored votes (same proposal) and order them to match mp.voters
const votesDb = JSON.parse(fs.readFileSync(VOTES_PATH, "utf8"));
const all = votesDb[String(proposalId)];
// dedup to highest nonce per voter (same as freeze did)
const map = new Map();
for (const v of all) {
  const k = ethers.getAddress(v.voter);
  if (!map.has(k) || BigInt(map.get(k).nonce) < BigInt(v.nonce)) map.set(k, v);
}
const deduped = [...map.values()];
// order to match mp.voters (CRITICAL)
const batch = mp.voters.map(addr => deduped.find(v => ethers.getAddress(v.voter) === ethers.getAddress(addr)));

// 3) build votes[] struct array in the same order as mp.leaves
const votes = batch.map(v => ({
  proposalId: BigInt(v.proposalId),
  support:    v.support === "yes",
  voter:      v.voter,
  power:      BigInt(v.power),
  nonce:      BigInt(v.nonce),
  deadline:   BigInt(v.deadline),
  abstain:    v.support === "abstain",
  signature:  v.signature
}));

const votesCalldata = votes.map(v => ([
  v.proposalId,  // uint256
  v.support,     // bool
  v.voter,       // address
  v.power,       // uint256
  v.nonce,       // uint256
  v.deadline,    // uint256
  v.abstain,     // bool
  v.signature    // bytes
]));
// 4) call the verifier
const abi = [
  "function batchVerifyAndTally((uint256,bool,address,uint256,uint256,uint256,bool,bytes)[] votes, bytes32[] leaves, bytes32[] proof, bool[] proofFlags) external"
];
const provider = new ethers.JsonRpcProvider(process.env.RPC_B);
const privateKey = process.env.PRIVATE_KEY; // wallet on Chain B
if (!privateKey) throw new Error("PRIVATE_KEY not set in .env");
const signer = new ethers.Wallet(privateKey, provider); // wallet on Chain B
const verifier = new ethers.Contract(process.env.VOTE_VERIFIER, abi, signer);
console.log("Votes", votes);


const tx = await verifier.batchVerifyAndTally(votesCalldata, mp.leaves, mp.proof, mp.proofFlags);
console.log("tx hash:", tx.hash);
await tx.wait();
console.log("tx mined");