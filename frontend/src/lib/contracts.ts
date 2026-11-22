import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  isAddress,
  zeroAddress,
  type Abi,
  type Address,
  type Chain,
  type Hex,
} from 'viem';
import {avalancheFuji, hardhat} from 'viem/chains';
import tokenAbiJson from '../contracts/GreenCarbonToken.json';
import registryAbiJson from '../contracts/CarbonRegistry.json';
import contractAddresses from '../contracts/addresses.json';
import bytecodesJson from '../contracts/bytecodes.json';

export interface Eip1193Provider {
  request: (args: {method: string; params?: unknown[]}) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

export interface RuntimeContractConfig {
  chainId: number;
  network: string;
  token: Address | null;
  registry: Address | null;
  oracleSigner: Address | null;
  deployBlock: number;
}

const STORAGE_KEY = 'avaxgreen:runtime-contract-config:v1';

const rawAddresses = contractAddresses as {
  chainId?: number;
  network?: string;
  token?: string;
  registry?: string;
  oracleSigner?: string;
  deployBlock?: number;
};

function toValidAddress(value?: string | null): Address | null {
  const trimmed = (value || '').trim();
  return isAddress(trimmed) && trimmed !== zeroAddress ? (trimmed as Address) : null;
}

function defaultConfig(): RuntimeContractConfig {
  const envChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || rawAddresses.chainId || 43113);
  const chainId = Number.isFinite(envChainId) && envChainId > 0 ? envChainId : 43113;
  return {
    chainId,
    network: rawAddresses.network || (chainId === 31337 ? 'localhost' : 'fuji'),
    token: toValidAddress(rawAddresses.token),
    registry: toValidAddress(rawAddresses.registry),
    oracleSigner: toValidAddress(rawAddresses.oracleSigner),
    deployBlock: Math.max(0, Number(rawAddresses.deployBlock || 0)),
  };
}

let activeConfig: RuntimeContractConfig | null = null;

export function getRuntimeConfig(): RuntimeContractConfig {
  if (activeConfig) return activeConfig;
  const base = defaultConfig();
  if (typeof window !== 'undefined') {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<RuntimeContractConfig>;
        const token = toValidAddress(parsed.token);
        const registry = toValidAddress(parsed.registry);
        if (token && registry) {
          activeConfig = {
            chainId: Number(parsed.chainId) || base.chainId,
            network: parsed.network || base.network,
            token,
            registry,
            oracleSigner: toValidAddress(parsed.oracleSigner),
            deployBlock: Math.max(0, Number(parsed.deployBlock || 0)),
          };
          return activeConfig;
        }
      }
    } catch {
      // Ignore corrupt storage
    }
  }
  activeConfig = base;
  return activeConfig;
}

export function setRuntimeConfig(next: Partial<RuntimeContractConfig>): RuntimeContractConfig {
  const current = getRuntimeConfig();
  const updated: RuntimeContractConfig = {
    chainId: Number(next.chainId) || current.chainId,
    network: next.network || current.network,
    token: next.token !== undefined ? toValidAddress(next.token) : current.token,
    registry: next.registry !== undefined ? toValidAddress(next.registry) : current.registry,
    oracleSigner: next.oracleSigner !== undefined ? toValidAddress(next.oracleSigner) : current.oracleSigner,
    deployBlock: next.deployBlock !== undefined ? Math.max(0, Number(next.deployBlock || 0)) : current.deployBlock,
  };
  activeConfig = updated;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Ignore quota errors
    }
  }
  return updated;
}

export function getChainId(): number {
  return getRuntimeConfig().chainId;
}

export function isLocalChain(chainId = getChainId()): boolean {
  return chainId === 31337;
}

export function getRpcUrl(chainId = getChainId()): string {
  if (process.env.NEXT_PUBLIC_RPC_URL?.trim() && chainId === 43113) {
    return process.env.NEXT_PUBLIC_RPC_URL.trim();
  }
  return chainId === 31337 ? 'http://127.0.0.1:8545' : 'https://api.avax-test.network/ext/bc/C/rpc';
}

export function getActiveChain(chainId = getChainId()): Chain {
  const rpc = getRpcUrl(chainId);
  return chainId === 31337
    ? {
        ...hardhat,
        rpcUrls: {default: {http: [rpc]}},
      }
    : {
        ...avalancheFuji,
        rpcUrls: {default: {http: [rpc]}},
      };
}

export function getNetworkLabel(chainId = getChainId()): string {
  return chainId === 31337 ? 'Local Hardhat' : 'Avalanche Fuji';
}

export function getExplorerBase(chainId = getChainId()): string {
  return chainId === 31337 ? '' : 'https://testnet.snowtrace.io';
}

export function getTokenAddress(): Address | null {
  return getRuntimeConfig().token;
}

export function getRegistryAddress(): Address | null {
  return getRuntimeConfig().registry;
}

export function getOracleSignerAddress(): Address | null {
  return getRuntimeConfig().oracleSigner;
}

export function getDeployBlock(): bigint {
  return BigInt(Math.max(0, getRuntimeConfig().deployBlock));
}

export function isContractDeployed(): boolean {
  const cfg = getRuntimeConfig();
  return Boolean(cfg.token && cfg.registry);
}

export function getPublicClient(chainId = getChainId()) {
  return createPublicClient({
    chain: getActiveChain(chainId),
    transport: http(getRpcUrl(chainId)),
  });
}

export const TOKEN_ABI = tokenAbiJson as Abi;
export const REGISTRY_ABI = registryAbiJson as Abi;
export const CONTRACT_BYTECODES = bytecodesJson as {
  GreenCarbonToken: {abi: Abi; bytecode: Hex};
  CarbonRegistry: {abi: Abi; bytecode: Hex};
};

// Backward-compatible snapshots for static helpers
export const CHAIN_ID = defaultConfig().chainId;
export const EXPLORER_BASE = getExplorerBase(CHAIN_ID);

export function getWalletClient(ethereum: Eip1193Provider, account?: Address, chainId = getChainId()) {
  return createWalletClient({
    account,
    chain: getActiveChain(chainId),
    transport: custom(ethereum),
  });
}

export async function ensureFujiNetwork(ethereum: Eip1193Provider, targetChainId = getChainId()): Promise<number> {
  const targetHex = `0x${targetChainId.toString(16)}` as Hex;
  const currentHex = (await ethereum.request({method: 'eth_chainId'})) as string;
  if (parseInt(currentHex, 16) === targetChainId) {
    return targetChainId;
  }

  const rpc = getRpcUrl(targetChainId);
  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{chainId: targetHex}],
    });
    return targetChainId;
  } catch (err: unknown) {
    const errObj = err as {code?: number; data?: {originalError?: {code?: number}}};
    const code = errObj?.code ?? errObj?.data?.originalError?.code;
    if (code === 4902) {
      await ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          targetChainId === 31337
            ? {
                chainId: targetHex,
                chainName: 'Hardhat Localhost 8545',
                nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18},
                rpcUrls: [rpc],
              }
            : {
                chainId: targetHex,
                chainName: 'Avalanche Fuji C-Chain',
                nativeCurrency: {name: 'Avalanche', symbol: 'AVAX', decimals: 18},
                rpcUrls: ['https://api.avax-test.network/ext/bc/C/rpc'],
                blockExplorerUrls: ['https://testnet.snowtrace.io/'],
              },
        ],
      });
      return targetChainId;
    }
    throw err;
  }
}

export function txUrl(hash?: string | null): string | null {
  const base = getExplorerBase();
  if (!hash || !base) return null;
  return `${base}/tx/${hash}`;
}

export function addressUrl(addr?: string | null): string | null {
  const base = getExplorerBase();
  if (!addr || !base) return null;
  return `${base}/address/${addr}`;
}

export function nftUrl(tokenId: number | string): string | null {
  const base = getExplorerBase();
  const registry = getRegistryAddress();
  if (!registry || !base) return null;
  return `${base}/nft/${registry}/${tokenId}`;
}
