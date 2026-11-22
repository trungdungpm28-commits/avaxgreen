import {randomUUID} from 'node:crypto';
import {NextResponse} from 'next/server';
import {
  createPublicClient,
  encodeAbiParameters,
  http,
  isAddress,
  keccak256,
  parseEther,
  toBytes,
  type Address,
} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {avalancheFuji, hardhat} from 'viem/chains';
import registryAbi from '../../../contracts/CarbonRegistry.json';
import {getRpcUrl, resolveOracleConfig} from '../../../server/verify';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      amountGcarb?: number | string;
      registryAddress?: string;
      chainId?: number;
    };

    const cfg = resolveOracleConfig();
    if (!cfg.oracleKey || !cfg.oracleAddress) {
      return NextResponse.json(
        {error: 'Server chưa cấu hình ORACLE_PRIVATE_KEY để ký nạp kho Treasury.'},
        {status: 400}
      );
    }

    const registry =
      body.registryAddress && isAddress(body.registryAddress)
        ? (body.registryAddress as Address)
        : cfg.registryAddress;
    if (!registry) {
      return NextResponse.json({error: 'Chưa có địa chỉ CarbonRegistry hợp lệ.'}, {status: 400});
    }

    const chainId = Number(body.chainId || cfg.chainId);
    const amountNum = Number(body.amountGcarb);
    if (!Number.isFinite(amountNum) || amountNum <= 0 || amountNum > 1000000) {
      return NextResponse.json({error: 'Số lượng GCARB nạp kho phải từ 1 đến 1,000,000.'}, {status: 400});
    }

    const client = createPublicClient({
      chain: chainId === 31337 ? hardhat : avalancheFuji,
      transport: http(getRpcUrl(BigInt(chainId))),
    });
    const onChainSigner = (await client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: 'oracleSigner',
    })) as Address;
    if (onChainSigner.toLowerCase() !== cfg.oracleAddress.toLowerCase()) {
      return NextResponse.json(
        {
          error: `Oracle key của server (${cfg.oracleAddress}) không khớp oracleSigner trên contract (${onChainSigner}).`,
        },
        {status: 400}
      );
    }

    const amountStr = (Math.floor(amountNum * 1000) / 1000).toFixed(3);
    const amountWei = parseEther(amountStr);
    const proofHash = keccak256(toBytes(`AvaxGreen:treasury-topup:${Date.now()}:${randomUUID()}`));
    const digest = keccak256(
      encodeAbiParameters(
        [{type: 'uint256'}, {type: 'address'}, {type: 'address'}, {type: 'uint256'}, {type: 'bytes32'}],
        [BigInt(chainId), registry, registry, amountWei, proofHash]
      )
    );
    const signature = await privateKeyToAccount(cfg.oracleKey).signMessage({message: {raw: digest}});

    return NextResponse.json({
      amountWei: amountWei.toString(),
      proofHash,
      signature,
      oracleSigner: cfg.oracleAddress,
      registryAddress: registry,
    });
  } catch (error) {
    return NextResponse.json(
      {error: error instanceof Error ? error.message : 'Tạo chữ ký nạp kho thất bại.'},
      {status: 400}
    );
  }
}
