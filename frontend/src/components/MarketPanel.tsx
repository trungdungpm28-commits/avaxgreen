'use client';

import {useMemo, useState} from 'react';
import {
  Award,
  CheckCheck,
  ExternalLink,
  Info,
  Leaf,
  LoaderCircle,
  Lock,
  Send,
  ShieldCheck,
  ShoppingBag,
  Tag,
  TreePine,
  Wallet,
  X,
} from 'lucide-react';
import {isAddress, parseEther, type Address, type Hex} from 'viem';
import {
  REGISTRY_ABI,
  TOKEN_ABI,
  ensureFujiNetwork,
  getNetworkLabel,
  getPublicClient,
  getRegistryAddress,
  getTokenAddress,
  getWalletClient,
  isContractDeployed,
  txUrl,
} from '../lib/contracts';
import type {DashboardStats, P2PListing} from '../lib/onchain';
import {formatAvaxError, sanitizeOnChainText, validateOnChainText} from '../lib/sanitize';
import {fmt, getInjectedEthereum, shortAddr} from '../lib/types';

interface MarketPanelProps {
  wallet: Address | null;
  stats: DashboardStats;
  listings: P2PListing[];
  onOpenWalletModal: () => void;
  onSetWalletChainId: (chainId: number) => void;
  onToast: (msg: string) => void;
  onRefreshOnChain: (wallet?: Address | null) => Promise<void>;
  onNavigateCertificates: () => void;
}

export function MarketPanel({
  wallet,
  stats,
  listings,
  onOpenWalletModal,
  onSetWalletChainId,
  onToast,
  onRefreshOnChain,
  onNavigateCertificates,
}: MarketPanelProps) {
  const [busy, setBusy] = useState('');

  // Buy from Treasury
  const [buy, setBuy] = useState(10);
  const [buyTxHash, setBuyTxHash] = useState<Hex | null>(null);

  // P2P Create Listing
  const [sellAmount, setSellAmount] = useState(25);
  const [sellPriceAvax, setSellPriceAvax] = useState('0.0001');
  const [sellProjectInfo, setSellProjectInfo] = useState('Điện mặt trời áp mái Thủ Đức · Đã kiểm định AI');
  const [p2pQuantities, setP2pQuantities] = useState<Record<number, number>>({});

  // Direct ERC-20 transfer
  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState(5);

  // Retire & NFT
  const [company, setCompany] = useState('');
  const [amount, setAmount] = useState(10);
  const [reason, setReason] = useState('Bù đắp khí thải xuất khẩu quý 4/2026');
  const [retireSoulbound, setRetireSoulbound] = useState(true);
  const [retireStep, setRetireStep] = useState<'idle' | 'approving' | 'retiring' | 'done'>('idle');
  const [approveTxHash, setApproveTxHash] = useState<Hex | null>(null);
  const [retireTxHash, setRetireTxHash] = useState<Hex | null>(null);

  const estimatedAvaxCost = useMemo(() => {
    const n = Math.floor(Number(buy));
    if (!Number.isFinite(n) || n <= 0) return '0.0000';
    return (n * stats.creditPriceAvax).toFixed(4);
  }, [buy, stats.creditPriceAvax]);

  const effectiveSoulbound = stats.defaultSoulbound || retireSoulbound;

  async function purchaseFromTreasury() {
    const registryAddress = getRegistryAddress();
    if (!isContractDeployed() || !registryAddress) {
      return onToast('Smart Contract chưa được deploy.');
    }
    if (!wallet) {
      onOpenWalletModal();
      return onToast('Vui lòng kết nối ví để mua GCARB bằng test AVAX.');
    }
    const wholeTokens = Math.floor(Number(buy));
    if (!Number.isFinite(wholeTokens) || wholeTokens < 1 || wholeTokens > 100000 || wholeTokens !== Number(buy)) {
      return onToast('Vui lòng nhập số lượng GCARB nguyên dương (1 - 100,000).');
    }
    if (wholeTokens > stats.treasuryStockKg) {
      return onToast(`Kho Treasury chỉ còn ${fmt(stats.treasuryStockKg)} GCARB.`);
    }

    const eth = getInjectedEthereum();
    if (!eth) return;

    setBusy('buy');
    setBuyTxHash(null);
    try {
      const switchedId = await ensureFujiNetwork(eth);
      onSetWalletChainId(switchedId);
      const walletClient = getWalletClient(eth, wallet, switchedId);
      const client = getPublicClient(switchedId);

      const costWei = BigInt(wholeTokens) * stats.creditPriceWei;
      const hash = await walletClient.writeContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'buyCredits',
        value: costWei,
        account: wallet,
      });

      onToast(`Đang xác nhận giao dịch mua từ Treasury trên ${getNetworkLabel()}…`);
      await client.waitForTransactionReceipt({hash});
      setBuyTxHash(hash);
      onToast(`Đã mua thành công ${fmt(wholeTokens, 0)} GCARB từ Treasury!`);
      await onRefreshOnChain(wallet);
    } catch (err) {
      onToast(formatAvaxError(err));
    } finally {
      setBusy('');
    }
  }

  async function createP2PListing() {
    const registryAddress = getRegistryAddress();
    const tokenAddress = getTokenAddress();
    if (!isContractDeployed() || !registryAddress || !tokenAddress) {
      return onToast('Smart Contract chưa được deploy.');
    }
    if (!wallet) {
      onOpenWalletModal();
      return onToast('Vui lòng kết nối ví để đăng bán GCARB.');
    }
    const infoErr = validateOnChainText(sellProjectInfo, 120, 'Thông tin dự án');
    if (infoErr) return onToast(infoErr);
    if (!Number.isFinite(sellAmount) || sellAmount <= 0) {
      return onToast('Số lượng GCARB đăng bán phải lớn hơn 0.');
    }
    const priceNum = Number(sellPriceAvax);
    if (!Number.isFinite(priceNum) || priceNum < 0.000001) {
      return onToast('Đơn giá tối thiểu 0.000001 AVAX / GCARB.');
    }

    const amountStr = (Math.floor(sellAmount * 1000) / 1000).toFixed(3);
    const amountWei = parseEther(amountStr);
    if (amountWei <= 0n || amountWei > stats.userBalanceWei) {
      return onToast(`Số dư GCARB trong ví (${fmt(stats.userBalanceKg, 3)}) không đủ.`);
    }
    const priceStr = (Math.round(priceNum * 1_000_000) / 1_000_000).toFixed(6);
    const pricePerKgWei = parseEther(priceStr);

    const eth = getInjectedEthereum();
    if (!eth) return;

    setBusy('create-listing');
    try {
      const switchedId = await ensureFujiNetwork(eth);
      onSetWalletChainId(switchedId);
      const walletClient = getWalletClient(eth, wallet, switchedId);
      const client = getPublicClient(switchedId);

      if (stats.userAllowanceWei < amountWei) {
        onToast('Bước 1/2: Cấp quyền (Approve) GCARB để ký quỹ lên sàn P2P…');
        const appHash = await walletClient.writeContract({
          address: tokenAddress,
          abi: TOKEN_ABI,
          functionName: 'approve',
          args: [registryAddress, amountWei],
          account: wallet,
        });
        await client.waitForTransactionReceipt({hash: appHash});
      }

      onToast('Bước 2/2: Đăng bán lô tín chỉ P2P lên Smart Contract…');
      const cleanInfo = sanitizeOnChainText(sellProjectInfo, 120);
      const hash = await walletClient.writeContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'createListing',
        args: [amountWei, pricePerKgWei, cleanInfo],
        account: wallet,
      });
      await client.waitForTransactionReceipt({hash});
      onToast(`Đã niêm yết bán ${amountStr} GCARB với giá ${priceStr} AVAX/GCARB!`);
      await onRefreshOnChain(wallet);
    } catch (err) {
      onToast(formatAvaxError(err));
    } finally {
      setBusy('');
    }
  }

  async function buyP2PListing(listing: P2PListing) {
    const registryAddress = getRegistryAddress();
    if (!isContractDeployed() || !registryAddress) return;
    if (!wallet) {
      onOpenWalletModal();
      return onToast('Kết nối ví để mua tín chỉ P2P.');
    }

    const desiredQty = p2pQuantities[listing.id] ?? Math.min(10, listing.remainingKg);
    const qtyStr = (Math.floor(desiredQty * 1000) / 1000).toFixed(3);
    const amountWei = parseEther(qtyStr);
    if (amountWei <= 0n || amountWei > listing.remainingWei) {
      return onToast(`Số lượng mua phải từ 0.001 đến ${fmt(listing.remainingKg, 3)} GCARB.`);
    }

    const numerator = amountWei * listing.pricePerKgWei;
    if (numerator % 10n ** 18n !== 0n) {
      return onToast('Vui lòng chọn số lượng tròn đến 0.001 GCARB và đơn giá tròn 6 số thập phân.');
    }
    const costWei = numerator / 10n ** 18n;
    if (costWei <= 0n) return onToast('Giá trị giao dịch quá nhỏ.');

    const eth = getInjectedEthereum();
    if (!eth) return;

    setBusy(`buy-p2p-${listing.id}`);
    try {
      const switchedId = await ensureFujiNetwork(eth);
      onSetWalletChainId(switchedId);
      const walletClient = getWalletClient(eth, wallet, switchedId);
      const client = getPublicClient(switchedId);

      const hash = await walletClient.writeContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'buyFromListing',
        args: [BigInt(listing.id), amountWei],
        value: costWei,
        account: wallet,
      });
      onToast('Đang thanh toán trực tiếp cho hộ gia đình phát hành…');
      await client.waitForTransactionReceipt({hash});
      onToast(`Đã mua ${qtyStr} GCARB trực tiếp từ lô P2P #${listing.id}!`);
      await onRefreshOnChain(wallet);
    } catch (err) {
      onToast(formatAvaxError(err));
    } finally {
      setBusy('');
    }
  }

  async function cancelP2PListing(listingId: number) {
    const registryAddress = getRegistryAddress();
    if (!isContractDeployed() || !registryAddress || !wallet) return;
    const eth = getInjectedEthereum();
    if (!eth) return;

    setBusy(`cancel-p2p-${listingId}`);
    try {
      const switchedId = await ensureFujiNetwork(eth);
      onSetWalletChainId(switchedId);
      const walletClient = getWalletClient(eth, wallet, switchedId);
      const client = getPublicClient(switchedId);

      const hash = await walletClient.writeContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'cancelListing',
        args: [BigInt(listingId)],
        account: wallet,
      });
      onToast('Đang hoàn trả GCARB về ví của bạn…');
      await client.waitForTransactionReceipt({hash});
      onToast(`Đã hủy niêm yết P2P #${listingId} và hoàn token về ví.`);
      await onRefreshOnChain(wallet);
    } catch (err) {
      onToast(formatAvaxError(err));
    } finally {
      setBusy('');
    }
  }

  async function transferDirectGcarb() {
    const tokenAddress = getTokenAddress();
    if (!isContractDeployed() || !tokenAddress) return onToast('Contract chưa deploy.');
    if (!wallet) {
      onOpenWalletModal();
      return onToast('Kết nối ví để chuyển GCARB.');
    }
    if (!isAddress(transferTo.trim())) {
      return onToast('Địa chỉ ví nhận không hợp lệ.');
    }
    if (!Number.isFinite(transferAmount) || transferAmount <= 0) {
      return onToast('Số lượng chuyển phải lớn hơn 0.');
    }
    const amtStr = (Math.floor(transferAmount * 1000) / 1000).toFixed(3);
    const amtWei = parseEther(amtStr);
    if (amtWei <= 0n || amtWei > stats.userBalanceWei) {
      return onToast('Số dư GCARB trong ví không đủ.');
    }
    const eth = getInjectedEthereum();
    if (!eth) return;

    setBusy('transfer');
    try {
      const switchedId = await ensureFujiNetwork(eth);
      onSetWalletChainId(switchedId);
      const walletClient = getWalletClient(eth, wallet, switchedId);
      const client = getPublicClient(switchedId);

      const hash = await walletClient.writeContract({
        address: tokenAddress,
        abi: TOKEN_ABI,
        functionName: 'transfer',
        args: [transferTo.trim() as Address, amtWei],
        account: wallet,
      });
      onToast('Đang chuyển token GCARB…');
      await client.waitForTransactionReceipt({hash});
      onToast(`Đã chuyển ${amtStr} GCARB tới ${shortAddr(transferTo.trim())}.`);
      setTransferTo('');
      await onRefreshOnChain(wallet);
    } catch (err) {
      onToast(formatAvaxError(err));
    } finally {
      setBusy('');
    }
  }

  async function retireOnChain() {
    const registryAddress = getRegistryAddress();
    const tokenAddress = getTokenAddress();
    if (!isContractDeployed() || !registryAddress || !tokenAddress) {
      return onToast('Smart Contract chưa được deploy.');
    }
    if (!wallet) {
      onOpenWalletModal();
      return onToast('Vui lòng kết nối ví doanh nghiệp để thực hiện Retire.');
    }

    const cleanCompany = sanitizeOnChainText(company, 120);
    const cleanReason = sanitizeOnChainText(reason, 256);

    const companyErr = validateOnChainText(company, 120, 'Tên doanh nghiệp');
    if (companyErr) return onToast(companyErr);
    const reasonErr = validateOnChainText(reason, 256, 'Lý do bù đắp carbon');
    if (reasonErr) return onToast(reasonErr);

    if (!Number.isFinite(amount) || amount <= 0) {
      return onToast('Số lượng kg CO₂ cần retire phải lớn hơn 0.');
    }

    const amountStr = (Math.floor(amount * 1000) / 1000).toFixed(3);
    const amountWei = parseEther(amountStr);
    if (amountWei <= 0n || amountWei > stats.userBalanceWei) {
      return onToast(`Số dư GCARB trong ví (${fmt(stats.userBalanceKg, 3)}) không đủ.`);
    }

    const eth = getInjectedEthereum();
    if (!eth) return;

    setBusy('retire');
    setApproveTxHash(null);
    setRetireTxHash(null);

    try {
      const switchedId = await ensureFujiNetwork(eth);
      onSetWalletChainId(switchedId);
      const walletClient = getWalletClient(eth, wallet, switchedId);
      const client = getPublicClient(switchedId);

      if (stats.userAllowanceWei < amountWei) {
        setRetireStep('approving');
        onToast('Bước 1/2: Cấp quyền (Approve) GCARB cho CarbonRegistry…');
        const appHash = await walletClient.writeContract({
          address: tokenAddress,
          abi: TOKEN_ABI,
          functionName: 'approve',
          args: [registryAddress, amountWei],
          account: wallet,
        });
        await client.waitForTransactionReceipt({hash: appHash});
        setApproveTxHash(appHash);
      }

      setRetireStep('retiring');
      onToast('Bước 2/2: Đốt GCARB vĩnh viễn & Đúc chứng nhận ESG NFT…');
      const retHash = await walletClient.writeContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'retireCreditsWithOptions',
        args: [amountWei, cleanCompany, cleanReason, effectiveSoulbound],
        account: wallet,
      });
      await client.waitForTransactionReceipt({hash: retHash});
      setRetireTxHash(retHash);
      setRetireStep('done');
      onToast('Đã đốt tín chỉ & cấp Chứng nhận ESG NFT on-chain!');
      await onRefreshOnChain(wallet);
      onNavigateCertificates();
    } catch (err) {
      setRetireStep('idle');
      onToast(formatAvaxError(err));
    } finally {
      setBusy('');
    }
  }

  const companyBytes = new TextEncoder().encode(company.replace(/[\r\n\t]+/g, ' ').trim()).length;
  const reasonBytes = new TextEncoder().encode(reason.replace(/[\r\n\t]+/g, ' ').trim()).length;

  return (
    <>
      <div className="market-intro">
        <span>
          <ShoppingBag size={18} /> AVALANCHE CARBON MARKETPLACE · TREASURY & P2P
        </span>
        <h2>
          Giao dịch tín chỉ minh bạch.
          <br />
          Từ mái nhà đến doanh nghiệp.
        </h2>
        <p>
          Mua GCARB trực tiếp từ hộ gia đình trên sàn P2P hoặc từ kho Treasury, chuyển nhượng và
          đốt vĩnh viễn để nhận Chứng nhận ESG NFT Soulbound.
        </p>
        <div className="market-balance-group">
          <div className="market-balance">
            <Wallet size={20} />
            <div>
              Số dư ví của bạn
              <strong>
                {wallet ? fmt(stats.userBalanceKg, 3) : '—'} <span>GCARB</span>
              </strong>
              <small>{wallet ? `${stats.userAvax.toFixed(4)} AVAX` : 'Chưa kết nối ví'}</small>
            </div>
          </div>
          <div className="market-balance">
            <ShieldCheck size={20} />
            <div>
              Kho Treasury · Ký quỹ P2P
              <strong>
                {fmt(stats.treasuryStockKg, 0)} <span>GCARB</span>
              </strong>
              <small>Đang rao bán P2P: {fmt(stats.escrowedListingKg, 1)} GCARB</small>
            </div>
          </div>
        </div>
      </div>

      <div className="verify-grid">
        <section className="panel form-panel">
          <div className="panel-title">
            <h3>Mua từ Kho Treasury</h3>
            <span className="status">
              <span />
              ON-CHAIN
            </span>
          </div>
          <div className="asset-card">
            <span className="brand-icon">
              <Leaf size={26} />
            </span>
            <div>
              Green Carbon Credit
              <small>GCARB (ERC-20) · 1 GCARB = 1 kg CO₂</small>
            </div>
            <ShieldCheck size={21} />
          </div>

          <label>
            Số lượng GCARB muốn mua (số nguyên)
            <input
              type="number"
              value={buy}
              min="1"
              step="1"
              max="100000"
              onChange={(e) => setBuy(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            />
          </label>

          <div className="quick-amounts">
            {[10, 50, 100, 250, 500].map((n) => (
              <button key={n} className={buy === n ? 'selected' : ''} onClick={() => setBuy(n)}>
                {n}
              </button>
            ))}
          </div>

          <div className="evidence-row">
            <span>Tỷ giá Smart Contract hiện tại</span>
            <strong>1 GCARB = {stats.creditPriceAvax.toFixed(4)} AVAX</strong>
          </div>
          <div className="evidence-row">
            <span>Tổng thanh toán</span>
            <strong>{estimatedAvaxCost} AVAX</strong>
          </div>

          <button
            className="primary full"
            onClick={purchaseFromTreasury}
            disabled={!!busy || !isContractDeployed() || stats.treasuryStockKg <= 0}
          >
            {busy === 'buy' ? (
              <LoaderCircle size={18} className="spin" />
            ) : (
              <ShoppingBag size={18} />
            )}
            {busy === 'buy' ? 'Đang mua trên chuỗi…' : `Mua ${buy} GCARB từ Treasury`}
          </button>

          {buyTxHash && (
            <div className="tx-success-box">
              <CheckCheck size={17} />
              <div>
                <strong>Đã mua GCARB thành công!</strong>
                {txUrl(buyTxHash) && (
                  <a href={txUrl(buyTxHash)!} target="_blank" rel="noreferrer">
                    Xem trên Snowtrace ({shortAddr(buyTxHash)}) <ExternalLink size={13} />
                  </a>
                )}
              </div>
            </div>
          )}

          <div className="sub-divider" />
          <div className="panel-title compact-title">
            <h3>Chuyển nhượng trực tiếp GCARB</h3>
            <Send size={17} />
          </div>
          <div className="transfer-row">
            <input
              placeholder="Địa chỉ ví nhận (0x...)"
              value={transferTo}
              onChange={(e) => setTransferTo(e.target.value)}
            />
            <input
              type="number"
              min="0.001"
              step="0.1"
              value={transferAmount}
              onChange={(e) => setTransferAmount(Number(e.target.value))}
            />
            <button
              className="secondary-btn"
              onClick={transferDirectGcarb}
              disabled={!!busy || !isContractDeployed()}
            >
              {busy === 'transfer' ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />}
              Gửi
            </button>
          </div>
        </section>

        <section className="panel form-panel">
          <div className="panel-title">
            <h3>Retire & Cấp chứng nhận ESG NFT</h3>
            <TreePine size={22} />
          </div>

          <label>
            Tên doanh nghiệp ({companyBytes}/120 bytes)
            <input
              placeholder="Ví dụ: Công ty Xuất khẩu Xanh Việt Nam"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </label>

          <label>
            Số lượng retire (kg CO₂)
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </label>

          <label>
            Lý do bù đắp carbon ({reasonBytes}/256 bytes)
            <textarea
              placeholder="Ví dụ: Bù đắp khí thải xuất khẩu quý 4/2026"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={effectiveSoulbound}
              disabled={stats.defaultSoulbound}
              onChange={(e) => setRetireSoulbound(e.target.checked)}
            />
            <Lock size={14} />
            <span>
              Khóa <strong>Soulbound (SBT)</strong> — Không thể chuyển nhượng/bán lại NFT sau khi
              retire {stats.defaultSoulbound ? '(Mặc định toàn hệ thống)' : ''}
            </span>
          </label>

          <div className="retire-stepper">
            <div
              className={
                retireStep === 'approving'
                  ? 'active'
                  : approveTxHash || retireStep === 'retiring' || retireStep === 'done'
                    ? 'done'
                    : ''
              }
            >
              <b>1</b>
              <span>Approve GCARB</span>
            </div>
            <div
              className={
                retireStep === 'retiring' ? 'active' : retireStep === 'done' ? 'done' : ''
              }
            >
              <b>2</b>
              <span>Burn & Mint ESG NFT</span>
            </div>
          </div>

          <div className="retire-note">
            <ShieldCheck size={19} />
            <p>
              Smart Contract sẽ đốt vĩnh viễn GCARB và đúc 1 ERC-721 NFT chứa ảnh SVG 100%
              on-chain (tự động co giãn chữ chống tràn khung).
            </p>
          </div>

          <button
            className="primary full"
            onClick={retireOnChain}
            disabled={!!busy || !isContractDeployed()}
          >
            {busy === 'retire' ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <Award size={18} />
            )}
            {retireStep === 'approving'
              ? 'Đang Approve GCARB (1/2)…'
              : retireStep === 'retiring'
                ? 'Đang Retire & Đúc NFT (2/2)…'
                : 'Retire & Cấp chứng nhận NFT'}
          </button>

          {retireTxHash && (
            <div className="tx-success-box">
              <CheckCheck size={17} />
              <div>
                <strong>Đã đốt GCARB & đúc chứng nhận NFT!</strong>
                {txUrl(retireTxHash) && (
                  <a href={txUrl(retireTxHash)!} target="_blank" rel="noreferrer">
                    Xem trên Snowtrace ({shortAddr(retireTxHash)}) <ExternalLink size={13} />
                  </a>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="panel activity-panel p2p-panel">
        <div className="panel-title">
          <div>
            <h3>Sàn Giao dịch P2P Trực tiếp (Hộ gia đình ↔ Doanh nghiệp)</h3>
            <p>
              Hộ điện mặt trời tự niêm yết bán GCARB với đơn giá mong muốn; AVAX thanh toán chạy
              thẳng vào ví người bán.
            </p>
          </div>
          <span className="period">{listings.length} lô đang mở bán</span>
        </div>

        <div className="p2p-create-box">
          <div className="p2p-form-grid">
            <label>
              Số lượng GCARB niêm yết
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={sellAmount}
                onChange={(e) => setSellAmount(Number(e.target.value))}
              />
            </label>
            <label>
              Đơn giá (AVAX / GCARB)
              <input
                type="number"
                min="0.000001"
                step="0.0001"
                value={sellPriceAvax}
                onChange={(e) => setSellPriceAvax(e.target.value)}
              />
            </label>
            <label>
              Mô tả dự án / Nguồn phát
              <input
                value={sellProjectInfo}
                onChange={(e) => setSellProjectInfo(e.target.value)}
                placeholder="Dự án điện mặt trời..."
              />
            </label>
            <button
              className="primary"
              onClick={createP2PListing}
              disabled={!!busy || !isContractDeployed()}
            >
              {busy === 'create-listing' ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Tag size={16} />
              )}
              Niêm yết bán P2P
            </button>
          </div>
        </div>

        {listings.length === 0 ? (
          <div className="empty-table-note">
            <Info size={17} />
            <span>Hiện chưa có lô P2P nào đang rao bán. Chủ điện mặt trời có thể tạo lệnh bán ở trên.</span>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>LÔ # / DỰ ÁN</th>
                  <th>NGƯỜI BÁN</th>
                  <th>CÒN LẠI</th>
                  <th>ĐƠN GIÁ</th>
                  <th>SỐ LƯỢNG MUA</th>
                  <th>THAO TÁC</th>
                </tr>
              </thead>
              <tbody>
                {listings.map((l) => {
                  const isSeller = wallet && l.seller.toLowerCase() === wallet.toLowerCase();
                  const qty = p2pQuantities[l.id] ?? Math.min(10, l.remainingKg);
                  const totalAvax = (qty * l.pricePerKgAvax).toFixed(5);
                  return (
                    <tr key={l.id}>
                      <td>
                        <strong>#{l.id}</strong> · {l.projectInfo}
                      </td>
                      <td className="mono">{shortAddr(l.seller)}</td>
                      <td className="numeric">{fmt(l.remainingKg, 3)} GCARB</td>
                      <td>{l.pricePerKgAvax.toFixed(6)} AVAX</td>
                      <td>
                        <input
                          className="mini-input"
                          type="number"
                          min="0.001"
                          max={l.remainingKg}
                          step="1"
                          value={qty}
                          onChange={(e) =>
                            setP2pQuantities((prev) => ({
                              ...prev,
                              [l.id]: Number(e.target.value),
                            }))
                          }
                        />
                      </td>
                      <td>
                        <div className="tx-actions">
                          <button
                            className="refresh-pill buy-pill"
                            disabled={!!busy}
                            onClick={() => buyP2PListing(l)}
                          >
                            {busy === `buy-p2p-${l.id}` ? (
                              <LoaderCircle size={12} className="spin" />
                            ) : (
                              <ShoppingBag size={12} />
                            )}
                            Mua ({totalAvax} AVAX)
                          </button>
                          {isSeller && (
                            <button
                              className="refresh-pill cancel-pill"
                              disabled={!!busy}
                              onClick={() => cancelP2PListing(l.id)}
                            >
                              {busy === `cancel-p2p-${l.id}` ? (
                                <LoaderCircle size={12} className="spin" />
                              ) : (
                                <X size={12} />
                              )}
                              Hủy bán
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
