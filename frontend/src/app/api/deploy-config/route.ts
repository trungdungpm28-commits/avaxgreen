import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {NextResponse} from 'next/server';
import {createPublicClient, http, isAddress, zeroAddress, type Address} from 'viem';
import {avalancheFuji, hardhat} from 'viem/chains';
import registryAbi from '../../../contracts/CarbonRegistry.json';
import {getRpcUrl} from '../../../server/verify';

export const runtime = 'nodejs';

function resolveAddressesFilePath(): string {
  const cwd = process.cwd();
  const dir = existsSync(path.join(cwd, 'src', 'contracts'))
    ? path.join(cwd, 'src', 'contracts')
    : path.join(cwd, 'frontend', 'src', 'contracts');
  mkdirSync(dir, {recursive: true});
  return path.join(dir, 'addresses.json');
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      chainId?: number;
      network?: string;
      token?: string;
      registry?: string;
      oracleSigner?: string;
      deployBlock?: number;
    };

    const chainId = Number(body.chainId);
    const deployBlock = Math.max(0, Math.floor(Number(body.deployBlock || 0)));
    const token = String(body.token || '').trim();
    const registry = String(body.registry || '').trim();
    const oracleSigner = String(body.oracleSigner || '').trim();

    if (!Number.isInteger(chainId) || (chainId !== 43113 && chainId !== 31337)) {
      return NextResponse.json({error: 'ChainId không hợp lệ (chỉ hỗ trợ 43113 hoặc 31337).'}, {status: 400});
    }
    if (!isAddress(token) || token === zeroAddress || !isAddress(registry) || registry === zeroAddress) {
      return NextResponse.json({error: 'Địa chỉ Token hoặc Registry không hợp lệ.'}, {status: 400});
    }
    if (!isAddress(oracleSigner) || oracleSigner === zeroAddress) {
      return NextResponse.json({error: 'Địa chỉ Oracle Signer không hợp lệ.'}, {status: 400});
    }

    // Verify on-chain that the registry contract actually points to the provided token
    const client = createPublicClient({
      chain: chainId === 31337 ? hardhat : avalancheFuji,
      transport: http(getRpcUrl(BigInt(chainId))),
    });
    const onChainToken = (await client.readContract({
      address: registry as Address,
      abi: registryAbi,
      functionName: 'token',
    })) as Address;
    if (onChainToken.toLowerCase() !== token.toLowerCase()) {
      return NextResponse.json({error: 'Contract CarbonRegistry không khớp với địa chỉ GreenCarbonToken.'}, {status: 400});
    }

    const payload = {
      chainId,
      network: body.network || (chainId === 31337 ? 'localhost' : 'fuji'),
      token,
      registry,
      oracleSigner,
      deployBlock,
    };

    writeFileSync(resolveAddressesFilePath(), JSON.stringify(payload, null, 2));
    return NextResponse.json({ok: true, config: payload});
  } catch (error) {
    return NextResponse.json(
      {error: error instanceof Error ? error.message : 'Lưu cấu hình contract thất bại.'},
      {status: 400}
    );
  }
}
