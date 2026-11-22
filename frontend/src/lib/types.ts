import type {Address, Hex} from 'viem';
import type {Eip1193Provider} from './contracts';

export type Tab = 'overview' | 'verify' | 'market' | 'certificates' | 'admin';

export type SourceMode = 'rooftop-pv' | 'electricity-bill' | 'iot-telemetry';

export interface VerifyApiResponse {
  mode: 'oracle-signed' | 'estimate-only';
  sourceMode: SourceMode;
  aiMode: 'gemini' | 'sample-deterministic' | 'iot-telemetry' | 'deterministic-demo';
  solarMode: 'nasa-climatology' | 'sample';
  detected: boolean;
  evidenceType: 'rooftop-pv' | 'electricity-bill' | 'iot-telemetry' | 'unknown';
  confidence: number | null;
  fraudScore: number | null;
  trustScore: number | null;
  fraudRisk: 'low' | 'medium' | 'high' | 'unknown';
  fraudFlags: string[];
  summary: string;
  panelCount: number | null;
  capacityKw: number;
  inputCapacityKw: number;
  irradiance: number;
  kwh: number;
  theoreticalKwh: number;
  maxPlausibleKwh: number;
  actualKwh: number | null;
  billingPeriod: string;
  projectId: string;
  meterSerial: string;
  co2Kg: number;
  amountWei: string;
  imageHash: string;
  perceptualHash: string;
  imageCid: string;
  evidenceCid: string;
  exifGps: {latitude: number; longitude: number} | null;
  exifDistanceKm: number | null;
  exifGpsMatch: 'matched' | 'mismatch' | 'unavailable';
  proofHash: Hex;
  deadline: number;
  signature: Hex | null;
  signatureWithExpiry: Hex | null;
  oracleSigner: Address | null;
  alreadyUsedOnChain: boolean;
  chainId: number;
  registryAddress: Address | null;
  warnings: string[];
  disclaimer: string;
}

export interface SystemStatus {
  hasGeminiKey: boolean;
  hasOracleKey: boolean;
  oracleAddress: Address | null;
  contractOracleSigner: Address | null;
  chainId: number;
  network: string;
  deployBlock: number;
  registryAddress: Address | null;
  tokenAddress: Address | null;
  isDeployed: boolean;
}

export interface EvidenceDetailPayload {
  record: {
    proofHash: string;
    imageHash: string;
    perceptualHash: string;
    imageCid: string;
    evidenceCid: string;
    sourceMode: SourceMode;
    projectId: string;
    billingPeriod: string;
    meterSerial: string;
    latitude: number;
    longitude: number;
    exifGpsMatch: 'matched' | 'mismatch' | 'unavailable';
    exifDistanceKm: number | null;
    aiMode: string;
    solarMode: string;
    trustScore: number | null;
    fraudFlags: string[];
    summary: string;
    capacityKw: number;
    irradiance: number;
    kwh: number;
    actualKwh: number | null;
    co2Kg: number;
    deadline: number;
    createdAt: number;
  };
  imageDataUrl: string | null;
}

export const fmt = (n: number, maxDecimals = 2) =>
  n.toLocaleString('en-US', {maximumFractionDigits: maxDecimals});

export const shortAddr = (addr: string) =>
  addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;

export function formatRelativeTime(unixSec: number): string {
  if (!unixSec) return 'Trên chuỗi';
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSec);
  if (diff < 60) return 'Vừa xong';
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  return new Date(unixSec * 1000).toLocaleDateString('vi-VN');
}

export function getInjectedEthereum(): Eip1193Provider | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as {ethereum?: Eip1193Provider}).ethereum;
}
