// server.js
import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import {
  JsonRpcProvider,
  Contract,
  keccak256,
  AbiCoder,
  getAddress,
} from 'ethers'
import { MerkleTree } from 'merkletreejs'
import { log } from 'console'

dotenv.config()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const DATA_DIR = path.join(__dirname, 'data')
const VOTES_PATH = path.join(DATA_DIR, 'votes.json')
const MERKLE_PATH = path.join(DATA_DIR, 'merkle.json')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR)
if (!fs.existsSync(VOTES_PATH))
  fs.writeFileSync(VOTES_PATH, JSON.stringify({}), 'utf8')

// ---- Config ----
const RPC_URL = process.env.RPC_URL // Chain A RPC for balances & publisher
const CHAIN_B_ID = Number(process.env.CHAIN_B_ID) // Chain B chainId for EIP-712 domain (verifier lives here)
const VOTE_VERIFIER = process.env.VOTE_VERIFIER // Chain B VoteVerifier address
const PUBLISHER = process.env.PUBLISHER // Chain A GovernanceRootPublisher address
const ASSET = process.env.ASSET // ERC20 asset on Chain A
const LST = process.env.LST // LST (shares) on Chain A

const provider = new JsonRpcProvider(RPC_URL)

// ---- ABIs (fragments) ----
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)']
const PUBLISHER_ABI = [
  'function getSnapshot(uint256) view returns (uint64 snapshotBlock, uint256 snapshotER)',
  'function getWindow(uint256) view returns (uint64 votingStart, uint64 votingEnd)',
]

// ---- Helpers ----
function readVotes() {
  return JSON.parse(fs.readFileSync(VOTES_PATH, 'utf8') || '{}')
}
function writeVotes(db) {
  fs.writeFileSync(VOTES_PATH, JSON.stringify(db, null, 2))
}
function writeMerkle(m) {
  fs.writeFileSync(MERKLE_PATH, JSON.stringify(m, null, 2))
}

function eip712Domain() {
  return {
    name: 'CrossGov',
    version: '1',
    chainId: CHAIN_B_ID,
    verifyingContract: VOTE_VERIFIER,
  }
}

const EIP712_TYPES = {
  Vote: [
    { name: 'proposalId', type: 'uint256' },
    { name: 'support', type: 'bool' }, // true/false; "abstain" we’ll encode as false + separate flag if needed
    { name: 'voter', type: 'address' },
    { name: 'power', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
}

function leafBuf(addr, power) {
  const enc = AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint256'],
    [getAddress(addr), BigInt(power)]
  )
  return Buffer.from(keccak256(enc).slice(2), 'hex')
}

// keccak(Buffer) -> Buffer
function keccakBuf(data) {
  return Buffer.from(keccak256(data).slice(2), 'hex')
}

// ---- Lazy power computation (at vote time) ----
async function computePowerAt(proposalId, voter) {
  const publisher = new Contract(PUBLISHER, PUBLISHER_ABI, provider)
  const [snapshotBlock, snapshotER] = await publisher.getSnapshot(proposalId)
  const asset = new Contract(ASSET, ERC20_ABI, provider)
  const lst = new Contract(LST, ERC20_ABI, provider)

  const a = await asset.balanceOf(voter, { blockTag: Number(snapshotBlock) })
  const l = await lst.balanceOf(voter, { blockTag: Number(snapshotBlock) })

  const ER_SCALAR = 10n ** 18n
  const power = a + (l * snapshotER) / ER_SCALAR // floor via integer division
  return { power, snapshotBlock: Number(snapshotBlock), snapshotER }
}

// ---- Routes ----

// Proposal details for the UI
app.get('/api/proposal/:id', async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const publisher = new Contract(PUBLISHER, PUBLISHER_ABI, provider)
    const [snapshotBlock, snapshotER] = await publisher.getSnapshot(id)
    const [votingStart, votingEnd] = await publisher.getWindow(id)
    res.json({
      proposalId: String(id),
      snapshotBlock: Number(snapshotBlock),
      snapshotER: snapshotER.toString(),
      votingStart: Number(votingStart),
      votingEnd: Number(votingEnd),
      chainB: { chainId: CHAIN_B_ID, verifier: VOTE_VERIFIER },
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Receive a signed EIP-712 vote, recompute power, verify, and store
app.post('/api/vote', async (req, res) => {
  try {
    console.log('Received vote:', req.body)
    const { proposalId, support, voter, nonce, deadline, signature, abstain } =
      req.body

    // Basic input checks
    if (!proposalId || !voter || !signature) {
      return res.status(400).json({ error: 'missing fields' })
    }

    // recompute power lazily (and check window)
    const publisher = new Contract(PUBLISHER, PUBLISHER_ABI, provider)
    const [votingStart, votingEnd] = await publisher.getWindow(proposalId)
    const now = Math.floor(Date.now() / 1000)
    // if (now < Number(votingStart) || now > Number(votingEnd)) {
    //   return res.status(400).json({ error: "outside voting window" });
    // }

    console.log('I am here 1')

    console.log('Computing power for', voter, 'at proposal', proposalId)

    const { power } = await computePowerAt(BigInt(proposalId), voter)
    console.log('Computed power:', power.toString())

    // if (userPower !== undefined && BigInt(userPower) !== power) {
    //   return res.status(400).json({ error: "client power mismatch" });
    // }
    console.log('I am here 2')

    // Verify the EIP-712 signature server-side
    // NOTE: with ethers v6, verifyTypedData is under Wallet, but for a pure recover use library below:
    const { verifyTypedData } = await import('ethers')
    console.log('I am here 3')

    console.log(
      BigInt(proposalId),
      !!support,
      getAddress(voter),
      power,
      BigInt(nonce),
      BigInt(deadline),
      signature
    )

    const wallet = verifyTypedData(
      eip712Domain(),
      EIP712_TYPES,
      {
        proposalId: BigInt(proposalId),
        support: !!support,
        voter: getAddress(voter),
        power,
        nonce: BigInt(nonce),
        deadline: BigInt(deadline),
      },
      signature
    )

    console.log('Recovered wallet:', wallet)

    const valid =
      verifyTypedData(
        eip712Domain(),
        EIP712_TYPES,
        {
          proposalId: BigInt(proposalId),
          support: !!support,
          voter: getAddress(voter),
          power,
          nonce: BigInt(nonce),
          deadline: BigInt(deadline),
        },
        signature
      ) === getAddress(voter)
    console.log('I am here 4')
    if (!valid) return res.status(400).json({ error: 'bad signature' })
    if (now > Number(deadline))
      return res.status(400).json({ error: 'expired signature' })
    console.log('I am here 5')

    // Store vote (dedup by higher nonce)
    const db = readVotes()
    const key = String(proposalId)
    if (!db[key]) db[key] = []
    const existingIdx = db[key].findIndex(
      (v) => getAddress(v.voter) === getAddress(voter)
    )
    const record = {
      proposalId: String(proposalId),
      voter: getAddress(voter),
      power: power.toString(),
      support: abstain ? 'abstain' : !!support ? 'yes' : 'no',
      nonce: String(nonce),
      deadline: String(deadline),
      signature,
    }
    if (existingIdx >= 0) {
      if (BigInt(db[key][existingIdx].nonce) <= BigInt(nonce)) {
        db[key][existingIdx] = record
      } // else ignore stale nonce
    } else {
      db[key].push(record)
    }
    writeVotes(db)

    res.json({ ok: true, stored: record })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Build Merkle root (only after votingEnd)
// app.post("/api/merkle/:id", async (req, res) => {
//   try {
//     const id = String(req.params.id);
//     const publisher = new Contract(PUBLISHER, PUBLISHER_ABI, provider);
//     const [ , votingEnd] = await publisher.getWindow(id);
//     const now = Math.floor(Date.now() / 1000);
//     if (now <= Number(votingEnd)) {
//       return res.status(400).json({ error: "Voting period not ended yet." });
//     }

//     const db = readVotes();
//     const list = (db[id] || []);
//     if (list.length === 0) {
//       return res.status(400).json({ error: "No votes recorded." });
//     }

//     // Dedup by highest nonce per voter
//     const map = new Map();
//     for (const v of list) {
//       const k = getAddress(v.voter);
//       if (!map.has(k) || BigInt(map.get(k).nonce) < BigInt(v.nonce)) map.set(k, v);
//     }
//     const unique = [...map.values()];

//     const leaves = unique.map(v => leafBuf(v.voter, v.power));
//     const tree = new MerkleTree(leaves, pairHash, { sort: false });
//     const root = "0x" + tree.getRoot().toString("hex");

//     const tallies = unique.reduce((acc, v) => {
//       const p = BigInt(v.power);
//       if (v.support === "yes") acc.for += p;
//       else if (v.support === "no") acc.against += p;
//       else acc.abstain += p;
//       return acc;
//     }, { for: 0n, against: 0n, abstain: 0n });

//     const out = {
//       proposalId: id,
//       root,
//       counts: {
//         for: tallies.for.toString(),
//         against: tallies.against.toString(),
//         abstain: tallies.abstain.toString(),
//         totalCounted: (tallies.for + tallies.against + tallies.abstain).toString()
//       },
//       voters: unique.map(v => ({ voter: v.voter, power: v.power, support: v.support, nonce: v.nonce })),
//     };

//     writeMerkle(out);
//     res.json(out);
//   } catch (e) {
//     res.status(500).json({ error: e.message });
//   }
// });

app.post('/api/merkle/:id', async (req, res) => {
  try {
    const id = String(req.params.id)
    console.log(' Guava 1')

    // reject if voting still open
    const publisher = new Contract(PUBLISHER, PUBLISHER_ABI, provider)
    const [, votingEnd] = await publisher.getWindow(id)
    const now = Math.floor(Date.now() / 1000)
    // if (now <= Number(votingEnd)) {
    //   return res.status(400).json({ error: "Voting period not ended yet." });
    // }

    // load votes and dedup by highest nonce
    const db = readVotes()
    const list = db[id] || []
    if (list.length === 0)
      return res.status(400).json({ error: 'No votes recorded.' })
    console.log(' Guava 2')

    const byVoter = new Map()
    for (const v of list) {
      const k = getAddress(v.voter)
      if (!byVoter.has(k) || BigInt(byVoter.get(k).nonce) < BigInt(v.nonce))
        byVoter.set(k, v)
    }
    console.log(' Guava 3')

    const unique = [...byVoter.values()]
    console.log(' Guava 4')

    // STABLE ORDER: sort by checksum address
    unique.sort((a, b) =>
      getAddress(a.voter).localeCompare(getAddress(b.voter))
    )
    console.log(' Guava 5')

    // build leaves in that order
    const leavesBuf = unique.map((v) => leafBuf(v.voter, v.power))

    console.log(' Guava 6')

    const tree = new MerkleTree(leavesBuf, keccakBuf, {
      hashLeaves: false,
      sort: false,
    })
    console.log(' Guava 7')

    const root = '0x' + tree.getRoot().toString('hex')
    console.log(' Guava 8')

    // tallies (optional)
    const tallies = unique.reduce(
      (acc, v) => {
        const p = BigInt(v.power)
        if (v.support === 'yes') acc.for += p
        else if (v.support === 'no') acc.against += p
        else acc.abstain += p
        return acc
      },
      { for: 0n, against: 0n, abstain: 0n }
    )

    const leavesHexOrdered = leavesBuf.map((b) => '0x' + b.toString('hex'))
    const artifact = {
      proposalId: id,
      root,
      counts: {
        for: tallies.for.toString(),
        against: tallies.against.toString(),
        abstain: tallies.abstain.toString(),
        totalCounted: (
          tallies.for +
          tallies.against +
          tallies.abstain
        ).toString(),
      },
      voters: unique.map((v) => ({
        voter: getAddress(v.voter),
        power: v.power,
        support: v.support,
        nonce: v.nonce,
      })),
      leavesHexOrdered,
    }
    console.log('Merkle artifact:', artifact)

    writeMerkle(artifact)
    res.json(artifact)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/multiproof/:id', async (req, res) => {
  try {
    console.log('Hello World 0')
    const id = String(req.params.id)
    if (!fs.existsSync(MERKLE_PATH))
      return res
        .status(400)
        .json({ error: 'No merkle artifact found. Freeze first.' })
    console.log('Hello World 1')

    const merkle = JSON.parse(fs.readFileSync(MERKLE_PATH, 'utf8'))
    if (merkle.proposalId !== id)
      return res.status(400).json({ error: 'Mismatched proposal' })
    console.log('Hello World 2')

    const allVoters = merkle.voters // already sorted; has {voter, power}
    // Rebuild the same tree you froze
    const leavesBuf = allVoters.map((v) => leafBuf(v.voter, v.power))
    const tree = new MerkleTree(leavesBuf, keccakBuf, {
      hashLeaves: false,
      sort: false,
    })

    // Select batch (all voters if none specified)
    const selected =
      req.body && Array.isArray(req.body.voters) && req.body.voters.length > 0
        ? req.body.voters.map(getAddress)
        : allVoters.map((v) => getAddress(v.voter))

    // Map selected -> leaf Buffers (same order as 'selected')
    const leafFor = (addr) =>
      leafBuf(addr, allVoters.find((v) => getAddress(v.voter) === addr).power)
    const batchLeavesBuf = selected.map(leafFor)

    // Build multi-proof
    const proof = tree.getMultiProof(batchLeavesBuf) // Array<Buffer>
    let proofFlags = tree.getProofFlags(batchLeavesBuf, proof) // Array<boolean>

    // Degenerate case: when proving *all* leaves in a tiny tree, some versions may return []
    // OpenZeppelin expects flags.length == leaves.length + proof.length - 1
    if (proofFlags.length === 0) {
      if (batchLeavesBuf.length <= 1) {
        proofFlags = [] // 1 leaf needs no flags
      } else {
        // combine leaves pairwise from the bottom: all 'true' works for a full batch
        proofFlags = Array(batchLeavesBuf.length - 1).fill(true)
      }
    }

    // Final sanity check (OZ invariant)
    if (proofFlags.length !== batchLeavesBuf.length + proof.length - 1) {
      return res
        .status(500)
        .json({ error: 'Invalid multiproof lengths for OZ verification' })
    }

    res.json({
      root: merkle.root,
      voters: selected,
      leaves: batchLeavesBuf.map((b) => '0x' + b.toString('hex')),
      proof: proof.map((b) => '0x' + b.toString('hex')),
      proofFlags,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () =>
  console.log(`mini-snapshot server running on http://localhost:${PORT}`)
)
