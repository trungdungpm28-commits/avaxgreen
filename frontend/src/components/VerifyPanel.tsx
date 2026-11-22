'use client';

import {useEffect, useRef, useState} from 'react';
import {
  Check,
  CheckCheck,
  ChevronRight,
  Copy,
  Cpu,
  ExternalLink,
  FileText,
  FlaskConical,
  Info,
  LoaderCircle,
  MapPin,
  Plus,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Upload,
  Wallet,
} from 'lucide-react';
import type {Address, Hex} from 'viem';
import {
  REGISTRY_ABI,
  ensureFujiNetwork,
  getNetworkLabel,
  getPublicClient,
  getRegistryAddress,
  getWalletClient,
  isContractDeployed,
  txUrl,
} from '../lib/contracts';
import type {RegisteredProject} from '../lib/onchain';
import {formatAvaxError, sanitizeOnChainText, validateOnChainText} from '../lib/sanitize';
import {
  fmt,
  getInjectedEthereum,
  shortAddr,
  type SourceMode,
  type SystemStatus,
  type VerifyApiResponse,
} from '../lib/types';

interface VerifyPanelProps {
  wallet: Address | null;
  sysStatus: SystemStatus | null;
  registeredProjects: RegisteredProject[];
  onOpenWalletModal: () => void;
  onSetWalletChainId: (chainId: number) => void;
  onToast: (msg: string) => void;
  onRefreshOnChain: (wallet?: Address | null) => Promise<void>;
  onNavigateMarket: () => void;
  sampleSignal: number;
}

export function VerifyPanel({
  wallet,
  sysStatus,
  registeredProjects,
  onOpenWalletModal,
  onSetWalletChainId,
  onToast,
  onRefreshOnChain,
  onNavigateMarket,
  sampleSignal,
}: VerifyPanelProps) {
  const defaultPeriod = new Date().toISOString().slice(0, 7);

  const [sourceMode, setSourceMode] = useState<SourceMode>('rooftop-pv');
  const [projectId, setProjectId] = useState('VN-HCMC-001');
  const [billingPeriod, setBillingPeriod] = useState(defaultPeriod);
  const [meterSerial, setMeterSerial] = useState('');
  const [actualKwh, setActualKwh] = useState('');

  const [isSample, setIsSample] = useState(false);
  const [fileName, setFileName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [capacity, setCapacity] = useState(5);
  const [lat, setLat] = useState('10.8231');
  const [lng, setLng] = useState('106.6297');
  const [busy, setBusy] = useState('');
  const [verifyResult, setVerifyResult] = useState<VerifyApiResponse | null>(null);
  const [mintTxHash, setMintTxHash] = useState<Hex | null>(null);

  // Project registration form
  const [regId, setRegId] = useState('');
  const [regName, setRegName] = useState('');
  const [regLocation, setRegLocation] = useState('TP. Hồ Chí Minh');
  const [regCapacityKw, setRegCapacityKw] = useState(5);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastSampleSignal = useRef(0);

  useEffect(() => {
    if (sampleSignal > 0 && sampleSignal !== lastSampleSignal.current) {
      lastSampleSignal.current = sampleSignal;
      void loadSampleSolarData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampleSignal]);

  async function loadSampleSolarData() {
    try {
      setBusy('sample');
      const res = await fetch('/sample-solar.jpg');
      if (!res.ok) throw new Error('Không tải được ảnh mẫu /sample-solar.jpg');
      const blob = await res.blob();
      const sampleFile = new File([blob], 'thu-duc-rooftop-solar.jpg', {type: 'image/jpeg'});
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(sampleFile));
      setSelectedFile(sampleFile);
      setFileName('thu-duc-rooftop-solar.jpg');
      setSourceMode('rooftop-pv');
      setIsSample(true);
      setProjectId('VN-THUDUC-DEMO');
      setCapacity(5);
      setLat('10.8231');
      setLng('106.6297');
      setActualKwh('');
      setVerifyResult(null);
      setMintTxHash(null);
      onToast('Đã nạp ảnh mái nhà năng lượng mặt trời mẫu tại Thủ Đức (TP.HCM).');
    } catch (err) {
      onToast(formatAvaxError(err));
    } finally {
      setBusy('');
    }
  }

  function loadSampleIot() {
    setSourceMode('iot-telemetry');
    setIsSample(false);
    setSelectedFile(null);
    setFileName('');
    if (preview) {
      URL.revokeObjectURL(preview);
      setPreview('');
    }
    setProjectId('VN-HCMC-IOT-01');
    setMeterSerial('INV-HUAWEI-SUN2000-8839');
    setCapacity(5);
    setActualKwh('580');
    setLat('10.8231');
    setLng('106.6297');
    setVerifyResult(null);
    setMintTxHash(null);
    onToast('Đã nạp dữ liệu mẫu từ Inverter IoT SUN2000 (580 kWh / tháng).');
  }

  function handleFileChange(f?: File) {
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      onToast('Vui lòng chọn ảnh dưới 10 MB.');
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) {
      onToast('Chỉ hỗ trợ PNG, JPG và WEBP.');
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(f));
    setSelectedFile(f);
    setFileName(f.name);
    setIsSample(false);
    setVerifyResult(null);
    setMintTxHash(null);
  }

  async function runVerification() {
    const canSubmitIotWithoutImage =
      sourceMode === 'iot-telemetry' && meterSerial.trim().length > 0 && Number(actualKwh) > 0;
    if (!selectedFile && !isSample && !canSubmitIotWithoutImage) {
      onToast(
        sourceMode === 'iot-telemetry'
          ? 'Nhập Mã Smart Meter + Sản lượng thực tế (kWh) hoặc tải ảnh chụp Inverter.'
          : 'Hãy tải ảnh mái nhà/hóa đơn hoặc bấm "Tải dữ liệu mẫu".'
      );
      return;
    }

    setBusy('verify');
    setMintTxHash(null);
    try {
      const formData = new FormData();
      if (selectedFile) {
        formData.append('image', selectedFile);
      }
      if (wallet) {
        formData.append('userAddress', wallet);
      }
      formData.append('sourceMode', sourceMode);
      formData.append('projectId', projectId.trim());
      formData.append('billingPeriod', billingPeriod);
      if (meterSerial.trim()) formData.append('meterSerial', meterSerial.trim());
      if (actualKwh.trim()) formData.append('actualKwh', actualKwh.trim());
      formData.append('latitude', lat);
      formData.append('longitude', lng);
      formData.append('capacity', String(capacity));
      formData.append('isSample', String(isSample));
      if (isSample) {
        formData.append('sampleNonce', String(Date.now()));
      }

      const response = await fetch('/api/verify', {
        method: 'POST',
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Kiểm định thất bại.');
      }

      setVerifyResult(payload as VerifyApiResponse);
      if (payload.signatureWithExpiry || payload.signature) {
        onToast('Kiểm định hoàn tất & Oracle đã ký xác thực ECDSA (có thời hạn)!',);
      } else {
        onToast('Đã hoàn tất phân tích kiểm định & đối chiếu NASA POWER.');
      }
    } catch (err) {
      onToast(formatAvaxError(err));
    } finally {
      setBusy('');
    }
  }

  async function mintOnChain() {
    const registryAddress = getRegistryAddress();
    if (!isContractDeployed() || !registryAddress) {
      onToast('Smart Contract chưa được deploy. Hãy vào tab Quản trị để 1-Click Deploy.');
      return;
    }
    if (!wallet) {
      onOpenWalletModal();
      onToast('Vui lòng kết nối ví trước khi Mint GCARB.');
      return;
    }
    if (!verifyResult || (!verifyResult.signatureWithExpiry && !verifyResult.signature)) {
      onToast('Chưa có chữ ký Oracle hợp lệ. Hãy bấm Xác minh lại sau khi kết nối ví.');
      return;
    }

    const eth = getInjectedEthereum();
    if (!eth) {
      onToast('Không tìm thấy ví trình duyệt.');
      return;
    }

    setBusy('mint');
    try {
      const switchedId = await ensureFujiNetwork(eth);
      onSetWalletChainId(switchedId);
      const walletClient = getWalletClient(eth, wallet, switchedId);
      const client = getPublicClient(switchedId);

      const useExpiry = Boolean(verifyResult.signatureWithExpiry && verifyResult.deadline);
      const hash = useExpiry
        ? await walletClient.writeContract({
            address: registryAddress,
            abi: REGISTRY_ABI,
            functionName: 'mintVerifiedCreditsWithExpiry',
            args: [
              BigInt(verifyResult.amountWei),
              verifyResult.proofHash,
              BigInt(verifyResult.deadline),
              verifyResult.projectId || '',
              verifyResult.signatureWithExpiry!,
            ],
            account: wallet,
          })
        : await walletClient.writeContract({
            address: registryAddress,
            abi: REGISTRY_ABI,
            functionName: 'mintVerifiedCredits',
            args: [BigInt(verifyResult.amountWei), verifyResult.proofHash, verifyResult.signature!],
            account: wallet,
          });

      onToast(`Đang xác nhận giao dịch Mint trên ${getNetworkLabel()}…`);
      await client.waitForTransactionReceipt({hash});
      setMintTxHash(hash);
      setVerifyResult((prev) => (prev ? {...prev, alreadyUsedOnChain: true} : prev));
      onToast(`Mint thành công ${fmt(verifyResult.co2Kg, 3)} GCARB on-chain!`);
      await onRefreshOnChain(wallet);
    } catch (err) {
      onToast(formatAvaxError(err));
    } finally {
      setBusy('');
    }
  }

  async function registerProjectOnChain() {
    const registryAddress = getRegistryAddress();
    if (!isContractDeployed() || !registryAddress) {
      onToast('Smart Contract chưa được deploy.');
      return;
    }
    if (!wallet) {
      onOpenWalletModal();
      onToast('Kết nối ví để đăng ký hồ sơ dự án on-chain.');
      return;
    }

    const idErr = validateOnChainText(regId, 64, 'Mã dự án');
    if (idErr) return onToast(idErr);
    const nameErr = validateOnChainText(regName, 100, 'Tên dự án');
    if (nameErr) return onToast(nameErr);
    const locErr = validateOnChainText(regLocation, 100, 'Vị trí lắp đặt');
    if (locErr) return onToast(locErr);
    if (!Number.isFinite(regCapacityKw) || regCapacityKw <= 0 || regCapacityKw > 10000) {
      return onToast('Công suất dự án phải lớn hơn 0 kWp.');
    }

    const eth = getInjectedEthereum();
    if (!eth) return;

    setBusy('register-project');
    try {
      const switchedId = await ensureFujiNetwork(eth);
      onSetWalletChainId(switchedId);
      const walletClient = getWalletClient(eth, wallet, switchedId);
      const client = getPublicClient(switchedId);

      const cleanId = sanitizeOnChainText(regId, 64);
      const cleanName = sanitizeOnChainText(regName, 100);
      const cleanLoc = sanitizeOnChainText(regLocation, 100);
      const capacityWatt = BigInt(Math.round(regCapacityKw * 1000));

      const hash = await walletClient.writeContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'registerProject',
        args: [cleanId, cleanName, cleanLoc, capacityWatt],
        account: wallet,
      });

      onToast('Đang ghi hồ sơ dự án lên blockchain…');
      await client.waitForTransactionReceipt({hash});
      setProjectId(cleanId);
      setCapacity(regCapacityKw);
      setRegId('');
      setRegName('');
      onToast(`Đã đăng ký dự án ${cleanId} thành công on-chain!`);
      await onRefreshOnChain(wallet);
    } catch (err) {
      onToast(formatAvaxError(err));
    } finally {
      setBusy('');
    }
  }

  function copyVal(text: string, label: string) {
    navigator.clipboard?.writeText(text);
    onToast(`Đã sao chép ${label}.`);
  }

  const canVerifyIot =
    sourceMode === 'iot-telemetry' && meterSerial.trim().length > 0 && Number(actualKwh) > 0;
  const coordsValid =
    Number.isFinite(Number(lat)) &&
    Number(lat) >= -90 &&
    Number(lat) <= 90 &&
    Number(lng) >= -180 &&
    Number(lng) <= 180;

  return (
    <>
      <div className="demo-banner">
        <FlaskConical size={19} />
        <div>
          <strong>Kiểm định Đa nguồn · AI Vision / Hóa đơn EVN / IoT Inverter + NASA POWER</strong>
          <p>
            Chống trùng lặp bằng Perceptual Hash, kiểm tra EXIF GPS, gán IPFS CIDv1 & ký Oracle
            ECDSA có thời hạn (1 giờ).
          </p>
        </div>
        <div className="banner-actions">
          <button onClick={loadSampleSolarData} disabled={!!busy}>
            {busy === 'sample' ? <LoaderCircle size={15} className="spin" /> : <Sun size={15} />}
            Mẫu Mái nhà
          </button>
          <button className="secondary-btn" onClick={loadSampleIot} disabled={!!busy}>
            <Cpu size={15} />
            Mẫu IoT Inverter
          </button>
        </div>
      </div>

      <div className="flow-steps">
        {[
          'Chọn nguồn & Dự án',
          'AI / IoT + NASA POWER',
          'Oracle ECDSA + IPFS CID',
          'Mint GCARB On-Chain',
        ].map((label, i) => {
          const done =
            (i === 0 && (Boolean(fileName) || canVerifyIot)) ||
            (i === 1 && Boolean(verifyResult)) ||
            (i === 2 && Boolean(verifyResult?.signatureWithExpiry || verifyResult?.signature)) ||
            (i === 3 && Boolean(mintTxHash));
          return (
            <span key={label} className={done ? 'current' : ''}>
              <b>{done ? <Check size={14} /> : i + 1}</b>
              {label}
            </span>
          );
        })}
      </div>

      <div className="verify-grid">
        <section className="panel form-panel">
          <div className="panel-title">
            <div>
              <h3>Dữ liệu Dự án & Bằng chứng</h3>
              <p>Chọn phương thức xác minh sản lượng điện sạch</p>
            </div>
            <Sun size={21} />
          </div>

          <div className="mode-tabs">
            <button
              className={sourceMode === 'rooftop-pv' ? 'active' : ''}
              onClick={() => {
                setSourceMode('rooftop-pv');
                setVerifyResult(null);
              }}
            >
              <Sun size={14} /> Ảnh Mái nhà
            </button>
            <button
              className={sourceMode === 'electricity-bill' ? 'active' : ''}
              onClick={() => {
                setSourceMode('electricity-bill');
                setVerifyResult(null);
              }}
            >
              <FileText size={14} /> Hóa đơn EVN
            </button>
            <button
              className={sourceMode === 'iot-telemetry' ? 'active' : ''}
              onClick={() => {
                setSourceMode('iot-telemetry');
                setVerifyResult(null);
              }}
            >
              <Cpu size={14} /> IoT Inverter
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => handleFileChange(e.target.files?.[0])}
          />

          <button
            className={`upload-zone ${fileName ? 'has-file' : ''}`}
            onClick={() => fileInputRef.current?.click()}
          >
            {preview ? (
              <img src={preview} alt="Ảnh dự án điện mặt trời" />
            ) : (
              <span className="upload-icon">
                {fileName ? <Sun size={29} /> : <Upload size={27} />}
              </span>
            )}
            <strong>
              {fileName ||
                (sourceMode === 'electricity-bill'
                  ? 'Tải ảnh hóa đơn tiền điện / biên bản công tơ 2 chiều'
                  : sourceMode === 'iot-telemetry'
                    ? 'Tùy chọn: Ảnh chụp màn hình Inverter / Smart Meter'
                    : 'Chọn ảnh mái nhà lắp pin mặt trời')}
            </strong>
            <span>{fileName ? 'Bấm để thay đổi ảnh' : 'PNG, JPG, WEBP · Tối đa 10 MB'}</span>
            {isSample && (
              <b className="sample-badge">SAMPLE SOLAR PROJECT · THỦ ĐỨC, TP.HCM</b>
            )}
          </button>

          <div className="input-grid">
            <label>
              Mã dự án (Project ID)
              <input
                list="registered-project-ids"
                placeholder="VN-HCMC-001"
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setVerifyResult(null);
                }}
              />
              <datalist id="registered-project-ids">
                {registeredProjects.map((p) => (
                  <option key={p.id} value={p.projectId}>
                    {p.name} ({p.capacityKw} kWp)
                  </option>
                ))}
              </datalist>
            </label>
            <label>
              Kỳ ghi nhận (Tháng)
              <input
                type="month"
                value={billingPeriod}
                onChange={(e) => {
                  setBillingPeriod(e.target.value);
                  setVerifyResult(null);
                }}
              />
            </label>

            {(sourceMode === 'electricity-bill' || sourceMode === 'iot-telemetry') && (
              <>
                <label>
                  Mã Công tơ / Inverter Serial
                  <input
                    placeholder="Ví dụ: INV-SUN2000-8839"
                    value={meterSerial}
                    onChange={(e) => {
                      setMeterSerial(e.target.value);
                      setVerifyResult(null);
                    }}
                  />
                </label>
                <label>
                  Sản lượng thực tế (kWh)
                  <input
                    type="number"
                    min="1"
                    step="0.1"
                    placeholder={
                      sourceMode === 'electricity-bill' ? 'Để trống nếu để AI OCR tự đọc' : '580'
                    }
                    value={actualKwh}
                    onChange={(e) => {
                      setActualKwh(e.target.value);
                      setVerifyResult(null);
                    }}
                  />
                </label>
              </>
            )}

            <label>
              Công suất lắp đặt (kWp)
              <input
                type="number"
                min="0.1"
                max="1000"
                step="0.1"
                value={capacity}
                onChange={(e) => {
                  setCapacity(Math.max(0.1, Math.min(1000, Number(e.target.value) || 0.1)));
                  setVerifyResult(null);
                }}
              />
            </label>
            <label>
              Chu kỳ đối chiếu bức xạ
              <input value="30 ngày · NASA POWER" readOnly />
            </label>
            <label>
              Vĩ độ (Latitude)
              <input
                value={lat}
                onChange={(e) => {
                  setLat(e.target.value);
                  setVerifyResult(null);
                }}
              />
            </label>
            <label>
              Kinh độ (Longitude)
              <input
                value={lng}
                onChange={(e) => {
                  setLng(e.target.value);
                  setVerifyResult(null);
                }}
              />
            </label>
          </div>

          <div className="field-note">
            <MapPin size={14} />
            Tọa độ: ({lat}, {lng}) · Ví nhận: {wallet ? shortAddr(wallet) : 'Chưa kết nối ví'}
          </div>

          <button
            className="primary full"
            disabled={!!busy || (!fileName && !isSample && !canVerifyIot) || !coordsValid}
            onClick={runVerification}
          >
            {busy === 'verify' ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <ScanLine size={18} />
            )}
            {busy === 'verify'
              ? 'Đang kiểm định AI + NASA + pHash…'
              : 'Xác minh Bằng chứng & Ký Oracle'}
          </button>

          <div className="server-status-row">
            <span className={sysStatus?.hasGeminiKey ? 'dot-ok' : 'dot-warn'}>
              Gemini AI: {sysStatus?.hasGeminiKey ? 'Sẵn sàng' : 'Chưa gắn key'}
            </span>
            <span className={sysStatus?.hasOracleKey ? 'dot-ok' : 'dot-warn'}>
              Oracle Signer: {sysStatus?.hasOracleKey ? 'Sẵn sàng' : 'Chưa gắn key'}
            </span>
          </div>
        </section>

        <section className="panel evidence-panel">
          <div className="panel-title">
            <div>
              <div className="eyebrow">AI + SATELLITE + IPFS CID + ECDSA ORACLE</div>
              <h3>Evidence Passport</h3>
            </div>
            <ShieldCheck size={24} />
          </div>

          {!verifyResult ? (
            <div className="evidence-empty">
              <div className="scan-visual">
                <ScanLine size={52} />
              </div>
              <h3>
                Mọi tác động đều bắt đầu
                <br />
                từ một bằng chứng.
              </h3>
              <p>
                Hệ thống kiểm tra EXIF GPS, Perceptual Hash chống nộp trùng nhiều tháng, đối chiếu
                bức xạ NASA POWER, lưu IPFS CIDv1 và ký ECDSA có thời hạn.
              </p>
              <div className="evidence-chips">
                <span>Perceptual Hash</span>
                <span>EXIF GPS Check</span>
                <span>IPFS CIDv1</span>
              </div>
            </div>
          ) : (
            <>
              <div
                className={
                  verifyResult.signatureWithExpiry || verifyResult.signature
                    ? 'verified-banner'
                    : 'verified-banner warn'
                }
              >
                <CheckCheck size={18} />
                {verifyResult.signatureWithExpiry || verifyResult.signature
                  ? 'Đã xác thực đa lớp & Oracle ký ECDSA thành công'
                  : 'Đã tính toán ước tính (chưa đủ điều kiện ký Oracle)'}
              </div>

              <div className="evidence-number">
                <span>TÍN CHỈ CARBON ĐƯỢC PHÉP MINT</span>
                <strong>
                  {fmt(verifyResult.co2Kg, 3)}
                  <small>kg CO₂</small>
                </strong>
                <p>= {fmt(verifyResult.co2Kg, 3)} GCARB (ERC-20 · 1 GCARB = 1 kg CO₂)</p>
              </div>

              <div className="trust-card">
                <div className="trust-head">
                  <span>Điểm tin cậy / Chống gian lận AI & Vật lý</span>
                  <strong
                    className={
                      verifyResult.fraudRisk === 'low'
                        ? 'risk-low'
                        : verifyResult.fraudRisk === 'medium'
                          ? 'risk-med'
                          : 'risk-high'
                    }
                  >
                    {verifyResult.trustScore !== null
                      ? `${verifyResult.trustScore}/100 (${verifyResult.fraudRisk.toUpperCase()})`
                      : 'Chưa đánh giá'}
                  </strong>
                </div>
                <div className="trust-bar">
                  <div
                    style={{width: `${verifyResult.trustScore ?? 0}%`}}
                    className={verifyResult.fraudRisk}
                  />
                </div>
                <p className="trust-summary">{verifyResult.summary}</p>
                {verifyResult.fraudFlags.length > 0 && (
                  <ul className="fraud-flags">
                    {verifyResult.fraudFlags.map((flag, idx) => (
                      <li key={idx}>
                        <ShieldAlert size={13} /> {flag}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="evidence-row">
                <span>Nguồn kiểm định · Kỳ</span>
                <strong>
                  {verifyResult.sourceMode} · {verifyResult.billingPeriod}
                  {verifyResult.projectId ? ` · ${verifyResult.projectId}` : ''}
                </strong>
              </div>
              <div className="evidence-row">
                <span>Sản lượng áp dụng / Trần NASA</span>
                <strong>
                  {fmt(verifyResult.kwh)} kWh{' '}
                  {verifyResult.actualKwh ? '(Thực tế)' : '(Ước tính)'} / Trần{' '}
                  {fmt(verifyResult.maxPlausibleKwh)} kWh
                </strong>
              </div>
              <div className="evidence-row">
                <span>Bức xạ mặt trời (NASA POWER)</span>
                <strong>
                  {verifyResult.irradiance} kWh/m²/ngày (
                  {verifyResult.solarMode === 'nasa-climatology' ? 'Live NASA' : 'Mẫu'})
                </strong>
              </div>
              <div className="evidence-row">
                <span>Kiểm tra EXIF GPS & pHash</span>
                <strong>
                  {verifyResult.exifGpsMatch === 'matched'
                    ? `Khớp GPS (${verifyResult.exifDistanceKm} km)`
                    : verifyResult.exifGpsMatch === 'mismatch'
                      ? `Lệch GPS (${verifyResult.exifDistanceKm} km)`
                      : 'Không có EXIF'}{' '}
                  · {verifyResult.perceptualHash}
                </strong>
              </div>
              <div className="evidence-row">
                <span>IPFS Evidence CIDv1</span>
                <strong className="mono inline-copy-row">
                  {shortAddr(verifyResult.evidenceCid)}
                  <button
                    className="icon-button inline-copy"
                    onClick={() => copyVal(verifyResult.evidenceCid, 'IPFS Evidence CIDv1')}
                  >
                    <Copy size={12} />
                  </button>
                </strong>
              </div>
              <div className="evidence-row">
                <span>Proof Hash · Hạn chữ ký Oracle</span>
                <strong className="mono">
                  {shortAddr(verifyResult.proofHash)} ·{' '}
                  {new Date(verifyResult.deadline * 1000).toLocaleTimeString('vi-VN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </strong>
              </div>

              {verifyResult.warnings.length > 0 && (
                <div className="warnings-box">
                  {verifyResult.warnings.map((w, i) => (
                    <p key={i}>
                      <Info size={13} /> {w}
                    </p>
                  ))}
                </div>
              )}

              {!wallet && (
                <button className="secondary full" onClick={onOpenWalletModal}>
                  <Wallet size={17} /> Kết nối ví EVM để Oracle ký cho địa chỉ của bạn
                </button>
              )}

              <button
                className="primary full"
                disabled={
                  !!busy ||
                  !isContractDeployed() ||
                  !wallet ||
                  (!verifyResult.signatureWithExpiry && !verifyResult.signature) ||
                  verifyResult.alreadyUsedOnChain ||
                  Boolean(mintTxHash)
                }
                onClick={mintOnChain}
              >
                {mintTxHash || verifyResult.alreadyUsedOnChain ? (
                  <Check size={18} />
                ) : busy === 'mint' ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <Plus size={18} />
                )}
                {mintTxHash
                  ? 'Đã Mint GCARB lên chuỗi'
                  : verifyResult.alreadyUsedOnChain
                    ? 'Bằng chứng đã được Mint trước đó'
                    : `Mint ${fmt(verifyResult.co2Kg, 3)} GCARB On-Chain`}
              </button>

              {mintTxHash && (
                <div className="tx-success-box">
                  <CheckCheck size={17} />
                  <div>
                    <strong>Giao dịch Mint đã xác nhận trên {getNetworkLabel()}!</strong>
                    {txUrl(mintTxHash) ? (
                      <a href={txUrl(mintTxHash)!} target="_blank" rel="noreferrer">
                        Kiểm chứng trên Snowtrace ({shortAddr(mintTxHash)}){' '}
                        <ExternalLink size={13} />
                      </a>
                    ) : (
                      <span>Tx: {mintTxHash}</span>
                    )}
                  </div>
                </div>
              )}

              {mintTxHash && (
                <button className="text-button full" onClick={onNavigateMarket}>
                  Tiếp tục sang Thị trường & Retire <ChevronRight size={16} />
                </button>
              )}
            </>
          )}
        </section>
      </div>

      <section className="panel activity-panel project-registry-panel">
        <div className="panel-title">
          <div>
            <h3>Hồ sơ Dự án Điện mặt trời On-Chain (Project Registry)</h3>
            <p>Đăng ký định danh hệ thống mái nhà/nhà máy lên Smart Contract để theo dõi lũy kế CO₂.</p>
          </div>
          <span className="period">{registeredProjects.length} dự án đã đăng ký</span>
        </div>

        <div className="project-form-row">
          <input
            placeholder="Mã dự án (vd: VN-HCMC-002)"
            value={regId}
            onChange={(e) => setRegId(e.target.value)}
          />
          <input
            placeholder="Tên hộ gia đình / nhà máy"
            value={regName}
            onChange={(e) => setRegName(e.target.value)}
          />
          <input
            placeholder="Địa phương"
            value={regLocation}
            onChange={(e) => setRegLocation(e.target.value)}
          />
          <input
            type="number"
            min="0.5"
            step="0.5"
            placeholder="kWp"
            value={regCapacityKw}
            onChange={(e) => setRegCapacityKw(Number(e.target.value))}
          />
          <button
            className="primary"
            onClick={registerProjectOnChain}
            disabled={!!busy || !isContractDeployed()}
          >
            {busy === 'register-project' ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Plus size={15} />
            )}
            Đăng ký Dự án
          </button>
        </div>

        {registeredProjects.length === 0 ? (
          <div className="empty-table-note">
            <Info size={16} />
            <span>Chưa có dự án nào được đăng ký trên contract. Hãy đăng ký dự án đầu tiên ở trên.</span>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>MÃ DỰ ÁN</th>
                  <th>CHỦ SỞ HỮU</th>
                  <th>VỊ TRÍ</th>
                  <th>CÔNG SUẤT</th>
                  <th>TỔNG ĐÃ MINT</th>
                  <th>CHỌN</th>
                </tr>
              </thead>
              <tbody>
                {registeredProjects.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.projectId}</strong>
                      <div className="muted">{p.name}</div>
                    </td>
                    <td className="mono">{shortAddr(p.owner)}</td>
                    <td>{p.location}</td>
                    <td>{fmt(p.capacityKw, 1)} kWp</td>
                    <td className="numeric">{fmt(p.totalMintedKg, 2)} kg CO₂</td>
                    <td>
                      <button
                        className="refresh-pill"
                        onClick={() => {
                          setProjectId(p.projectId);
                          setCapacity(p.capacityKw);
                          onToast(`Đã chọn dự án ${p.projectId} (${p.capacityKw} kWp).`);
                        }}
                      >
                        Dùng để Mint
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
