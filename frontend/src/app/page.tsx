'use client';

import {useCallback, useEffect, useMemo, useState} from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Award,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileCheck2,
  FileSpreadsheet,
  FlaskConical,
  Globe2,
  Info,
  LayoutDashboard,
  Leaf,
  LoaderCircle,
  Menu,
  Mountain,
  Plus,
  RefreshCw,
  ScanLine,
  ServerCog,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Sun,
  Tag,
  TreePine,
  Wallet,
  X,
} from 'lucide-react';
import type {Address} from 'viem';
import {AdminPanel} from '../components/AdminPanel';
import {CertificatesPanel} from '../components/CertificatesPanel';
import {MarketPanel} from '../components/MarketPanel';
import {Metric, OnChainChart, SolarScene} from '../components/OverviewCharts';
import {VerifyPanel} from '../components/VerifyPanel';
import {
  addressUrl,
  ensureFujiNetwork,
  getChainId,
  getExplorerBase,
  getNetworkLabel,
  getRegistryAddress,
  getRuntimeConfig,
  getTokenAddress,
  isContractDeployed,
  setRuntimeConfig,
  txUrl,
} from '../lib/contracts';
import {exportActivityCsv} from '../lib/exportReport';
import {
  fetchActiveListings,
  fetchCertificateById,
  fetchDashboardStats,
  fetchOnChainActivity,
  fetchRegisteredProjects,
  fetchUserCertificates,
  type DashboardStats,
  type OnChainActivityItem,
  type OnChainCertificate,
  type P2PListing,
  type RegisteredProject,
} from '../lib/onchain';
import {formatAvaxError} from '../lib/sanitize';
import {
  fmt,
  formatRelativeTime,
  getInjectedEthereum,
  shortAddr,
  type EvidenceDetailPayload,
  type SystemStatus,
  type Tab,
} from '../lib/types';

const EMPTY_STATS: DashboardStats = {
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

type ActivityFilter = 'all' | 'Minted' | 'Purchased' | 'Retired' | 'P2P' | 'Project';

export default function Home() {
  const [tab, setTab] = useState<Tab>('overview');
  const [mobile, setMobile] = useState(false);
  const [configVersion, setConfigVersion] = useState(0);

  // Wallet & network state
  const [wallet, setWallet] = useState<Address | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [modal, setModal] = useState(false);
  const [toast, setToast] = useState('');

  // On-chain state
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [activity, setActivity] = useState<OnChainActivityItem[]>([]);
  const [certs, setCerts] = useState<OnChainCertificate[]>([]);
  const [listings, setListings] = useState<P2PListing[]>([]);
  const [projects, setProjects] = useState<RegisteredProject[]>([]);
  const [publicCert, setPublicCert] = useState<OnChainCertificate | null>(null);
  const [syncingChain, setSyncingChain] = useState(false);
  const [sysStatus, setSysStatus] = useState<SystemStatus | null>(null);

  // Overview table filters & pagination
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [activitySearch, setActivitySearch] = useState('');
  const [activityPage, setActivityPage] = useState(1);

  // Modals & Evidence Vault
  const [selectedActivity, setSelectedActivity] = useState<OnChainActivityItem | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceDetail, setEvidenceDetail] = useState<EvidenceDetailPayload | null>(null);
  const [inspectedCert, setInspectedCert] = useState<OnChainCertificate | null>(null);

  // Trigger sample data load on Verify tab from top bar button
  const [sampleSignal, setSampleSignal] = useState(0);

  const activeChainId = getChainId();
  const networkLabel = getNetworkLabel(activeChainId);
  const explorerBase = getExplorerBase(activeChainId);
  const registryAddr = getRegistryAddress();
  const tokenAddr = getTokenAddress();
  const deployed = isContractDeployed();
  const wrongNetwork = Boolean(wallet && walletChainId !== null && walletChainId !== activeChainId);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 5500);
    return () => clearTimeout(t);
  }, [toast]);

  const refreshOnChainData = useCallback(
    async (targetWallet?: Address | null) => {
      const activeWallet = targetWallet === undefined ? wallet : targetWallet;
      if (!isContractDeployed()) return;
      setSyncingChain(true);
      try {
        const [nextStats, nextActivity, nextListings, nextProjects] = await Promise.all([
          fetchDashboardStats(activeWallet),
          fetchOnChainActivity(),
          fetchActiveListings(),
          fetchRegisteredProjects(),
        ]);
        setStats(nextStats);
        setActivity(nextActivity);
        setListings(nextListings);
        setProjects(nextProjects);
        if (activeWallet) {
          const nextCerts = await fetchUserCertificates(activeWallet, nextActivity);
          setCerts(nextCerts);
        } else {
          setCerts([]);
        }
      } catch (err) {
        console.error('Failed to sync on-chain state:', err);
      } finally {
        setSyncingChain(false);
      }
    },
    [wallet]
  );

  // Fetch server status once on mount and sync runtime contract addresses if server has them
  useEffect(() => {
    fetch('/api/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SystemStatus | null) => {
        if (!data) return;
        setSysStatus(data);
        if (data.isDeployed && data.registryAddress && data.tokenAddress) {
          const current = getRuntimeConfig();
          if (
            current.registry?.toLowerCase() !== data.registryAddress.toLowerCase() ||
            current.token?.toLowerCase() !== data.tokenAddress.toLowerCase()
          ) {
            setRuntimeConfig({
              chainId: data.chainId,
              network: data.network,
              token: data.tokenAddress,
              registry: data.registryAddress,
              oracleSigner: data.oracleAddress || data.contractOracleSigner,
              deployBlock: data.deployBlock,
            });
            setConfigVersion((v) => v + 1);
          }
        }
      })
      .catch(() => {});
  }, []);

  // Handle ?cert=<id> deep-link for Public Certificate Verifier
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const certParam = new URLSearchParams(window.location.search).get('cert');
    const certId = certParam ? Math.floor(Number(certParam)) : 0;
    if (Number.isInteger(certId) && certId > 0) {
      setTab('certificates');
      if (isContractDeployed()) {
        fetchCertificateById(certId, activity).then((found) => {
          if (found) setPublicCert(found);
        });
      }
    }
  }, [configVersion, activity.length]);

  // Sync on-chain state on mount, config changes, and wallet changes
  useEffect(() => {
    refreshOnChainData(wallet);
  }, [wallet, configVersion, refreshOnChainData]);

  // Listen to existing EVM wallet connection & account/chain events
  useEffect(() => {
    const eth = getInjectedEthereum();
    if (!eth) return;

    let cancelled = false;
    (async () => {
      try {
        const [accounts, chainHex] = (await Promise.all([
          eth.request({method: 'eth_accounts'}),
          eth.request({method: 'eth_chainId'}),
        ])) as [string[], string];
        if (cancelled) return;
        if (accounts?.[0]) {
          setWallet(accounts[0] as Address);
        }
        if (chainHex) {
          setWalletChainId(parseInt(chainHex, 16));
        }
      } catch {
        // Ignore silent probe failures
      }
    })();

    const onAccountsChanged = (accs: unknown) => {
      const list = Array.isArray(accs) ? (accs as string[]) : [];
      if (list[0]) {
        setWallet(list[0] as Address);
      } else {
        setWallet(null);
        setCerts([]);
      }
    };

    const onChainChanged = (chainHex: unknown) => {
      if (typeof chainHex === 'string') {
        setWalletChainId(parseInt(chainHex, 16));
      }
      refreshOnChainData();
    };

    eth.on?.('accountsChanged', onAccountsChanged);
    eth.on?.('chainChanged', onChainChanged);

    return () => {
      cancelled = true;
      eth.removeListener?.('accountsChanged', onAccountsChanged);
      eth.removeListener?.('chainChanged', onChainChanged);
    };
  }, [refreshOnChainData]);

  // Load Evidence Vault record when opening a Minted activity modal
  useEffect(() => {
    if (!selectedActivity || selectedActivity.type !== 'Minted' || !selectedActivity.proofHash) {
      setEvidenceDetail(null);
      setEvidenceLoading(false);
      return;
    }
    let cancelled = false;
    setEvidenceLoading(true);
    fetch(`/api/evidence?proofHash=${encodeURIComponent(selectedActivity.proofHash)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setEvidenceDetail(data);
      })
      .catch(() => {
        if (!cancelled) setEvidenceDetail(null);
      })
      .finally(() => {
        if (!cancelled) setEvidenceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedActivity]);

  function navigate(nextTab: Tab) {
    setTab(nextTab);
    setMobile(false);
  }

  async function connectWallet() {
    const eth = getInjectedEthereum();
    if (!eth) {
      setToast('Không tìm thấy ví trình duyệt (MetaMask / Core Wallet).');
      return;
    }
    try {
      const accounts = (await eth.request({method: 'eth_requestAccounts'})) as string[];
      if (!accounts?.[0]) {
        setToast('Không có tài khoản nào được chọn.');
        return;
      }
      const connected = accounts[0] as Address;
      setWallet(connected);
      const switchedId = await ensureFujiNetwork(eth);
      setWalletChainId(switchedId);
      setModal(false);
      setToast(`Đã kết nối ${shortAddr(connected)} trên ${getNetworkLabel(switchedId)}`);
    } catch (err) {
      setToast(formatAvaxError(err));
    }
  }

  async function switchNetwork() {
    const eth = getInjectedEthereum();
    if (!eth) return;
    try {
      const switchedId = await ensureFujiNetwork(eth);
      setWalletChainId(switchedId);
      setToast(`Đã chuyển sang mạng ${getNetworkLabel(switchedId)}`);
    } catch (err) {
      setToast(formatAvaxError(err));
    }
  }

  function disconnectWallet() {
    setWallet(null);
    setCerts([]);
    setModal(false);
    setToast('Đã ngắt kết nối ví trên giao diện.');
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

  function downloadJson(cert: OnChainCertificate) {
    const blob = new Blob([cert.rawJson], {type: 'application/json;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `AvaxGreen-ESG-${cert.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function copyText(value: string, label: string) {
    navigator.clipboard?.writeText(value);
    setToast(`Đã sao chép ${label}.`);
  }

  const retirementRatio = useMemo(() => {
    if (stats.totalMintedKg <= 0) return 0;
    return Math.min(100, Math.round((stats.totalRetiredKg / stats.totalMintedKg) * 1000) / 10);
  }, [stats.totalMintedKg, stats.totalRetiredKg]);

  const equivalentTrees = useMemo(() => Math.round(stats.totalRetiredKg / 21), [stats.totalRetiredKg]);

  const filteredActivity = useMemo(() => {
    const q = activitySearch.trim().toLowerCase();
    return activity.filter((item) => {
      if (activityFilter === 'P2P') {
        if (
          item.type !== 'ListingCreated' &&
          item.type !== 'ListingPurchased' &&
          item.type !== 'ListingCancelled'
        ) {
          return false;
        }
      } else if (activityFilter === 'Project') {
        if (item.type !== 'ProjectRegistered') return false;
      } else if (activityFilter !== 'all' && item.type !== activityFilter) {
        return false;
      }

      if (!q) return true;
      return (
        item.actor.toLowerCase().includes(q) ||
        item.txHash.toLowerCase().includes(q) ||
        item.detail.toLowerCase().includes(q) ||
        (item.proofHash && item.proofHash.toLowerCase().includes(q)) ||
        (item.certificateId !== undefined && `#${item.certificateId}`.includes(q))
      );
    });
  }, [activity, activityFilter, activitySearch]);

  const PAGE_SIZE = 10;
  const totalPages = Math.max(1, Math.ceil(filteredActivity.length / PAGE_SIZE));
  const currentPage = Math.min(activityPage, totalPages);
  const pagedActivity = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredActivity.slice(start, start + PAGE_SIZE);
  }, [filteredActivity, currentPage]);

  const nav = [
    {id: 'overview' as Tab, label: 'Tổng quan', icon: LayoutDashboard},
    {id: 'verify' as Tab, label: 'Xác minh & Mint', icon: ScanLine},
    {id: 'market' as Tab, label: 'Thị trường carbon', icon: ShoppingBag},
    {id: 'certificates' as Tab, label: 'Chứng nhận & Xác minh', icon: Award},
    {id: 'admin' as Tab, label: 'Quản trị & Deploy', icon: ServerCog},
  ];

  const activityBadgeLabel = (t: OnChainActivityItem['type']) => {
    if (t === 'Retired') return 'Đã retire';
    if (t === 'Purchased') return 'Mua Treasury';
    if (t === 'Minted') return 'Đã mint';
    if (t === 'ListingCreated') return 'Đăng bán P2P';
    if (t === 'ListingPurchased') return 'Mua P2P';
    if (t === 'ListingCancelled') return 'Hủy P2P';
    return 'Dự án mới';
  };

  return (
    <div className="app">
      <aside className={mobile ? 'sidebar open' : 'sidebar'}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate('overview');
          }}
        >
          <span className="brand-icon">
            <Leaf size={23} />
          </span>
          avax<span>green</span>
          <span className="brand-dot">®</span>
        </a>
        <div className="workspace-label">
          WORKSPACE <span>{activeChainId === 31337 ? 'LOCAL' : 'FUJI'}</span>
        </div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={tab === n.id ? 'nav-item active' : 'nav-item'}
              onClick={() => navigate(n.id)}
            >
              <n.icon size={19} />
              {n.label}
              {n.id === 'certificates' && certs.length > 0 && <b>{certs.length}</b>}
              {n.id === 'market' && listings.length > 0 && <b>{listings.length}</b>}
            </button>
          ))}
        </nav>

        <div className="sidebar-line" />
        <div className="ecosystem-label">HỆ SINH THÁI</div>
        <a
          className="nav-item"
          href={explorerBase || 'https://testnet.snowtrace.io'}
          target="_blank"
          rel="noreferrer"
        >
          <Mountain size={19} />
          Snowtrace Explorer
          <ExternalLink size={13} />
        </a>
        <button className="nav-item" onClick={() => setModal(true)}>
          <Globe2 size={19} />
          {networkLabel}
          <span className={wrongNetwork ? 'network-dot warn' : 'network-dot'} />
        </button>

        <div className="sidebar-bottom">
          <div className="hackathon-card">
            <span className="tiny-badge">
              <FlaskConical size={13} /> BUILT FOR UNIHACK
            </span>
            <h3>
              Small rooftops.
              <br />
              Bigger impact.
            </h3>
            <p>
              Năng lượng sạch Việt Nam,
              <br />
              xác thực AI & on-chain Avalanche.
            </p>
            <div className="hackathon-logos">
              <span className="avax-mark">▲</span> Avalanche <span>×</span> Team1
            </div>
          </div>
          <div className="sidebar-footer">
            <span className="avatar">AG</span>
            <div>
              AvaxGreen Protocol
              <small>{deployed ? 'On-chain RWA · Live' : 'Chưa deploy contract'}</small>
            </div>
            <ShieldCheck size={17} />
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header>
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Mở menu"
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={21} />
            </button>
            <span>{networkLabel}</span>
            <ChevronRight size={14} />
            <strong>{nav.find((n) => n.id === tab)?.label}</strong>
          </div>

          <div className="header-actions">
            {wrongNetwork ? (
              <button className="fuji-badge warn-pill" onClick={switchNetwork}>
                <span />
                Chuyển sang {networkLabel}
              </button>
            ) : (
              <span className="fuji-badge">
                <span />
                {networkLabel} ({activeChainId})
              </span>
            )}
            <button className="wallet-button" onClick={() => setModal(true)}>
              <Wallet size={16} />
              {wallet ? shortAddr(wallet) : 'Kết nối ví'}
            </button>
          </div>
        </header>

        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span /> AVALANCHE RWA CARBON PROTOCOL
              </div>
              <h1>
                {tab === 'overview'
                  ? 'Tác động xanh, được chứng thực.'
                  : tab === 'verify'
                    ? 'Năng lượng sạch. Giá trị thật.'
                    : tab === 'market'
                      ? 'Thị trường Carbon P2P & Treasury.'
                      : tab === 'certificates'
                        ? 'Chứng nhận ESG & Cổng Xác minh.'
                        : 'Quản trị & Triển khai Hợp đồng.'}
              </h1>
              <p>
                {tab === 'overview'
                  ? 'Số liệu thực tế đọc trực tiếp từ Smart Contract, lưu trữ lịch sử trọn vẹn.'
                  : tab === 'verify'
                    ? 'Kiểm định đa nguồn (AI Vision, Hóa đơn EVN, IoT) + NASA POWER + IPFS CIDv1.'
                    : tab === 'market'
                      ? 'Mua bán P2P giữa hộ điện mặt trời & doanh nghiệp, đốt tín chỉ nhận Soulbound NFT.'
                      : tab === 'certificates'
                        ? 'Chứng nhận SVG 100% on-chain (SBT), mã QR xác minh công khai & xuất báo cáo PDF.'
                        : '1-Click Deploy từ trình duyệt, nạp kho Treasury, rút AVAX & cấu hình Oracle.'}
              </p>
            </div>

            <button
              className="demo-switch"
              onClick={() => {
                navigate('verify');
                setSampleSignal((s) => s + 1);
              }}
            >
              <FlaskConical size={16} />
              Load Sample Solar Data
              <ChevronRight size={15} />
            </button>
          </div>

          {!deployed && tab !== 'admin' && (
            <div className="system-alert">
              <AlertTriangle size={20} />
              <div>
                <strong>Smart Contract chưa được triển khai</strong>
                <p>
                  File <code>frontend/src/contracts/addresses.json</code> hiện chưa có địa chỉ hợp
                  đồng. Bạn có thể vào tab{' '}
                  <button className="inline-link-btn" onClick={() => navigate('admin')}>
                    Quản trị & Deploy
                  </button>{' '}
                  để bấm <strong>1-Click Deploy</strong> ngay bằng MetaMask/Core Wallet hoặc chạy{' '}
                  <code>npm run deploy:fuji -w contracts</code>.
                </p>
              </div>
            </div>
          )}

          {tab === 'overview' && (
            <>
              <section className="hero">
                <div className="hero-content">
                  <div className="hero-tag">
                    <Sparkles size={13} /> GEMINI VISION · IOT · NASA POWER · AVALANCHE
                  </div>
                  <h2>
                    Từ mái nhà của bạn.
                    <br />
                    Đến tương lai <em>xanh hơn.</em>
                  </h2>
                  <p>
                    Mỗi kWh sạch đều được kiểm định đa lớp bằng AI, IoT & dữ liệu vệ tinh NASA.
                    <br />
                    Token hóa 1 GCARB = 1 kg CO₂ · Giao dịch P2P · Chứng nhận Soulbound NFT.
                  </p>
                  <div className="hero-actions">
                    <button className="primary" onClick={() => navigate('verify')}>
                      <Plus size={17} />
                      Xác minh & Mint GCARB
                    </button>
                    <button className="text-button" onClick={() => navigate('market')}>
                      Thị trường P2P & Retire <ChevronRight size={15} />
                    </button>
                  </div>
                  <div className="hero-trust">
                    <ShieldCheck size={14} /> Kiểm chứng từng giao dịch trên Snowtrace & Evidence Vault
                  </div>
                </div>
                <SolarScene />
                <div className="hero-float">
                  <span className="float-icon">
                    <Sun size={18} />
                  </span>
                  <div>
                    100% On-Chain RWA
                    <small>
                      <span /> Verified by Oracle ECDSA
                    </small>
                  </div>
                  <CheckCheck size={18} />
                </div>
                <div className="hero-coordinate">
                  10.8231° N · 106.6297° E <span>HO CHI MINH CITY</span>
                </div>
              </section>

              <div className="section-line">
                <h3>Tổng quan On-Chain ({networkLabel})</h3>
                <div className="chain-links-row">
                  {registryAddr && addressUrl(registryAddr) && (
                    <a
                      className="explorer-pill"
                      href={addressUrl(registryAddr)!}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Registry: {shortAddr(registryAddr)} <ExternalLink size={12} />
                    </a>
                  )}
                  {tokenAddr && addressUrl(tokenAddr) && (
                    <a
                      className="explorer-pill"
                      href={addressUrl(tokenAddr)!}
                      target="_blank"
                      rel="noreferrer"
                    >
                      GCARB: {shortAddr(tokenAddr)} <ExternalLink size={12} />
                    </a>
                  )}
                  <button
                    className="refresh-pill"
                    onClick={() => refreshOnChainData()}
                    disabled={syncingChain || !deployed}
                  >
                    <RefreshCw size={12} className={syncingChain ? 'spin' : ''} />
                    {syncingChain ? 'Đang đồng bộ…' : 'Làm mới chuỗi'}
                  </button>
                </div>
              </div>

              <div className="metrics">
                <Metric
                  label="CO₂ đã số hóa (On-chain)"
                  value={fmt(stats.totalMintedKg)}
                  unit="kg CO₂"
                  icon={Leaf}
                  note={deployed ? `${projects.length} dự án` : 'Chưa deploy'}
                  sub="Tổng GCARB đã phát hành"
                />
                <Metric
                  label="CO₂ đã bù đắp / đốt"
                  value={fmt(stats.totalRetiredKg)}
                  unit="kg CO₂"
                  icon={TreePine}
                  note={`${retirementRatio}%`}
                  sub="Tín chỉ đã đốt vĩnh viễn"
                />
                <Metric
                  label="Chứng nhận ESG NFT"
                  value={fmt(stats.totalCertificates, 0)}
                  unit="NFT"
                  icon={FileCheck2}
                  note={stats.defaultSoulbound ? 'Soulbound SBT' : 'ERC-721 / SBT'}
                  sub="SVG metadata 100% on-chain"
                />
                <Metric
                  label="Số dư GCARB của bạn"
                  value={wallet ? fmt(stats.userBalanceKg) : '—'}
                  unit="GCARB"
                  icon={Wallet}
                  note={wallet ? `${stats.userAvax.toFixed(3)} AVAX` : 'Chưa kết nối'}
                  sub={wallet ? shortAddr(wallet) : 'Kết nối ví để đọc số dư'}
                />
              </div>

              <div className="dashboard-grid">
                <section className="panel chart-panel">
                  <div className="panel-title">
                    <div>
                      <h3>Biến động Carbon On-Chain</h3>
                      <p>Tích lũy từ sự kiện CreditsMinted & CreditsRetired thực tế trên chuỗi</p>
                    </div>
                    <span className="period">
                      Kho: {fmt(stats.treasuryStockKg, 0)} · P2P: {fmt(stats.escrowedListingKg, 0)} GCARB
                    </span>
                  </div>
                  <div className="chart-legend">
                    <span>
                      <i />
                      Tổng số hóa ({fmt(stats.totalMintedKg)} kg)
                    </span>
                    <span>
                      <i />
                      Tổng đã retire ({fmt(stats.totalRetiredKg)} kg)
                    </span>
                    <strong>
                      {retirementRatio}% <small>tỷ lệ retire</small>
                    </strong>
                  </div>
                  <OnChainChart
                    activity={activity}
                    totalMinted={stats.totalMintedKg}
                    totalRetired={stats.totalRetiredKg}
                  />
                </section>

                <section className="panel impact-panel">
                  <div className="panel-title">
                    <h3>Tác động thực tế</h3>
                    <span className="soft-icon">
                      <Globe2 size={18} />
                    </span>
                  </div>
                  <div className="impact-ring">
                    <svg viewBox="0 0 180 180">
                      <circle cx="90" cy="90" r="72" fill="none" stroke="#23312c" strokeWidth="11" />
                      <circle
                        cx="90"
                        cy="90"
                        r="72"
                        fill="none"
                        stroke="#b4ed79"
                        strokeWidth="11"
                        strokeDasharray={`${Math.round((retirementRatio / 100) * 452)} 453`}
                        strokeLinecap="round"
                        transform="rotate(-90 90 90)"
                      />
                    </svg>
                    <div>
                      <TreePine size={24} />
                      <strong>{fmt(equivalentTrees, 0)}</strong>
                      <span>cây xanh tương đương</span>
                    </div>
                  </div>
                  <p className="impact-explainer">
                    Quy đổi từ {fmt(stats.totalRetiredKg)} kg CO₂ đã retire thật
                    <br />
                    (ước tính 21 kg CO₂ / cây / năm).
                  </p>
                  <div className="impact-bottom">
                    <span>Lô P2P đang mở: {listings.length}</span>
                    <span>
                      On-chain <Leaf size={13} />
                    </span>
                  </div>
                </section>
              </div>

              <section className="panel activity-panel">
                <div className="panel-title">
                  <div>
                    <h3>Dòng chảy tác động (Lịch sử On-Chain đầy đủ)</h3>
                    <p>
                      Quét toàn bộ từ Deploy Block · Bấm biểu tượng mũi tên trên giao dịch Mint để
                      mở Evidence Vault.
                    </p>
                  </div>
                  <div className="chain-links-row">
                    {filteredActivity.length > 0 && (
                      <button
                        className="refresh-pill"
                        onClick={() => exportActivityCsv(filteredActivity)}
                      >
                        <FileSpreadsheet size={12} /> Xuất CSV
                      </button>
                    )}
                    <button className="text-button small" onClick={() => navigate('certificates')}>
                      Xem chứng nhận
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>

                <div className="activity-toolbar">
                  <div className="filter-pills">
                    {(
                      [
                        ['all', 'Tất cả'],
                        ['Minted', 'Mint'],
                        ['Purchased', 'Mua Treasury'],
                        ['Retired', 'Retire NFT'],
                        ['P2P', 'Sàn P2P'],
                        ['Project', 'Dự án'],
                      ] as Array<[ActivityFilter, string]>
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        className={activityFilter === key ? 'active' : ''}
                        onClick={() => {
                          setActivityFilter(key);
                          setActivityPage(1);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <input
                    className="activity-search"
                    placeholder="Tìm ví 0x…, Tx Hash, Proof, #Cert…"
                    value={activitySearch}
                    onChange={(e) => {
                      setActivitySearch(e.target.value);
                      setActivityPage(1);
                    }}
                  />
                </div>

                {pagedActivity.length === 0 ? (
                  <div className="empty-table-note">
                    <Info size={17} />
                    <span>
                      {deployed
                        ? 'Không có giao dịch phù hợp bộ lọc hiện tại.'
                        : 'Chưa kết nối contract. Hãy deploy ở tab Quản trị để xem giao dịch on-chain.'}
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>ĐỊA CHỈ / CHI TIẾT</th>
                            <th>HOẠT ĐỘNG</th>
                            <th>KHỐI LƯỢNG</th>
                            <th>THỜI GIAN</th>
                            <th>KIỂM CHỨNG</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pagedActivity.map((r) => {
                            const explorerHref = txUrl(r.txHash);
                            return (
                              <tr key={r.id}>
                                <td>
                                  <div className="project-cell">
                                    <span
                                      className={
                                        r.type === 'Retired' ? 'project-icon retired' : 'project-icon'
                                      }
                                    >
                                      {r.type === 'Retired' ? (
                                        <TreePine size={17} />
                                      ) : r.type === 'Purchased' || r.type === 'ListingPurchased' ? (
                                        <ShoppingBag size={17} />
                                      ) : r.type === 'ListingCreated' || r.type === 'ListingCancelled' ? (
                                        <Tag size={17} />
                                      ) : (
                                        <Sun size={17} />
                                      )}
                                    </span>
                                    <div>
                                      {shortAddr(r.actor)}
                                      <small>{r.detail}</small>
                                    </div>
                                  </div>
                                </td>
                                <td>
                                  <span className={r.type === 'Retired' ? 'status retired' : 'status'}>
                                    <span />
                                    {activityBadgeLabel(r.type)}
                                  </span>
                                </td>
                                <td className="numeric">
                                  {fmt(r.amountKg)}{' '}
                                  <span>{r.type === 'ProjectRegistered' ? 'kWp' : 'kg CO₂'}</span>
                                </td>
                                <td className="muted">{formatRelativeTime(r.timestamp)}</td>
                                <td>
                                  <div className="tx-actions">
                                    {explorerHref ? (
                                      <a
                                        className="snowtrace-link"
                                        href={explorerHref}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        {r.txHash.slice(0, 8)}… <ExternalLink size={12} />
                                      </a>
                                    ) : (
                                      <span className="muted">{r.txHash.slice(0, 10)}…</span>
                                    )}
                                    <button
                                      className="icon-button"
                                      aria-label="Chi tiết & Evidence Vault"
                                      onClick={() => setSelectedActivity(r)}
                                    >
                                      <ArrowUpRight size={16} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="pagination-bar">
                      <span>
                        Hiển thị {(currentPage - 1) * PAGE_SIZE + 1}–
                        {Math.min(currentPage * PAGE_SIZE, filteredActivity.length)} /{' '}
                        {filteredActivity.length} giao dịch
                      </span>
                      <div className="pagination-btns">
                        <button
                          className="refresh-pill"
                          disabled={currentPage <= 1}
                          onClick={() => setActivityPage((p) => Math.max(1, p - 1))}
                        >
                          <ChevronLeft size={13} /> Trước
                        </button>
                        <span>
                          Trang {currentPage}/{totalPages}
                        </span>
                        <button
                          className="refresh-pill"
                          disabled={currentPage >= totalPages}
                          onClick={() => setActivityPage((p) => Math.min(totalPages, p + 1))}
                        >
                          Sau <ChevronRight size={13} />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </section>
            </>
          )}

          {tab === 'verify' && (
            <VerifyPanel
              wallet={wallet}
              sysStatus={sysStatus}
              registeredProjects={projects}
              onOpenWalletModal={() => setModal(true)}
              onSetWalletChainId={setWalletChainId}
              onToast={setToast}
              onRefreshOnChain={refreshOnChainData}
              onNavigateMarket={() => navigate('market')}
              sampleSignal={sampleSignal}
            />
          )}

          {tab === 'market' && (
            <MarketPanel
              wallet={wallet}
              stats={stats}
              listings={listings}
              onOpenWalletModal={() => setModal(true)}
              onSetWalletChainId={setWalletChainId}
              onToast={setToast}
              onRefreshOnChain={refreshOnChainData}
              onNavigateCertificates={() => navigate('certificates')}
            />
          )}

          {tab === 'certificates' && (
            <CertificatesPanel
              wallet={wallet}
              certs={certs}
              activity={activity}
              publicCert={publicCert}
              onSetPublicCert={setPublicCert}
              onInspectCert={setInspectedCert}
              onOpenWalletModal={() => setModal(true)}
              onSetWalletChainId={setWalletChainId}
              onToast={setToast}
              onRefreshOnChain={refreshOnChainData}
              onNavigateMarket={() => navigate('market')}
            />
          )}

          {tab === 'admin' && (
            <AdminPanel
              wallet={wallet}
              walletChainId={walletChainId}
              stats={stats}
              sysStatus={sysStatus}
              onOpenWalletModal={() => setModal(true)}
              onSetWalletChainId={setWalletChainId}
              onToast={setToast}
              onRefreshOnChain={refreshOnChainData}
              onConfigChanged={() => setConfigVersion((v) => v + 1)}
            />
          )}

          <footer>
            <div>
              <span className="avax-mark">▲</span>Built on <strong>Avalanche</strong>
              <span className="footer-divider" />
              AI-Verified RWA Carbon Credits & On-Chain ESG Certificates.
            </div>
            <span>
              {networkLabel} <span className="footer-dot">·</span> UniHack 2026
            </span>
          </footer>
        </main>
      </div>

      {toast && (
        <div className="toast" role="status">
          <CheckCheck size={19} />
          <span>{toast}</span>
          <button className="icon-button" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}

      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(false)}>
          <section
            className="modal panel"
            role="dialog"
            aria-modal="true"
            aria-label="Quản lý ví EVM"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="modal-close icon-button" onClick={() => setModal(false)}>
              <X size={21} />
            </button>
            <div className="brand-icon">
              <Wallet size={26} />
            </div>
            <h2>{wallet ? `Ví ${networkLabel} của bạn` : 'Kết nối ví Web3'}</h2>
            <p>
              {wallet
                ? 'Ví đang sẵn sàng ký giao dịch Mint, Mua/Bán P2P, Retire ESG NFT và Deploy.'
                : 'Kết nối MetaMask hoặc Core Wallet. Hệ thống tự động chuyển sang mạng phù hợp.'}
            </p>

            {wallet ? (
              <>
                <div className="wallet-info-box">
                  <div className="evidence-row">
                    <span>Địa chỉ ví</span>
                    <strong className="mono">
                      {shortAddr(wallet)}
                      <button
                        className="icon-button inline-copy"
                        onClick={() => copyText(wallet, 'địa chỉ ví')}
                      >
                        <Copy size={13} />
                      </button>
                    </strong>
                  </div>
                  <div className="evidence-row">
                    <span>Mạng lưới</span>
                    <strong>
                      {walletChainId === activeChainId
                        ? `${networkLabel} (${activeChainId})`
                        : `Sai mạng (${walletChainId ?? '?'})`}
                    </strong>
                  </div>
                  <div className="evidence-row">
                    <span>Số dư test AVAX</span>
                    <strong>{stats.userAvax.toFixed(4)} AVAX</strong>
                  </div>
                  <div className="evidence-row">
                    <span>Số dư GCARB</span>
                    <strong>{fmt(stats.userBalanceKg, 3)} GCARB</strong>
                  </div>
                </div>

                {wrongNetwork && (
                  <button className="primary full" onClick={switchNetwork}>
                    Chuyển sang {networkLabel} ({activeChainId})
                  </button>
                )}

                {addressUrl(wallet) && (
                  <a href={addressUrl(wallet)!} target="_blank" rel="noreferrer">
                    Xem ví trên Snowtrace <ExternalLink size={14} />
                  </a>
                )}

                <button className="secondary full" onClick={disconnectWallet}>
                  Ngắt kết nối
                </button>
              </>
            ) : (
              <button className="primary full" onClick={connectWallet}>
                <Wallet size={18} />
                Kết nối MetaMask / Core Wallet
              </button>
            )}

            <a
              href="https://core.app/tools/testnet-faucet/?subnet=c&token=c"
              target="_blank"
              rel="noreferrer"
            >
              Nhận test AVAX miễn phí (Fuji Faucet) <ExternalLink size={14} />
            </a>
          </section>
        </div>
      )}

      {selectedActivity && (
        <div className="modal-backdrop" onClick={() => setSelectedActivity(null)}>
          <section
            className="panel modal modal-wide"
            role="dialog"
            aria-modal="true"
            aria-label="Chi tiết giao dịch & Evidence Vault"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              onClick={() => setSelectedActivity(null)}
            >
              <X size={20} />
            </button>
            <ShieldCheck size={34} className="lime" />
            <h2>Chi tiết giao dịch On-Chain</h2>
            <p>{selectedActivity.detail}</p>
            <div className="evidence-row">
              <span>Loại giao dịch</span>
              <strong>{activityBadgeLabel(selectedActivity.type)}</strong>
            </div>
            <div className="evidence-row">
              <span>Địa chỉ thực hiện</span>
              <strong className="mono">{selectedActivity.actor}</strong>
            </div>
            <div className="evidence-row">
              <span>Khối lượng</span>
              <strong>
                {fmt(selectedActivity.amountKg, 3)}{' '}
                {selectedActivity.type === 'ProjectRegistered' ? 'kWp' : 'kg CO₂'}
              </strong>
            </div>
            <div className="evidence-row">
              <span>Block</span>
              <strong>#{selectedActivity.blockNumber.toString()}</strong>
            </div>
            <div className="evidence-row">
              <span>Tx Hash</span>
              <strong className="mono">{shortAddr(selectedActivity.txHash)}</strong>
            </div>

            {selectedActivity.type === 'Minted' && selectedActivity.proofHash && (
              <div className="evidence-vault-box">
                <h4>Kho Bằng chứng Kiểm toán (Evidence Vault)</h4>
                {evidenceLoading ? (
                  <p className="muted">
                    <LoaderCircle size={13} className="spin" /> Đang tải hồ sơ bằng chứng…
                  </p>
                ) : evidenceDetail ? (
                  <>
                    {evidenceDetail.imageDataUrl && (
                      <img
                        className="vault-preview"
                        src={evidenceDetail.imageDataUrl}
                        alt="Ảnh bằng chứng gốc"
                      />
                    )}
                    <div className="evidence-row">
                      <span>IPFS Evidence CIDv1</span>
                      <strong className="mono">{shortAddr(evidenceDetail.record.evidenceCid)}</strong>
                    </div>
                    <div className="evidence-row">
                      <span>Nguồn · Dự án · Kỳ</span>
                      <strong>
                        {evidenceDetail.record.sourceMode} ·{' '}
                        {evidenceDetail.record.projectId || '—'} ·{' '}
                        {evidenceDetail.record.billingPeriod}
                      </strong>
                    </div>
                    <div className="evidence-row">
                      <span>AI Trust · Bức xạ NASA · EXIF GPS</span>
                      <strong>
                        {evidenceDetail.record.trustScore ?? '—'}/100 ·{' '}
                        {evidenceDetail.record.irradiance} kWh/m²/ngày ·{' '}
                        {evidenceDetail.record.exifGpsMatch}
                      </strong>
                    </div>
                    <p className="trust-summary" style={{marginTop: 8}}>
                      {evidenceDetail.record.summary}
                    </p>
                  </>
                ) : (
                  <p className="muted">
                    ProofHash: <span className="mono">{selectedActivity.proofHash}</span> (Hồ sơ ảnh
                    không lưu trên server cục bộ này, ví dụ giao dịch Treasury Seed hoặc máy khác).
                  </p>
                )}
              </div>
            )}

            {txUrl(selectedActivity.txHash) && (
              <a
                className="primary full"
                style={{marginTop: 16}}
                href={txUrl(selectedActivity.txHash)!}
                target="_blank"
                rel="noreferrer"
              >
                Kiểm chứng trên Snowtrace <ExternalLink size={16} />
              </a>
            )}
          </section>
        </div>
      )}

      {inspectedCert && (
        <div className="modal-backdrop" onClick={() => setInspectedCert(null)}>
          <section
            className="panel modal modal-wide"
            role="dialog"
            aria-modal="true"
            aria-label="On-Chain Metadata Inspector"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              onClick={() => setInspectedCert(null)}
            >
              <X size={20} />
            </button>
            <Code2 size={28} className="lime" />
            <h2>On-Chain Metadata Inspector · NFT #{inspectedCert.id}</h2>
            <p>
              Toàn bộ JSON và đồ họa SVG dưới đây được đọc trực tiếp từ hàm{' '}
              <code>tokenURI({inspectedCert.id})</code> trên Smart Contract CarbonRegistry (không
              dùng server ngoài hay IPFS).
            </p>

            <div className="inspector-block">
              <div className="inspector-head">
                <span>Decoded ERC-721 JSON</span>
                <button
                  className="icon-button"
                  onClick={() => copyText(inspectedCert.rawJson, 'JSON metadata')}
                >
                  <Copy size={14} />
                </button>
              </div>
              <pre>{JSON.stringify(JSON.parse(inspectedCert.rawJson), null, 2)}</pre>
            </div>

            <div className="inspector-block">
              <div className="inspector-head">
                <span>Decoded On-Chain SVG Markup</span>
                <button
                  className="icon-button"
                  onClick={() => copyText(inspectedCert.svgMarkup, 'mã SVG')}
                >
                  <Copy size={14} />
                </button>
              </div>
              <pre>{inspectedCert.svgMarkup}</pre>
            </div>

            <div className="inspector-actions">
              <button className="secondary" onClick={() => downloadJson(inspectedCert)}>
                <Download size={15} /> Tải JSON
              </button>
              <button className="primary" onClick={() => downloadSvg(inspectedCert)}>
                <Download size={15} /> Tải SVG
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
