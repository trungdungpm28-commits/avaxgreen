import {getNetworkLabel, getRegistryAddress, txUrl} from './contracts';
import type {OnChainActivityItem, OnChainCertificate} from './onchain';
import {generateQrSvgDataUrl} from './qr';

function escapeCsv(val: string | number | undefined | null): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadBlob(content: string, mime: string, filename: string) {
  const blob = new Blob([content], {type: mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportActivityCsv(items: OnChainActivityItem[]) {
  const headers = ['Type', 'Actor', 'Amount_kgCO2_or_kWp', 'Detail', 'Block', 'Timestamp', 'TxHash', 'ExplorerUrl'];
  const rows = items.map((item) => [
    escapeCsv(item.type),
    escapeCsv(item.actor),
    escapeCsv(item.amountKg),
    escapeCsv(item.detail),
    escapeCsv(item.blockNumber.toString()),
    escapeCsv(item.timestamp ? new Date(item.timestamp * 1000).toISOString() : ''),
    escapeCsv(item.txHash),
    escapeCsv(txUrl(item.txHash) || ''),
  ]);
  const csv = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  downloadBlob(csv, 'text/csv;charset=utf-8', 'AvaxGreen-OnChain-Activity.csv');
}

export function exportCertificatesCsv(certs: OnChainCertificate[]) {
  const headers = [
    'CertificateId',
    'Company',
    'CO2_Retired_kg',
    'Reason',
    'Owner',
    'Soulbound_SBT',
    'RetiredAt_ISO',
    'TxHash',
  ];
  const rows = certs.map((c) => [
    escapeCsv(c.id),
    escapeCsv(c.company),
    escapeCsv(c.amountKg),
    escapeCsv(c.reason),
    escapeCsv(c.owner),
    escapeCsv(c.soulbound ? 'YES' : 'NO'),
    escapeCsv(c.retiredAt ? new Date(c.retiredAt * 1000).toISOString() : ''),
    escapeCsv(c.txHash || ''),
  ]);
  const csv = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  downloadBlob(csv, 'text/csv;charset=utf-8', 'AvaxGreen-ESG-Certificates.csv');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function printEsgReport(certs: OnChainCertificate[], title = 'Báo cáo Kiểm toán ESG Carbon Retirement') {
  if (typeof window === 'undefined' || certs.length === 0) return;

  const totalKg = certs.reduce((sum, c) => sum + c.amountKg, 0);
  const registry = getRegistryAddress() || '';
  const network = getNetworkLabel();
  const origin = window.location.origin;

  const cardsHtml = certs
    .map((c) => {
      const verifyUrl = `${origin}/?cert=${c.id}`;
      const qr = generateQrSvgDataUrl(verifyUrl);
      const retiredTime = c.retiredAt ? new Date(c.retiredAt * 1000).toLocaleString('vi-VN') : 'On-Chain';
      return `
        <div class="cert-card">
          <div class="cert-meta">
            <div class="cert-head">
              <span class="badge">${c.soulbound ? 'SOULBOUND (SBT)' : 'VERIFIED ERC-721'}</span>
              <strong>Chứng nhận #${c.id}</strong>
            </div>
            <h3>${escapeHtml(c.company)}</h3>
            <p class="amount">${c.amountKg.toLocaleString('en-US', {maximumFractionDigits: 3})} kg CO₂</p>
            <p class="reason">${escapeHtml(c.reason)}</p>
            <div class="kv">
              <div><span>Chủ sở hữu:</span> <code>${escapeHtml(c.owner)}</code></div>
              <div><span>Thời gian đốt:</span> ${escapeHtml(retiredTime)}</div>
              ${c.txHash ? `<div><span>Tx Hash:</span> <code>${escapeHtml(c.txHash)}</code></div>` : ''}
              <div><span>Link xác minh:</span> <span>${escapeHtml(verifyUrl)}</span></div>
            </div>
          </div>
          <div class="qr-box">
            <img src="${qr}" alt="QR #${c.id}" />
            <small>Quét để xác minh</small>
          </div>
        </div>
      `;
    })
    .join('');

  const html = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)} - AvaxGreen</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; color: #16241a; margin: 28px; line-height: 1.5; }
    .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #2b4e33; padding-bottom: 14px; margin-bottom: 22px; }
    .brand { font-size: 22px; font-weight: 700; color: #1f4b28; }
    .sub { font-size: 12px; color: #4d6452; margin-top: 4px; }
    .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
    .stat { border: 1px solid #cdd8cf; border-radius: 8px; padding: 12px 14px; background: #f6faf6; }
    .stat small { display: block; font-size: 11px; color: #546b58; text-transform: uppercase; }
    .stat strong { font-size: 20px; color: #183a1f; }
    .cert-card { display: flex; justify-content: space-between; gap: 18px; border: 1px solid #c5d3c7; border-radius: 10px; padding: 16px; margin-bottom: 16px; page-break-inside: avoid; }
    .cert-meta { flex: 1; }
    .cert-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
    .badge { font-size: 10px; padding: 2px 7px; border-radius: 4px; background: #e1f3d8; color: #1e4b22; font-weight: 700; }
    h3 { margin: 4px 0; font-size: 17px; }
    .amount { font-size: 22px; font-weight: 700; color: #1f5c2d; margin: 4px 0 8px; }
    .reason { font-size: 13px; color: #344a38; margin: 0 0 10px; }
    .kv { font-size: 11px; color: #4a5e4e; }
    .kv div { margin: 2px 0; word-break: break-all; }
    code { font-family: monospace; font-size: 10px; background: #eef3ee; padding: 1px 4px; border-radius: 3px; }
    .qr-box { width: 110px; text-align: center; flex-shrink: 0; }
    .qr-box img { width: 104px; height: 104px; border: 1px solid #d2ded3; border-radius: 6px; }
    .qr-box small { display: block; font-size: 10px; color: #5a6d5e; margin-top: 4px; }
    .footer { margin-top: 26px; font-size: 11px; color: #5a6c5d; border-top: 1px solid #dbe4dc; padding-top: 10px; }
    @media print { body { margin: 14px; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">AvaxGreen · ${escapeHtml(title)}</div>
      <div class="sub">Mạng: ${escapeHtml(network)} · Contract CarbonRegistry: <code>${escapeHtml(registry)}</code></div>
    </div>
    <div class="sub">Ngày xuất: ${escapeHtml(new Date().toLocaleString('vi-VN'))}</div>
  </div>
  <div class="summary">
    <div class="stat"><small>Số chứng nhận ESG</small><strong>${certs.length} NFT</strong></div>
    <div class="stat"><small>Tổng CO₂ đã đốt vĩnh viễn</small><strong>${totalKg.toLocaleString('en-US', {maximumFractionDigits: 3})} kg CO₂</strong></div>
    <div class="stat"><small>Tương đương cây xanh / năm</small><strong>${Math.round(totalKg / 21)} cây</strong></div>
  </div>
  ${cardsHtml}
  <div class="footer">
    Chứng nhận được lưu trữ 100% On-Chain SVG trên blockchain Avalanche. Quét mã QR hoặc truy cập link xác minh để đối chiếu trực tiếp với Smart Contract.
  </div>
  <script>window.onload = () => setTimeout(() => window.print(), 250);</script>
</body>
</html>`;

  const w = window.open('', '_blank', 'width=920,height=740');
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
  }
}
