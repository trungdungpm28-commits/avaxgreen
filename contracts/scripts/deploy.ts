import {ethers, artifacts, network} from 'hardhat';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';

async function main() {
  const [admin] = await ethers.getSigners();
  const oracleKey = process.env.ORACLE_PRIVATE_KEY?.trim();
  let signer = process.env.ORACLE_SIGNER_ADDRESS?.trim();

  if (!signer && oracleKey) {
    signer = new ethers.Wallet(oracleKey).address;
  }
  if (!signer && (network.name === 'hardhat' || network.name === 'localhost')) {
    signer = admin.address;
  }
  if (!signer || !ethers.isAddress(signer)) {
    throw new Error('Set ORACLE_SIGNER_ADDRESS or ORACLE_PRIVATE_KEY in contracts/.env');
  }

  console.log(`Deploying AvaxGreen to ${network.name} with admin=${admin.address}, oracleSigner=${signer}`);

  const token = await ethers.deployContract('GreenCarbonToken', [admin.address]);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();

  const registry = await ethers.deployContract('CarbonRegistry', [tokenAddress, signer, admin.address]);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();

  await (await token.setRegistry(registryAddress)).wait();
  const deployBlock = await ethers.provider.getBlockNumber();

  // Seed initial verified treasury inventory when oracle key is available or running locally
  const initialTreasury = process.env.INITIAL_TREASURY_GCARB?.trim() || '10000';
  const treasuryAmount = ethers.parseEther(initialTreasury);

  if (treasuryAmount > 0n) {
    let oracleWallet: ethers.Signer | null = null;
    if (oracleKey) {
      oracleWallet = new ethers.Wallet(oracleKey, ethers.provider);
    } else if (network.name === 'hardhat' || network.name === 'localhost') {
      oracleWallet = admin;
    }

    if (oracleWallet && (await oracleWallet.getAddress()).toLowerCase() === signer.toLowerCase()) {
      const proofHash = ethers.id('AvaxGreen:genesis-treasury:v1');
      const digest = await registry.verificationDigest(registryAddress, treasuryAmount, proofHash);
      const sig = await oracleWallet.signMessage(ethers.getBytes(digest));
      await (await registry.fundTreasury(treasuryAmount, proofHash, sig)).wait();
      console.log(`Seeded treasury with ${initialTreasury} GCARB (proofHash=${proofHash})`);
    } else {
      console.log('Skipping treasury seed: ORACLE_PRIVATE_KEY missing or does not match ORACLE_SIGNER_ADDRESS.');
      console.log('Run `npm run seed:fuji -w contracts` after setting ORACLE_PRIVATE_KEY to fund Marketplace.');
    }
  }

  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  const target = path.resolve(__dirname, '../../frontend/src/contracts');
  mkdirSync(target, {recursive: true});

  const bytecodes: Record<string, {abi: unknown; bytecode: string}> = {};
  for (const name of ['GreenCarbonToken', 'CarbonRegistry']) {
    const artifact = await artifacts.readArtifact(name);
    writeFileSync(path.join(target, `${name}.json`), JSON.stringify(artifact.abi, null, 2));
    bytecodes[name] = {abi: artifact.abi, bytecode: artifact.bytecode};
  }
  writeFileSync(path.join(target, 'bytecodes.json'), JSON.stringify(bytecodes));

  writeFileSync(
    path.join(target, 'addresses.json'),
    JSON.stringify(
      {
        chainId,
        network: network.name,
        token: tokenAddress,
        registry: registryAddress,
        oracleSigner: signer,
        deployBlock,
      },
      null,
      2
    )
  );

  console.log('Token:', tokenAddress);
  console.log('Registry:', registryAddress);
  console.log('Deploy Block:', deployBlock);
  if (chainId === 43113) {
    console.log(`Snowtrace Token: https://testnet.snowtrace.io/address/${tokenAddress}`);
    console.log(`Snowtrace Registry: https://testnet.snowtrace.io/address/${registryAddress}`);
    console.log(`Verify Token: npx hardhat verify --network fuji ${tokenAddress} ${admin.address}`);
    console.log(
      `Verify Registry: npx hardhat verify --network fuji ${registryAddress} ${tokenAddress} ${signer} ${admin.address}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
