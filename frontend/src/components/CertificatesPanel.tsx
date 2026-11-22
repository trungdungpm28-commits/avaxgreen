'use client';

import {useState} from 'react';
import {
  Award,
  Code2,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Leaf,
  Link2,
  LoaderCircle,
  Lock,
  Printer,
  QrCode,
  Search,
  ShieldCheck,
  TreePine,
  Wallet,
} from 'lucide-react';
import type {Address} from 'viem';
import {
  REGISTRY_ABI,
  ensureFujiNetwork,
  getNetworkLabel,
  getPublicClient,
  getRegistryAddress,
  getWalletClient,
  isContractDeployed,
  nftUrl,
  txUrl,
} from '../lib/contracts';
import {exportCertificatesCsv, printEsgReport} from '../lib/exportReport';
import {fetchCertificateById, type OnChainActivityItem, type OnChainCertificate} from '../lib/onchain';
import {generateQrSvgDataUrl} from '../lib/qr';
import {formatAvaxError} from '../lib/sanitize';
import {fmt, getInjectedEthereum, shortAddr} from '../lib/types';

interface CertificatesPanelProps {
  wallet: Address | null;
  certs: OnChainCertificate[];
  activity: OnChainActivityItem[];
  publicCert: OnChainCertificate | null;
  onSetPublicCert: (cert: OnChainCertificate | null) => void;
  onInspectCert: (cert: OnChainCertificate) => void;
  onOpenWalletModal: () => void;
  onSetWalletChainId: (chainId: number) => void;
  onToast: (msg: string) => void;
  onRefreshOnChain: (wallet?: Address | null) => Promise<void>;
  onNavigateMarket: () => void;
}

export function CertificatesPanel({
  wallet,
  certs,
  activity,
  publicCert,
  onSetPublicCert,
  onInspectCert,
  onOpenWalletModal,
  onSetWalletChainId,
  onToast,
  onRefreshOnChain,
  onNavigateMarket,
}: CertificatesPanelProps) {
  const [lookupId, setLookupId] = useState(publicCert ? String(publicCert.id) : '1');
  const [searching, setSearching] = useState(false);
  const [lockingId, setLockingId] = useState<number | null>(null);
  const [qrCertId, setQrCertId] = useState<number | null>(null);

  function getPublicLink(certId: number): string {
    if (typeof window === 'undefined') return `/?cert=${certId}`;
    return `${window.location.origin}/?cert=${certId}`;
  }

  async function handleLookup() {
    const id = Math.floor(Number(lookupId));
    if (!Number.isInteger(id) || id <= 0) {
      return onToast('Nhập Certificate ID nguyên dương (ví dụ: 1).');
    }
    setSearching(true);
    try {
      const found = await fetchCertificateById(id, activity);
      if (!found) {
        onSetPublicCert(null);
        return onToast(`Không tìm thấy Chứng nhận ESG #${id} trên chuỗi.`);
      }
      onSetPublicCert(found);
      onToast(`Đã xác minh Chứng nhận ESG #${id} trực tiếp từ Smart Contract!`);
    } finally {
      setSearching(false);
    }
  }

  async function lockSoulbound(certId: number) {
    const registryAddress = getRegistryAddress();
    if (!isContractDeployed() || !registryAddress || !wallet) return;
    const eth = getInjectedEthereum();
    if (!eth) return;

    setLockingId(certId);
    try {
      const switchedId = await ensureFujiNetwork(eth);
      onSetWalletChainId(switchedId);
      const walletClient = getWalletClient(eth, wallet, switchedId);
      const client = getPublicClient(switchedId);

      const hash = await walletClient.writeContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'lockCertificateSoulbound',
        args: [BigInt(certId)],
        account: wallet,
      });
      onToast(`Đang khóa vĩnh viễn Soulbound cho NFT #${certId}…`);
      await client.waitForTransactionReceipt({hash});
      onToast(`Chứng nhận #${certId} đã được khóa Soulbound (SBT) vĩnh viễn!`);
      await onRefreshOnChain(wallet);
      if (publicCert?.id === certId) {
        const refreshed = await fetchCertificateById(certId, activity);
        if (refreshed) onSetPublicCert(refreshed);
      }
    } catch (err) {
      onToast(formatAvaxError(err));
    } finally {
      setLockingId(null);
    }
  }

  function downloadSvg(cert: OnChainCertificate) {
    if (!cert.svgMarkup) return;
    const blob = new Blob([cert.svgMarkup], {type: 'image/svg+xml;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `AvaxGreen-ESG-${cert.id}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function copyPublicLink(certId: number) {
    const link = getPublicLink(certId);
    navigator.clipboard?.writeText(link);
    onToast(`Đã sao chép Link xác minh công khai cho Chứng nhận #${certId}.`);
  }

  function renderCertificateCard(c: OnChainCertificate, isPublicHighlight = false) {
    const explorerNft = nftUrl(c.id);
    const explorerTx = txUrl(c.txHash);
    const verifyLink = getPublicLink(c.id);
    const isOwner = wallet && c.owner.toLowerCase() === wallet.toLowerCase();
    const showQr = qrCertId === c.id || isPublicHighlight;

    return (
      <article className={`panel certificate ${isPublicHighlight ? 'public-cert-highlight' : ''}`} key={`${isPublicHighlight ? 'pub' : 'own'}-${c.id}`}>
        <div className="cert-svg-wrap">
          <span className={`onchain-badge ${c.soulbound ? 'sbt-badge' : ''}`}>
            {c.soulbound ? 'SOULBOUND (SBT)' : 'ERC-721'} · 100% On-Chain SVG
          </span>
          {c.imageDataUri ? (
            <img src={c.imageDataUri} alt={`Chứng nhận ESG #${c.id} - ${c.company}`} />
          ) : (
            <div className="cert-art">
              <h3>{c.company}</h3>
              <strong>{fmt(c.amountKg, 3)} kg CO₂</strong>
            </div>
          )}
        </div>
        <div className="cert-info">
          <div className="cert-head">
            <h3>
              #{c.id} · {c.company}
            </h3>
            <strong>{fmt(c.amountKg, 3)} kg CO₂</strong>
          </div>
          <p>{c.reason}</p>
          <div className="cert-owner-line">
            <span>Chủ sở hữu:</span>
            <strong className="mono">{shortAddr(c.owner)}</strong>
          </div>

          {showQr && (
            <div className="qr-verify-box">
              <img src={generateQrSvgDataUrl(verifyLink)} alt={`QR xác minh #${c.id}`} />
              <div>
                <strong>Mã QR Xác minh Công khai</strong>
                <p>Đối tác quét mã hoặc truy cập đường dẫn dưới đây để đối chiếu trực tiếp on-chain.</p>
                <code className="mono">{verifyLink}</code>
              </div>
            </div>
          )}

          <div className="cert-footer">
            <span>
              {c.retiredAt ? new Date(c.retiredAt * 1000).toLocaleString('vi-VN') : 'On-chain'}
            </span>
            <div className="cert-actions">
              {!c.soulbound && isOwner && (
                <button
                  className="explorer-pill sbt-lock-btn"
                  disabled={lockingId === c.id}
                  onClick={() => lockSoulbound(c.id)}
                  title="Khóa Soulbound (chống chuyển nhượng)"
                >
                  {lockingId === c.id ? (
                    <LoaderCircle size={11} className="spin" />
                  ) : (
                    <Lock size={11} />
                  )}
                  Khóa SBT
                </button>
              )}
              <button
                className="icon-button"
                title="Hiển thị / ẩn mã QR xác minh"
                onClick={() => setQrCertId(qrCertId === c.id ? null : c.id)}
              >
                <QrCode size={16} />
              </button>
              <button
                className="icon-button"
                title="Sao chép Link xác minh công khai"
                onClick={() => copyPublicLink(c.id)}
              >
                <Link2 size={16} />
              </button>
              <button
                className="icon-button"
                title="In / Xuất Báo cáo PDF"
                onClick={() => printEsgReport([c], `Chứng nhận ESG #${c.id}`)}
              >
                <Printer size={16} />
              </button>
              {explorerTx && (
                <a
                  className="explorer-pill"
                  href={explorerTx}
                  target="_blank"
                  rel="noreferrer"
                  title="Xem giao dịch Retire trên Snowtrace"
                >
                  Tx <ExternalLink size={11} />
                </a>
              )}
              {explorerNft && (
                <a
                  className="explorer-pill"
                  href={explorerNft}
                  target="_blank"
                  rel="noreferrer"
                  title="Xem NFT trên Snowtrace"
                >
                  NFT <ExternalLink size={11} />
                </a>
              )}
              <button
                className="icon-button"
                title="Kiểm tra On-Chain Metadata & SVG Code"
                onClick={() => onInspectCert(c)}
              >
                <Code2 size={16} />
              </button>
              <button
                className="icon-button"
                title="Tải file ảnh SVG"
                onClick={() => downloadSvg(c)}
              >
                <Download size={16} />
              </button>
            </div>
          </div>
        </div>
      </article>
    );
  }

  return (
    <>
      <section className="panel public-verifier-panel">
        <div className="panel-title">
          <div>
            <h3>Cổng Tra cứu & Xác minh Chứng nhận Công khai (Public Verifier)</h3>
            <p>
              Nhập mã ID chứng nhận (không cần kết nối ví) để đối tác kiểm chứng độc lập trên{' '}
              {getNetworkLabel()}.
            </p>
          </div>
          <div className="verifier-search-row">
            <input
              type="number"
              min="1"
              placeholder="ID chứng nhận (vd: 1)"
              value={lookupId}
              onChange={(e) => setLookupId(e.target.value)}
            />
            <button className="primary" onClick={handleLookup} disabled={searching || !isContractDeployed()}>
              {searching ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />}
              Xác minh
            </button>
          </div>
        </div>

        {publicCert && (
          <div className="public-cert-wrap">
            {renderCertificateCard(publicCert, true)}
          </div>
        )}
      </section>

      <div className="section-line">
        <h3>
          Bộ sưu tập Chứng nhận ESG NFT của bạn <span className="count-badge">{certs.length}</span>
        </h3>
        <div className="chain-links-row">
          {certs.length > 0 && (
            <>
              <button
                className="refresh-pill"
                onClick={() => printEsgReport(certs, 'Báo cáo Kiểm toán ESG Doanh nghiệp')}
              >
                <Printer size={12} /> Xuất Báo cáo PDF
              </button>
              <button className="refresh-pill" onClick={() => exportCertificatesCsv(certs)}>
                <FileSpreadsheet size={12} /> Xuất CSV
              </button>
            </>
          )}
          <span>
            <ShieldCheck size={15} />
            100% On-Chain SVG · {getNetworkLabel()}
          </span>
        </div>
      </div>

      {!wallet ? (
        <section className="panel empty-gallery">
          <div className="certificate-illustration">
            <Award size={62} />
            <Leaf size={25} />
          </div>
          <span className="eyebrow">WALLET REQUIRED</span>
          <h2>Kết nối ví để xem bộ sưu tập ESG NFT cá nhân.</h2>
          <p>
            Bạn vẫn có thể tra cứu công khai bất kỳ Chứng nhận nào bằng ID ở khung phía trên mà
            không cần kết nối ví.
          </p>
          <button className="primary" onClick={onOpenWalletModal}>
            <Wallet size={18} />
            Kết nối ví EVM
          </button>
        </section>
      ) : certs.length === 0 ? (
        <section className="panel empty-gallery">
          <div className="certificate-illustration">
            <Award size={62} />
            <Leaf size={25} />
          </div>
          <span className="eyebrow">ON-CHAIN ESG GALLERY</span>
          <h2>Chứng nhận đầu tiên đang chờ bạn.</h2>
          <p>
            Mua hoặc mint GCARB rồi thực hiện Retire để tạo Chứng nhận xanh NFT
            <br />
            với SVG lưu trữ vĩnh viễn trên blockchain Avalanche.
          </p>
          <button className="primary" onClick={onNavigateMarket}>
            <TreePine size={18} />
            Đi tới Thị trường & Retire
          </button>
        </section>
      ) : (
        <div className="certificate-grid">{certs.map((c) => renderCertificateCard(c, false))}</div>
      )}
    </>
  );
}
