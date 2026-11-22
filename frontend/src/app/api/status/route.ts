import {NextResponse} from 'next/server';
import {resolveOracleConfig} from '../../../server/verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const cfg = resolveOracleConfig();
  return NextResponse.json({
    hasGeminiKey: cfg.hasGeminiKey,
    hasOracleKey: cfg.hasOracleKey,
    oracleAddress: cfg.oracleAddress,
    contractOracleSigner: cfg.contractOracleSigner,
    chainId: Number(cfg.chainId),
    network: cfg.network,
    deployBlock: cfg.deployBlock,
    registryAddress: cfg.registryAddress,
    tokenAddress: cfg.tokenAddress,
    isDeployed: cfg.isDeployed,
  });
}
