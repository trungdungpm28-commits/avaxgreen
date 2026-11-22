import {formatUnits, parseAbiItem, type Address, type Hex} from 'viem';
import {
  REGISTRY_ABI,
  TOKEN_ABI,
  getChainId,
  getDeployBlock,
  getPublicClient,
  getRegistryAddress,
  getTokenAddress,
  isContractDeployed,
} from './contracts';

export interface DashboardStats {
  totalMintedKg: number;
  totalRetiredKg: number;
  totalCertificates: number;
  treasuryStockKg: number;
  escrowedListingKg: number;
  creditPriceWei: bigint;
  creditPriceAvax: number;
  defaultSoulbound: boolean;
  contractOwner: Address | null;
  contractOracleSigner: Address | null;
  registryAvax: number;
  userBalanceKg: number;
  userBalanceWei: bigint;
  userAvax: number;
  userAllowanceWei: bigint;
}

export type ActivityType =
  | 'Minted'
  | 'Purchased'
  | 'Retired'
  | 'ListingCreated'
  | 'ListingPurchased'
  | 'ListingCancelled'
  | 'ProjectRegistered';

export interface OnChainActivityItem {
  id: string;
  type: ActivityType;
  actor: Address;
  amountKg: number;
  detail: string;
  proofHash?: Hex;
  certificateId?: number;
  listingId?: number;
  txHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  timestamp: number;
}

export interface OnChainAttribute {
  trait_type: string;
  value: string | number;
}

export interface OnChainCertificate {
  id: number;
  owner: Address;
  company: string;
  reason: string;
  amountKg: number;
  amountWei: string;
  retiredAt: number;
  soulbound: boolean;
  lockedExplicitly: boolean;
  imageDataUri: string;
  svgMarkup: string;
  attributes: OnChainAttribute[];
  rawJson: string;
  rawTokenUri: string;
  txHash?: Hex;
}

export interface P2PListing {
  id: number;
  seller: Address;
  remainingWei: bigint;
  remainingKg: number;
  pricePerKgWei: bigint;
  pricePerKgAvax: number;
  projectInfo: string;
  active: boolean;
}

export interface RegisteredProject {
  id: number;
  owner: Address;
  projectId: string;
  name: string;
  location: string;
  capacityKw: number;
  totalMintedKg: number;
  registeredAt: number;
  active: boolean;
}

const CREDITS_MINTED_EVENT = parseAbiItem(
  'event CreditsMinted(address indexed producer, uint256 amount, bytes32 indexed proofHash)'
);
const CREDITS_PURCHASED_EVENT = parseAbiItem(
  'event CreditsPurchased(address indexed buyer, uint256 amount, uint256 paid)'
);
const CREDITS_RETIRED_EVENT = parseAbiItem(
  'event CreditsRetired(address indexed company, uint256 amount, uint256 indexed certificateId)'
);
const LISTING_CREATED_EVENT = parseAbiItem(
  'event ListingCreated(uint256 indexed listingId, address indexed seller, uint256 amount, uint256 pricePerKgWei, string projectInfo)'
);
const LISTING_PURCHASED_EVENT = parseAbiItem(
  'event ListingPurchased(uint256 indexed listingId, address indexed buyer, address indexed seller, uint256 amount, uint256 paid)'
);
const LISTING_CANCELLED_EVENT = parseAbiItem(
  'event ListingCancelled(uint256 indexed listingId, address indexed seller, uint256 returnedAmount)'
);
const PROJECT_REGISTERED_EVENT = parseAbiItem(
  'event ProjectRegistered(uint256 indexed id, address indexed owner, string projectId, string name, uint256 capacityWatt)'
);

export function decodeBase64Utf8(b64: string): string {
  const clean = b64.trim();
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

export function weiToNumber(wei: bigint): number {
  return Number(formatUnits(wei, 18));
}

export async function fetchDashboardStats(wallet?: Address | null): Promise<DashboardStats> {
  const registryAddress = getRegistryAddress();
  const tokenAddress = getTokenAddress();
  if (!isContractDeployed() || !registryAddress || !tokenAddress) {
    return {
      totalMintedKg: 0,
      totalRetiredKg: 0,
      totalCertificates: 0,
      treasuryStockKg: 0,
      escrowedListingKg: 0,
      creditPriceWei: 100000000000000n,
      creditPriceAvax: 0.0001,
      defaultSoulbound: false,
      contractOwner: null,
      contractOracleSigner: null,
      registryAvax: 0,
      userBalanceKg: 0,
      userBalanceWei: 0n,
      userAvax: 0,
      userAllowanceWei: 0n,
    };
  }

  const client = getPublicClient();
  const [
    mintedWei,
    retiredWei,
    totalCerts,
    treasuryWei,
    escrowedWei,
    creditPriceWei,
    defaultSoulbound,
    ownerAddr,
    oracleAddr,
    registryAvaxWei,
  ] = await Promise.all([
    client.readContract({address: registryAddress, abi: REGISTRY_ABI, functionName: 'totalMintedCO2'}) as Promise<bigint>,
    client.readContract({address: registryAddress, abi: REGISTRY_ABI, functionName: 'totalRetiredCO2'}) as Promise<bigint>,
    client.readContract({address: registryAddress, abi: REGISTRY_ABI, functionName: 'totalCertificates'}) as Promise<bigint>,
    client
      .readContract({address: registryAddress, abi: REGISTRY_ABI, functionName: 'treasuryInventory'})
      .catch(() =>
        client.readContract({
          address: tokenAddress,
          abi: TOKEN_ABI,
          functionName: 'balanceOf',
          args: [registryAddress],
        })
      ) as Promise<bigint>,
    client
      .readContract({address: registryAddress, abi: REGISTRY_ABI, functionName: 'escrowedListingTokens'})
      .catch(() => 0n) as Promise<bigint>,
    client
      .readContract({address: registryAddress, abi: REGISTRY_ABI, functionName: 'creditPriceWei'})
      .catch(() => 100000000000000n) as Promise<bigint>,
    client
      .readContract({address: registryAddress, abi: REGISTRY_ABI, functionName: 'defaultSoulbound'})
      .catch(() => false) as Promise<boolean>,
    client
      .readContract({address: registryAddress, abi: REGISTRY_ABI, functionName: 'owner'})
      .catch(() => null) as Promise<Address | null>,
    client
      .readContract({address: registryAddress, abi: REGISTRY_ABI, functionName: 'oracleSigner'})
      .catch(() => null) as Promise<Address | null>,
    client.getBalance({address: registryAddress}).catch(() => 0n),
  ]);

  let userBalanceWei = 0n;
  let userAvaxWei = 0n;
  let userAllowanceWei = 0n;

  if (wallet) {
    const [bal, avax, allowance] = (await Promise.all([
      client.readContract({
        address: tokenAddress,
        abi: TOKEN_ABI,
        functionName: 'balanceOf',
        args: [wallet],
      }),
      client.getBalance({address: wallet}),
      client.readContract({
        address: tokenAddress,
        abi: TOKEN_ABI,
        functionName: 'allowance',
        args: [wallet, registryAddress],
      }),
    ])) as [bigint, bigint, bigint];
    userBalanceWei = bal;
    userAvaxWei = avax;
    userAllowanceWei = allowance;
  }

  return {
    totalMintedKg: weiToNumber(mintedWei),
    totalRetiredKg: weiToNumber(retiredWei),
    totalCertificates: Number(totalCerts),
    treasuryStockKg: weiToNumber(treasuryWei),
    escrowedListingKg: weiToNumber(escrowedWei),
    creditPriceWei,
    creditPriceAvax: weiToNumber(creditPriceWei),
    defaultSoulbound,
    contractOwner: ownerAddr,
    contractOracleSigner: oracleAddr,
    registryAvax: weiToNumber(registryAvaxWei),
    userBalanceKg: weiToNumber(userBalanceWei),
    userBalanceWei,
    userAvax: weiToNumber(userAvaxWei),
    userAllowanceWei,
  };
}

interface CachedLogsPayload {
  lastScannedBlock: string;
  items: Array<Omit<OnChainActivityItem, 'blockNumber'> & {blockNumber: string}>;
}

function logCacheKey(chainId: number, registryAddress: Address): string {
  return `avaxgreen:activity-cache:v2:${chainId}:${registryAddress.toLowerCase()}`;
}

export async function fetchOnChainActivity(): Promise<OnChainActivityItem[]> {
  const registryAddress = getRegistryAddress();
  if (!isContractDeployed() || !registryAddress) return [];

  const chainId = getChainId();
  const client = getPublicClient(chainId);
  const deployBlock = getDeployBlock();
  const latestBlock = await client.getBlockNumber();
  const minFloor = deployBlock > 0n ? deployBlock : latestBlock > 50000n ? latestBlock - 50000n : 0n;

  let cachedItems: OnChainActivityItem[] = [];
  let scanStart = minFloor;

  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(logCacheKey(chainId, registryAddress));
      if (raw) {
        const parsed = JSON.parse(raw) as CachedLogsPayload;
        const lastBlock = BigInt(parsed.lastScannedBlock || '0');
        if (lastBlock >= minFloor && lastBlock <= latestBlock) {
          cachedItems = (parsed.items || []).map((item) => ({
            ...item,
            blockNumber: BigInt(item.blockNumber),
          }));
          scanStart = lastBlock + 1n;
        }
      }
    } catch {
      // Ignore corrupt cache
    }
  }

  if (scanStart > latestBlock) {
    return cachedItems;
  }

  const CHUNK_SIZE = 2000n;
  const ranges: Array<{fromBlock: bigint; toBlock: bigint}> = [];
  let cursor = scanStart;
  while (cursor <= latestBlock) {
    const to = cursor + CHUNK_SIZE - 1n > latestBlock ? latestBlock : cursor + CHUNK_SIZE - 1n;
    ranges.push({fromBlock: cursor, toBlock: to});
    cursor = to + 1n;
  }

  const BATCH_CONCURRENCY = 5;
  const newItems: OnChainActivityItem[] = [];
  const uniqueBlocks = new Set<bigint>();
  const rawEvents: Array<{kind: string; log: unknown}> = [];

  for (let i = 0; i < ranges.length; i += BATCH_CONCURRENCY) {
    const slice = ranges.slice(i, i + BATCH_CONCURRENCY);
    const batchResults = await Promise.all(
      slice.map(async ({fromBlock, toBlock}) => {
        const [minted, purchased, retired, listCreated, listPurchased, listCancelled, projRegistered] =
          await Promise.all([
            client.getLogs({address: registryAddress, event: CREDITS_MINTED_EVENT, fromBlock, toBlock}),
            client.getLogs({address: registryAddress, event: CREDITS_PURCHASED_EVENT, fromBlock, toBlock}),
            client.getLogs({address: registryAddress, event: CREDITS_RETIRED_EVENT, fromBlock, toBlock}),
            client
              .getLogs({address: registryAddress, event: LISTING_CREATED_EVENT, fromBlock, toBlock})
              .catch(() => []),
            client
              .getLogs({address: registryAddress, event: LISTING_PURCHASED_EVENT, fromBlock, toBlock})
              .catch(() => []),
            client
              .getLogs({address: registryAddress, event: LISTING_CANCELLED_EVENT, fromBlock, toBlock})
              .catch(() => []),
            client
              .getLogs({address: registryAddress, event: PROJECT_REGISTERED_EVENT, fromBlock, toBlock})
              .catch(() => []),
          ]);
        return {minted, purchased, retired, listCreated, listPurchased, listCancelled, projRegistered};
      })
    );

    for (const chunk of batchResults) {
      for (const l of chunk.minted) {
        if (l.blockNumber !== null) uniqueBlocks.add(l.blockNumber);
        rawEvents.push({kind: 'Minted', log: l});
      }
      for (const l of chunk.purchased) {
        if (l.blockNumber !== null) uniqueBlocks.add(l.blockNumber);
        rawEvents.push({kind: 'Purchased', log: l});
      }
      for (const l of chunk.retired) {
        if (l.blockNumber !== null) uniqueBlocks.add(l.blockNumber);
        rawEvents.push({kind: 'Retired', log: l});
      }
      for (const l of chunk.listCreated) {
        if (l.blockNumber !== null) uniqueBlocks.add(l.blockNumber);
        rawEvents.push({kind: 'ListingCreated', log: l});
      }
      for (const l of chunk.listPurchased) {
        if (l.blockNumber !== null) uniqueBlocks.add(l.blockNumber);
        rawEvents.push({kind: 'ListingPurchased', log: l});
      }
      for (const l of chunk.listCancelled) {
        if (l.blockNumber !== null) uniqueBlocks.add(l.blockNumber);
        rawEvents.push({kind: 'ListingCancelled', log: l});
      }
      for (const l of chunk.projRegistered) {
        if (l.blockNumber !== null) uniqueBlocks.add(l.blockNumber);
        rawEvents.push({kind: 'ProjectRegistered', log: l});
      }
    }
  }

  const blockTimestamps = new Map<bigint, number>();
  const blockArr = Array.from(uniqueBlocks);
  for (let i = 0; i < blockArr.length; i += 10) {
    await Promise.all(
      blockArr.slice(i, i + 10).map(async (bn) => {
        try {
          const blk = await client.getBlock({blockNumber: bn});
          blockTimestamps.set(bn, Number(blk.timestamp));
        } catch {
          blockTimestamps.set(bn, Math.floor(Date.now() / 1000));
        }
      })
    );
  }

  for (const entry of rawEvents) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const log = entry.log as any;
    const bn: bigint = log.blockNumber ?? 0n;
    const ts = blockTimestamps.get(bn) ?? 0;
    const baseId = `${log.transactionHash}-${log.logIndex}`;

    if (entry.kind === 'Minted') {
      const producer = log.args.producer as Address;
      const amount = log.args.amount as bigint;
      const proofHash = log.args.proofHash as Hex;
      const isTreasury = producer.toLowerCase() === registryAddress.toLowerCase();
      newItems.push({
        id: baseId,
        type: 'Minted',
        actor: producer,
        amountKg: weiToNumber(amount),
        detail: isTreasury ? 'Nạp kho Treasury (Seed)' : `Proof ${proofHash.slice(0, 10)}…`,
        proofHash,
        txHash: log.transactionHash,
        blockNumber: bn,
        logIndex: log.logIndex ?? 0,
        timestamp: ts,
      });
    } else if (entry.kind === 'Purchased') {
      const buyer = log.args.buyer as Address;
      const amount = log.args.amount as bigint;
      const paid = log.args.paid as bigint;
      newItems.push({
        id: baseId,
        type: 'Purchased',
        actor: buyer,
        amountKg: weiToNumber(amount),
        detail: `Mua từ Treasury (${weiToNumber(paid).toFixed(4)} AVAX)`,
        txHash: log.transactionHash,
        blockNumber: bn,
        logIndex: log.logIndex ?? 0,
        timestamp: ts,
      });
    } else if (entry.kind === 'Retired') {
      const company = log.args.company as Address;
      const amount = log.args.amount as bigint;
      const certId = Number(log.args.certificateId);
      newItems.push({
        id: baseId,
        type: 'Retired',
        actor: company,
        amountKg: weiToNumber(amount),
        detail: `ESG Certificate #${certId}`,
        certificateId: certId,
        txHash: log.transactionHash,
        blockNumber: bn,
        logIndex: log.logIndex ?? 0,
        timestamp: ts,
      });
    } else if (entry.kind === 'ListingCreated') {
      const listingId = Number(log.args.listingId);
      const seller = log.args.seller as Address;
      const amount = log.args.amount as bigint;
      const pricePerKgWei = log.args.pricePerKgWei as bigint;
      newItems.push({
        id: baseId,
        type: 'ListingCreated',
        actor: seller,
        amountKg: weiToNumber(amount),
        detail: `Niêm yết P2P #${listingId} (${weiToNumber(pricePerKgWei).toFixed(4)} AVAX/kg)`,
        listingId,
        txHash: log.transactionHash,
        blockNumber: bn,
        logIndex: log.logIndex ?? 0,
        timestamp: ts,
      });
    } else if (entry.kind === 'ListingPurchased') {
      const listingId = Number(log.args.listingId);
      const buyer = log.args.buyer as Address;
      const amount = log.args.amount as bigint;
      const paid = log.args.paid as bigint;
      newItems.push({
        id: baseId,
        type: 'ListingPurchased',
        actor: buyer,
        amountKg: weiToNumber(amount),
        detail: `Mua P2P #${listingId} (${weiToNumber(paid).toFixed(4)} AVAX)`,
        listingId,
        txHash: log.transactionHash,
        blockNumber: bn,
        logIndex: log.logIndex ?? 0,
        timestamp: ts,
      });
    } else if (entry.kind === 'ListingCancelled') {
      const listingId = Number(log.args.listingId);
      const seller = log.args.seller as Address;
      const returnedAmount = log.args.returnedAmount as bigint;
      newItems.push({
        id: baseId,
        type: 'ListingCancelled',
        actor: seller,
        amountKg: weiToNumber(returnedAmount),
        detail: `Hủy niêm yết P2P #${listingId}`,
        listingId,
        txHash: log.transactionHash,
        blockNumber: bn,
        logIndex: log.logIndex ?? 0,
        timestamp: ts,
      });
    } else if (entry.kind === 'ProjectRegistered') {
      const owner = log.args.owner as Address;
      const projectId = String(log.args.projectId || '');
      const capacityWatt = log.args.capacityWatt as bigint;
      newItems.push({
        id: baseId,
        type: 'ProjectRegistered',
        actor: owner,
        amountKg: Number(capacityWatt) / 1000,
        detail: `Đăng ký dự án ${projectId} (${(Number(capacityWatt) / 1000).toFixed(1)} kWp)`,
        txHash: log.transactionHash,
        blockNumber: bn,
        logIndex: log.logIndex ?? 0,
        timestamp: ts,
      });
    }
  }

  const byId = new Map<string, OnChainActivityItem>();
  for (const item of [...cachedItems, ...newItems]) {
    byId.set(item.id, item);
  }
  const merged = Array.from(byId.values()).sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber > b.blockNumber ? -1 : 1;
    return b.logIndex - a.logIndex;
  });

  if (typeof window !== 'undefined' && latestBlock > 0n) {
    try {
      const serialized: CachedLogsPayload = {
        lastScannedBlock: latestBlock.toString(),
        items: merged.map((item) => ({...item, blockNumber: item.blockNumber.toString()})),
      };
      window.localStorage.setItem(logCacheKey(chainId, registryAddress), JSON.stringify(serialized));
    } catch {
      // Ignore quota errors
    }
  }

  return merged;
}

async function decodeCertificate(
  id: number,
  registryAddress: Address,
  defaultSoulbound: boolean,
  txHash?: Hex
): Promise<OnChainCertificate> {
  const client = getPublicClient();
  const [rawTokenUri, owner, lockedExplicitly] = (await Promise.all([
    client.readContract({
      address: registryAddress,
      abi: REGISTRY_ABI,
      functionName: 'tokenURI',
      args: [BigInt(id)],
    }),
    client.readContract({
      address: registryAddress,
      abi: REGISTRY_ABI,
      functionName: 'ownerOf',
      args: [BigInt(id)],
    }),
    client
      .readContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'certificateSoulbound',
        args: [BigInt(id)],
      })
      .catch(() => false),
  ])) as [string, Address, boolean];

  const jsonBase64 = rawTokenUri.split(',')[1] || '';
  const rawJson = decodeBase64Utf8(jsonBase64);
  const parsed = JSON.parse(rawJson) as {
    name?: string;
    description?: string;
    company?: string;
    amountWei?: string;
    retiredAt?: number;
    soulbound?: boolean;
    attributes?: OnChainAttribute[];
    image?: string;
  };

  const imageDataUri = parsed.image || '';
  const svgBase64 = imageDataUri.split(',')[1] || '';
  const svgMarkup = svgBase64 ? decodeBase64Utf8(svgBase64) : '';
  const amountWei = parsed.amountWei || '0';
  const soulbound = Boolean(defaultSoulbound || lockedExplicitly || parsed.soulbound);

  return {
    id,
    owner,
    company: parsed.company || `Certificate #${id}`,
    reason: parsed.description || '',
    amountKg: weiToNumber(BigInt(amountWei)),
    amountWei,
    retiredAt: Number(parsed.retiredAt || 0),
    soulbound,
    lockedExplicitly: Boolean(lockedExplicitly),
    imageDataUri,
    svgMarkup,
    attributes: Array.isArray(parsed.attributes) ? parsed.attributes : [],
    rawJson,
    rawTokenUri,
    txHash,
  };
}

export async function fetchUserCertificates(
  wallet: Address,
  activity: OnChainActivityItem[] = []
): Promise<OnChainCertificate[]> {
  const registryAddress = getRegistryAddress();
  if (!isContractDeployed() || !registryAddress) return [];

  const client = getPublicClient();
  const [tokenIds, defaultSoulbound] = (await Promise.all([
    client.readContract({
      address: registryAddress,
      abi: REGISTRY_ABI,
      functionName: 'certificatesOf',
      args: [wallet],
    }),
    client
      .readContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'defaultSoulbound',
      })
      .catch(() => false),
  ])) as [bigint[], boolean];

  if (!tokenIds || tokenIds.length === 0) return [];

  const txByCertId = new Map<number, Hex>();
  for (const act of activity) {
    if (act.type === 'Retired' && act.certificateId !== undefined) {
      txByCertId.set(act.certificateId, act.txHash);
    }
  }

  const certs = await Promise.all(
    tokenIds.map((rawId) =>
      decodeCertificate(Number(rawId), registryAddress, defaultSoulbound, txByCertId.get(Number(rawId)))
    )
  );

  certs.sort((a, b) => b.id - a.id);
  return certs;
}

export async function fetchCertificateById(
  tokenId: number,
  activity: OnChainActivityItem[] = []
): Promise<OnChainCertificate | null> {
  const registryAddress = getRegistryAddress();
  if (!isContractDeployed() || !registryAddress || !Number.isInteger(tokenId) || tokenId <= 0) {
    return null;
  }

  try {
    const client = getPublicClient();
    const defaultSoulbound = (await client
      .readContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'defaultSoulbound',
      })
      .catch(() => false)) as boolean;
    const txHash = activity.find((a) => a.type === 'Retired' && a.certificateId === tokenId)?.txHash;
    return await decodeCertificate(tokenId, registryAddress, defaultSoulbound, txHash);
  } catch {
    return null;
  }
}

export async function fetchActiveListings(): Promise<P2PListing[]> {
  const registryAddress = getRegistryAddress();
  if (!isContractDeployed() || !registryAddress) return [];

  try {
    const client = getPublicClient();
    const raw = (await client.readContract({
      address: registryAddress,
      abi: REGISTRY_ABI,
      functionName: 'activeListings',
    })) as Array<{
      id: bigint;
      seller: Address;
      remainingAmount: bigint;
      pricePerKgWei: bigint;
      projectInfo: string;
      active: boolean;
    }>;

    return raw
      .filter((l) => l.active && l.remainingAmount > 0n)
      .map((l) => ({
        id: Number(l.id),
        seller: l.seller,
        remainingWei: l.remainingAmount,
        remainingKg: weiToNumber(l.remainingAmount),
        pricePerKgWei: l.pricePerKgWei,
        pricePerKgAvax: weiToNumber(l.pricePerKgWei),
        projectInfo: l.projectInfo,
        active: l.active,
      }))
      .sort((a, b) => b.id - a.id);
  } catch {
    return [];
  }
}

export async function fetchRegisteredProjects(): Promise<RegisteredProject[]> {
  const registryAddress = getRegistryAddress();
  if (!isContractDeployed() || !registryAddress) return [];

  try {
    const client = getPublicClient();
    const raw = (await client.readContract({
      address: registryAddress,
      abi: REGISTRY_ABI,
      functionName: 'getProjects',
    })) as Array<{
      owner: Address;
      projectId: string;
      name: string;
      location: string;
      capacityWatt: bigint;
      totalMinted: bigint;
      registeredAt: bigint;
      active: boolean;
    }>;

    return raw.map((p, index) => ({
      id: index + 1,
      owner: p.owner,
      projectId: p.projectId,
      name: p.name,
      location: p.location,
      capacityKw: Number(p.capacityWatt) / 1000,
      totalMintedKg: weiToNumber(p.totalMinted),
      registeredAt: Number(p.registeredAt),
      active: p.active,
    }));
  } catch {
    return [];
  }
}
