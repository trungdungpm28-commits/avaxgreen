import {artifacts} from 'hardhat';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';

async function main() {
  const target = path.resolve(__dirname, '../../frontend/src/contracts');
  mkdirSync(target, {recursive: true});

  const bytecodes: Record<string, {abi: unknown; bytecode: string}> = {};

  for (const name of ['GreenCarbonToken', 'CarbonRegistry']) {
    const artifact = await artifacts.readArtifact(name);
    writeFileSync(path.join(target, `${name}.json`), JSON.stringify(artifact.abi, null, 2));
    bytecodes[name] = {
      abi: artifact.abi,
      bytecode: artifact.bytecode,
    };
  }

  writeFileSync(path.join(target, 'bytecodes.json'), JSON.stringify(bytecodes));

  const addressesPath = path.join(target, 'addresses.json');
  if (!existsSync(addressesPath)) {
    writeFileSync(
      addressesPath,
      JSON.stringify(
        {
          chainId: 43113,
          network: 'fuji',
          token: '',
          registry: '',
          oracleSigner: '',
          deployBlock: 0,
        },
        null,
        2
      )
    );
  }

  console.log('Exported ABIs and bytecodes to:', target);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
