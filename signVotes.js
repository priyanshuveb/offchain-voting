// signVotes.js
import { Wallet } from "ethers";

// EIP-712 domain must match your VoteVerifier on Chain B
export function domain(chainId, verifyingContract) {
  return {
    name: "CrossGov",
    version: "1",
    chainId,
    verifyingContract
  };
}

export const types = {
  Vote: [
    { name: "proposalId", type: "uint256" },
    { name: "support",    type: "bool"    },
    { name: "voter",      type: "address" },
    { name: "power",      type: "uint256" },
    { name: "nonce",      type: "uint256" },
    { name: "deadline",   type: "uint256" }
  ]
};

export async function signVote({
  wallet,              // ethers.Wallet (or JsonRpcSigner)
  chainId,
  verifyingContract,   // VoteVerifier (Chain B)
  proposalId,
  support,
  voter,
  power,
  nonce,
  deadline
}) {
  const value = { proposalId, support, voter, power, nonce, deadline };
  const sig = await wallet.signTypedData(domain(chainId, verifyingContract), types, value);
  return { ...value, signature: sig };
}

// Example:
// const w = new Wallet(PRIVATE_KEY);
// const v = await signVote({ wallet: w, chainId: 11155111, verifyingContract: "0xVerifier", proposalId: 1n, support: true, voter: w.address, power: 123n, nonce: 1n, deadline: BigInt(Math.floor(Date.now()/1000)+3600) });
// console.log(v);
