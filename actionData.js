import { Interface, AbiCoder, keccak256, getAddress } from "ethers";

// ---- config (hardcoded per your request) ----
const TARGET  = getAddress("0x689801367256cf9752d26E7C9F8cd39dbd9c2aCB");
const FN_SIG  = "updateUnbondingPeriod(uint256)";
const ARGS    = [150];          // period = 200
const VALUE   = 0n;             // no ETH sent

// ---- build function calldata ----
const iface = new Interface([`function ${FN_SIG}`]);
const fnName = FN_SIG.slice(0, FN_SIG.indexOf("("));
const data = iface.encodeFunctionData(fnName, ARGS);

// ---- pack actionData the way GovernanceExecutor expects ----
// bytes actionData = abi.encode(address target, uint256 value, bytes data)
const abi = AbiCoder.defaultAbiCoder();
const actionData = abi.encode(["address", "uint256", "bytes"], [TARGET, VALUE, data]);

// ---- hash for freezing / verification on Chain B ----
const actionDataHash = keccak256(actionData);

console.log("Target        :", TARGET);
console.log("Function sig  :", FN_SIG);
console.log("Args          :", ARGS);
console.log("Calldata (data):", data);
console.log("Packed actionData:", actionData);
console.log("actionDataHash  :", actionDataHash);