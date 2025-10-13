// buildSnapshot.js
import { Contract, Interface } from "ethers";

const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];

export async function buildSnapshot({
  provider,
  publisherAddress,
  publisherAbi,   // must include getSnapshot(uint256) -> (uint64,uint256)
  assetAddress,
  lstAddress,
  voters,
  proposalId
}) {
  const publisher = new Contract(publisherAddress, publisherAbi, provider);
  const [snapshotBlock, snapshotER] = await publisher.getSnapshot(proposalId);

  const asset = new Contract(assetAddress, ERC20_ABI, provider);
  const lst   = new Contract(lstAddress,   ERC20_ABI, provider);

  const ER_SCALAR = 10n ** 18n;
  const powers = {};

  for (const v of voters) {
    // ethers v6 allows blockTag override on calls:
    const assetBal = await asset.balanceOf(v, { blockTag: Number(snapshotBlock) });
    const lstBal   = await lst.balanceOf(v,   { blockTag: Number(snapshotBlock) });

    const lstAsAssets = (lstBal * snapshotER) / ER_SCALAR; // floor by integer division
    powers[v] = assetBal + lstAsAssets;
  }

  return { snapshotBlock, snapshotER, powers };
}

// Example usage:
// const { snapshotBlock, snapshotER, powers } = await buildSnapshot({...});
