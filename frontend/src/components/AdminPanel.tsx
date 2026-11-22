'use client';

import {useEffect, useState} from 'react';
import {
  Check,
  Coins,
  KeyRound,
  LoaderCircle,
  Lock,
  Rocket,
  ServerCog,
  ShieldAlert,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import {isAddress, parseEther, type Address} from 'viem';
import {
  CONTRACT_BYTECODES,
  REGISTRY_ABI,
  TOKEN_ABI,
  ensureFujiNetwork,
  getChainId,
  getNetworkLabel,
  getPublicClient,
  getRegistryAddress,
  getTokenAddress,
  getWalletClient,
  isContractDeployed,
  setRuntimeConfig,
} from '../lib/contracts';
import type {DashboardStats} from '../lib/onchain';
import {formatAvaxError} from '../lib/sanitize';
import {fmt, getInjectedEthereum, shortAddr, type SystemStatus} from '../lib/types';

interface AdminPanelProps {
  wallet: Address | null;
  walletChainId: number | null;
  stats: DashboardStats;
  sysStatus: SystemStatus | null;
  onOpenWalletModal: () => void;
  onSetWalletChainId: (chainId: number) => void;
  onToast: (msg: string) => void;
  onRefreshOnChain: (wallet?: Address | null) => Promise<void>;
  onConfigChanged: () => void;
}

export function AdminPanel({
  wallet,
  walletChainId,
  stats,
  sysStatus,
  onOpenWalletModal,
  onSetWalletChainId,
  onToast,
  onRefreshOnChain,
  onConfigChanged,
}: AdminPanelProps) {
  const [busy, setBusy] = useState('');
  const [deployStep, setDeployStep] = useState(0);

  // Deployer state
  const [deployOracle, setDeployOracle] = useState(sysStatus?.oracleAddress || '');
  const [targetChain, setTargetChain] = useState<number>(walletChainId || getChainId());

  // Owner action states
  const [seedAmount, setSeedAmount] = useState(10000);
  const [withdrawTo, setWithdrawTo] = useState(wallet || '');
  const [newOracleSigner, setNewOracleSigner] = useState('');
  const [newCreditPrice, setNewCreditPrice] = useState(stats.creditPriceAvax.toFixed(4));

  useEffect(() => {
    if (!deployOracle && sysStatus?.oracleAddress) {
      setDeployOracle(sysStatus.oracleAddress);
    }
  }, [sysStatus, deployOracle]);

  useEffect(() => {
    if (wallet && !withdrawTo) setWithdrawTo(wallet);
  }, [wallet, withdrawTo]);

  useEffect(() => {
    setNewCreditPrice(stats.creditPriceAvax.toFixed(4));
  }, [stats.creditPriceAvax]);

  const isOwner = Boolean(
    wallet && stats.contractOwner && wallet.toLowerCase() === stats.contractOwner.toLowerCase()
  );

  async function deployFromBrowser() {
    if (!wallet) {
      onOpenWalletModal();
      return onToast('Kết nối ví Admin (có AVAX/ETH gas) để triển khai Smart Contract.');
    }
    const oracleAddr = (deployOracle.trim() || wallet) as Address;
    if (!isAddress(oracleAddr)) {
      return onToast('Địa chỉ Oracle Signer không hợp lệ.');
    }
    const eth = getInjectedEthereum();
    if (!eth) return onToast('Không tìm thấy ví trình duyệt.');

    setBusy('deploy');
    setDeployStep(1);
    try {
      const switchedId = await ensureFujiNetwork(eth, targetChain);
      onSetWalletChainId(switchedId);
      const walletClient = getWalletClient(eth, wallet, switchedId);
      const client = getPublicClient(switchedId);

      // Step 1: Deploy GreenCarbonToken
      onToast('Bước 1/4: Đang deploy GreenCarbonToken (GCARB)…');
      const tokenTx = await walletClient.deployContract({
        abi: CONTRACT_BYTECODES.GreenCarbonToken.abi,
        bytecode: CONTRACT_BYTECODES.GreenCarbonToken.bytecode,
        args: [wallet],
        account: wallet,
      });
      const tokenReceipt = await client.waitForTransactionReceipt({hash: tokenTx});
      const tokenAddress = tokenReceipt.contractAddress;
      if (!tokenAddress) throw new Error('Không lấy được địa chỉ GreenCarbonToken.');

      // Step 2: Deploy CarbonRegistry
      setDeployStep(2);
      onToast('Bước 2/4: Đang deploy CarbonRegistry…');
      const registryTx = await walletClient.deployContract({
        abi: CONTRACT_BYTECODES.CarbonRegistry.abi,
        bytecode: CONTRACT_BYTECODES.CarbonRegistry.bytecode,
        args: [tokenAddress, oracleAddr, wallet],
        account: wallet,
      });
      const regReceipt = await client.waitForTransactionReceipt({hash: registryTx});
      const registryAddress = regReceipt.contractAddress;
      if (!registryAddress) throw new Error('Không lấy được địa chỉ CarbonRegistry.');
      const deployBlock = Number(regReceipt.blockNumber);

      // Step 3: Link token.setRegistry(registryAddress)
      setDeployStep(3);
      onToast('Bước 3/4: Đang liên kết quyền Mint cho CarbonRegistry…');
      const linkTx = await walletClient.writeContract({
        address: tokenAddress,
        abi: TOKEN_ABI,
        functionName: 'setRegistry',
        args: [registryAddress],
        account: wallet,
      });
      await client.waitForTransactionReceipt({hash: linkTx});

      // Step 4: Save to server addresses.json + local runtime config
      setDeployStep(4);
      const networkName = switchedId === 31337 ? 'localhost' : 'fuji';
      const saveRes = await fetch('/api/deploy-config', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          chainId: switchedId,
          network: networkName,
          token: tokenAddress,
          registry: registryAddress,
          oracleSigner: oracleAddr,
          deployBlock,
        }),
      });
      if (!saveRes.ok) {
        const err = await saveRes.json().catch(() => ({}));
        throw new Error(err.error || 'Lưu cấu hình thất bại.');
      }

      setRuntimeConfig({
        chainId: switchedId,
        network: networkName,
        token: tokenAddress,
        registry: registryAddress,
        oracleSigner: oracleAddr,
        deployBlock,
      });
      onConfigChanged();
      await onRefreshOnChain(wallet);
      onToast('Triển khai & cấu hình Smart Contract thành công! Ứng dụng đã Live.');
    } catch (err) {
      onToast(formatAvaxError(err));
    } finally {
      setBusy('');
    }
  }

  async function seedTreasuryOnChain() {
    const registryAddress = getRegistryAddress();
    if (!isContractDeployed() || !registryAddress) return onToast('Contract chưa deploy.');
    if (!wallet) {
      onOpenWalletModal();
      return onToast('Kết nối ví để gửi giao dịch nạp kho.');
    }
    const eth = getInjectedEthereum();
    if (!eth) return;

    setBusy('seed');
    try {
      const switchedId = await ensureFujiNetwork(eth);
      onSetWalletChainId(switchedId);
      const res = await fetch('/api/seed-treasury', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          amountGcarb: seedAmount,
          registryAddress,
          chainId: switchedId,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Không tạo được chữ ký Oracle nạp kho.');

      const walletClient = getWalletClient(eth, wallet, switchedId);
      const client = getPublicClient(switchedId);
      const hash = await walletClient.writeContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'fundTreasury',
        args: [BigInt(payload.amountWei), payload.proofHash, payload.signature],
        account: wallet,
      });
      onToast('Đang xác nhận nạp GCARB vào kho Treasury…');
      await client.waitForTransactionReceipt({hash});
      onToast(`Đã nạp thành công ${fmt(seedAmount, 0)} GCARB vào kho Market!`);
      await onRefreshOnChain(wallet);
    } catch (err) {
      onToast(formatAvaxError(err));
    } finally {
      setBusy('');
    }
  }

  async function runOwnerWrite(
    actionKey: string,
    functionName: string,
    args: unknown[],
    pendingMsg: string,
    doneMsg: string
  ) {
    const registryAddress = getRegistryAddress();
    if (!isContractDeployed() || !registryAddress) return onToast('Contract chưa deploy.');
    if (!wallet) {
      onOpenWalletModal();
      return;
    }
    const eth = getInjectedEthereum();
    if (!eth) return;

    setBusy(actionKey);
    try {
      const switchedId = await ensureFujiNetwork(eth);
      onSetWalletChainId(switchedId);
      const walletClient = getWalletClient(eth, wallet, switchedId);
      const client = getPublicClient(switchedId);

      const hash = await walletClient.writeContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName,
        args,
        account: wallet,
      });
      onToast(pendingMsg);
      await client.waitForTransactionReceipt({hash});
      onToast(doneMsg);
      await onRefreshOnChain(wallet);
    } catch (err) {
      onToast(formatAvaxError(err));
    } finally {
      setBusy('');
    }
  }

  const registryAddr = getRegistryAddress();
  const tokenAddr = getTokenAddress();

  return (
    <>
      <div className="demo-banner">
        <ServerCog size={19} />
        <div>
          <strong>Quản trị Giao thức & 1-Click Smart Contract Deployer</strong>
          <p>
            Triển khai trực tiếp hợp đồng lên Avalanche Fuji / Localhost từ ví MetaMask hoặc quản lý
            doanh thu AVAX, Oracle Signer, giá bán và chế độ Soulbound.
          </p>
        </div>
      </div>

      <div className="verify-grid admin-grid">
        <section className="panel form-panel">
          <div className="panel-title">
            <div>
              <h3>1-Click Browser Deployer</h3>
              <p>Triển khai mới bộ hợp đồng GreenCarbonToken + CarbonRegistry</p>
            </div>
            <Rocket size={21} />
          </div>

          <div className="evidence-row">
            <span>Trạng thái hiện tại</span>
            <strong>{isContractDeployed() ? `Đã deploy (${getNetworkLabel()})` : 'Chưa deploy'}</strong>
          </div>
          {tokenAddr && (
            <div className="evidence-row">
              <span>GCARB Token</span>
              <strong className="mono">{shortAddr(tokenAddr)}</strong>
            </div>
          )}
          {registryAddr && (
            <div className="evidence-row">
              <span>CarbonRegistry</span>
              <strong className="mono">{shortAddr(registryAddr)}</strong>
            </div>
          )}

          <label style={{marginTop: 16}}>
            Mạng đích triển khai
            <select
              className="select-input"
              value={targetChain}
              onChange={(e) => setTargetChain(Number(e.target.value))}
            >
              <option value={43113}>Avalanche Fuji Testnet (43113)</option>
              <option value={31337}>Local Hardhat Node (31337)</option>
            </select>
          </label>

          <label>
            Địa chỉ Oracle Signer (mặc định từ server .env.local)
            <input
              placeholder="0x..."
              value={deployOracle}
              onChange={(e) => setDeployOracle(e.target.value)}
            />
          </label>

          <div className="deploy-steps-mini">
            {['1. Deploy Token', '2. Deploy Registry', '3. Set Registry', '4. Lưu Config'].map(
              (label, i) => (
                <span key={label} className={deployStep > i ? 'done' : deployStep === i + 1 && busy === 'deploy' ? 'active' : ''}>
                  {deployStep > i ? <Check size={12} /> : null} {label}
                </span>
              )
            )}
          </div>

          <button className="primary full" onClick={deployFromBrowser} disabled={!!busy}>
            {busy === 'deploy' ? <LoaderCircle size={17} className="spin" /> : <Rocket size={17} />}
            {busy === 'deploy' ? 'Đang triển khai lên chuỗi…' : 'Deploy Contract bằng Ví Trình duyệt'}
          </button>

          <div className="sub-divider" />
          <div className="panel-title compact-title">
            <h3>Nạp tồn kho Market (Treasury Top-Up)</h3>
            <Coins size={18} />
          </div>
          <p className="muted-p">
            Server ký chữ ký Oracle cho kho và ví của bạn gọi <code>fundTreasury()</code>.
          </p>
          <div className="transfer-row">
            <input
              type="number"
              min="1"
              step="100"
              value={seedAmount}
              onChange={(e) => setSeedAmount(Number(e.target.value))}
            />
            <button
              className="primary"
              onClick={seedTreasuryOnChain}
              disabled={!!busy || !isContractDeployed()}
            >
              {busy === 'seed' ? <LoaderCircle size={15} className="spin" /> : <Coins size={15} />}
              Nạp {fmt(seedAmount, 0)} GCARB
            </button>
          </div>
        </section>

        <section className="panel form-panel">
          <div className="panel-title">
            <div>
              <h3>Quản trị Hợp đồng (Owner Controls)</h3>
              <p>Rút AVAX bán tín chỉ, cập nhật tỷ giá, Oracle Signer và Soulbound</p>
            </div>
            <ShieldCheck size={22} />
          </div>

          <div className="evidence-row">
            <span>Contract Owner</span>
            <strong className="mono">
              {stats.contractOwner ? shortAddr(stats.contractOwner) : '—'}{' '}
              {isOwner ? '(Ví của bạn)' : ''}
            </strong>
          </div>
          <div className="evidence-row">
            <span>Oracle Signer On-Chain</span>
            <strong className="mono">
              {stats.contractOracleSigner ? shortAddr(stats.contractOracleSigner) : '—'}
            </strong>
          </div>
          <div className="evidence-row">
            <span>Doanh thu AVAX trong Contract</span>
            <strong>{stats.registryAvax.toFixed(4)} AVAX</strong>
          </div>
          <div className="evidence-row">
            <span>Chế độ Soulbound mặc định</span>
            <strong>{stats.defaultSoulbound ? 'Đang BẬT (Bắt buộc SBT)' : 'Tùy chọn khi Retire'}</strong>
          </div>

          {!isOwner && stats.contractOwner && (
            <div className="warnings-box" style={{marginTop: 14}}>
              <p>
                <ShieldAlert size={14} /> Các thao tác dưới đây yêu cầu kết nối ví Owner{' '}
                <span className="mono">{shortAddr(stats.contractOwner)}</span>.
              </p>
            </div>
          )}

          <div className="admin-action-block">
            <label>
              Rút toàn bộ doanh thu AVAX về ví ({stats.registryAvax.toFixed(4)} AVAX)
              <div className="transfer-row">
                <input
                  placeholder="Địa chỉ nhận AVAX (0x...)"
                  value={withdrawTo}
                  onChange={(e) => setWithdrawTo(e.target.value)}
                />
                <button
                  className="secondary-btn"
                  disabled={!!busy || !isContractDeployed() || stats.registryAvax <= 0}
                  onClick={() => {
                    if (!isAddress(withdrawTo.trim())) {
                      return onToast('Địa chỉ ví nhận AVAX không hợp lệ.');
                    }
                    void runOwnerWrite(
                      'withdraw',
                      'withdraw',
                      [withdrawTo.trim() as Address],
                      'Đang rút doanh thu AVAX từ CarbonRegistry…',
                      'Đã rút doanh thu AVAX thành công!'
                    );
                  }}
                >
                  {busy === 'withdraw' ? <LoaderCircle size={14} className="spin" /> : <Wallet size={14} />}
                  Rút AVAX
                </button>
              </div>
            </label>

            <label>
              Cập nhật tỷ giá bán Treasury (AVAX / 1 GCARB)
              <div className="transfer-row">
                <input
                  type="number"
                  min="0.000001"
                  step="0.0001"
                  value={newCreditPrice}
                  onChange={(e) => setNewCreditPrice(e.target.value)}
                />
                <button
                  className="secondary-btn"
                  disabled={!!busy || !isContractDeployed()}
                  onClick={() => {
                    const num = Number(newCreditPrice);
                    if (!Number.isFinite(num) || num < 0.000001) {
                      return onToast('Tỷ giá tối thiểu 0.000001 AVAX.');
                    }
                    const priceWei = parseEther((Math.round(num * 1_000_000) / 1_000_000).toFixed(6));
                    void runOwnerWrite(
                      'price',
                      'setCreditPrice',
                      [priceWei],
                      'Đang cập nhật tỷ giá GCARB…',
                      `Đã cập nhật tỷ giá: 1 GCARB = ${num} AVAX.`
                    );
                  }}
                >
                  {busy === 'price' ? <LoaderCircle size={14} className="spin" /> : <Coins size={14} />}
                  Đặt giá
                </button>
              </div>
            </label>

            <label>
              Thay đổi địa chỉ Oracle Signer
              <div className="transfer-row">
                <input
                  placeholder="Địa chỉ ví Oracle mới (0x...)"
                  value={newOracleSigner}
                  onChange={(e) => setNewOracleSigner(e.target.value)}
                />
                <button
                  className="secondary-btn"
                  disabled={!!busy || !isContractDeployed()}
                  onClick={() => {
                    if (!isAddress(newOracleSigner.trim())) {
                      return onToast('Địa chỉ Oracle mới không hợp lệ.');
                    }
                    void runOwnerWrite(
                      'oracle',
                      'setOracleSigner',
                      [newOracleSigner.trim() as Address],
                      'Đang cập nhật Oracle Signer…',
                      'Đã đổi Oracle Signer thành công!'
                    );
                  }}
                >
                  {busy === 'oracle' ? <LoaderCircle size={14} className="spin" /> : <KeyRound size={14} />}
                  Cập nhật
                </button>
              </div>
            </label>

            <button
              className="secondary full"
              disabled={!!busy || !isContractDeployed()}
              onClick={() =>
                void runOwnerWrite(
                  'sbt',
                  'setDefaultSoulbound',
                  [!stats.defaultSoulbound],
                  'Đang cập nhật cấu hình Soulbound…',
                  `Đã ${!stats.defaultSoulbound ? 'BẬT' : 'TẮT'} Soulbound mặc định toàn hệ thống.`
                )
              }
            >
              {busy === 'sbt' ? <LoaderCircle size={15} className="spin" /> : <Lock size={15} />}
              {stats.defaultSoulbound
                ? 'Tắt bắt buộc Soulbound mặc định'
                : 'Bật bắt buộc Soulbound (SBT) cho toàn bộ chứng nhận mới'}
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
