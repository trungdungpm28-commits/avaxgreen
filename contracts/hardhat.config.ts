import '@nomicfoundation/hardhat-toolbox';
import 'dotenv/config';
import {subtask} from 'hardhat/config';
import {TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, TASK_COMPILE_SOLIDITY_RUN_SOLCJS} from 'hardhat/builtin-tasks/task-names';

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({solcVersion}, _, runSuper) =>
  solcVersion === '0.8.24'
    ? {
        compilerPath: require.resolve('solc/soljson.js'),
        isSolcJs: true,
        version: '0.8.24',
        longVersion: '0.8.24+commit.e11b9ed9',
      }
    : runSuper()
);
subtask(TASK_COMPILE_SOLIDITY_RUN_SOLCJS).setAction(async ({input}) =>
  JSON.parse(require('solc').compile(JSON.stringify(input)))
);

export default {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {enabled: true, runs: 200},
      evmVersion: 'paris',
    },
  },
  networks: {
    fuji: {
      url: process.env.FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc',
      chainId: 43113,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: {
      fuji: process.env.ETHERSCAN_API_KEY || 'routescan',
    },
    customChains: [
      {
        network: 'fuji',
        chainId: 43113,
        urls: {
          apiURL: 'https://api.routescan.io/v2/network/testnet/evm/43113/etherscan',
          browserURL: 'https://testnet.snowtrace.io',
        },
      },
    ],
  },
};
