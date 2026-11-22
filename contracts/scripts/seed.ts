import {ethers, network} from 'hardhat';
import {readFileSync} from 'node:fs';
import path from 'node:path';

async function main() {
  const addressesPath = path.resolve(__dirname, '../../frontend/src/contracts/addresses.json');
  const addresses = JSON.parse(readFileSync(addressesPath, 'utf-8')) as {
    registry: string;
    token: string;
    oracleSigner: string;
  };
  if (!addresses.registry || !ethers.isAddress(addresses.registry)) {
    throw new Error('Registry address not found in frontend/src/contracts/addresses.json');
  }

  const oracleKey = process.env.ORACLE_PRIVATE_KEY?.trim();
  const [admin] = await ethers.getSigners();
  const oracleWallet = oracleKey ? new ethers.Wallet(oracleKey, ethers.provider) : admin;

  const registry = await ethers.getContractAt('CarbonRegistry', addresses.registry);
  const currentOracle = await registry.oracleSigner();
  const signerAddr = await oracleWallet.getAddress();
  if (currentOracle.toLowerCase() !== signerAddr.toLowerCase()) {
    throw new Error(`Oracle key address (${signerAddr}) does not match contract oracleSigner (${currentOracle})`);
  }

  const amountGcarb = process.env.SEED_GCARB?.trim() || process.env.INITIAL_TREASURY_GCARB?.trim() || '10000';
  const amountWei = ethers.parseEther(amountGcarb);
  const proofHash = ethers.id(`AvaxGreen:treasury-topup:${Date.now()}`);

  const digest = await registry.verificationDigest(addresses.registry, amountWei, proofHash);
  const sig = await oracleWallet.signMessage(ethers.getBytes(digest));
  const tx = await registry.fundTreasury(amountWei, proofHash, sig);
  const receipt = await tx.wait();

  console.log(`Funded treasury on ${network.name} with ${amountGcarb} GCARB`);
  console.log(`Tx hash: ${receipt?.hash}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
