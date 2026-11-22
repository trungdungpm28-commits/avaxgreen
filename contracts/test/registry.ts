import {expect} from 'chai';
import {ethers} from 'hardhat';
import {loadFixture, time} from '@nomicfoundation/hardhat-toolbox/network-helpers';

async function fixture() {
  const [admin, oracle, producer, buyer, attacker] = await ethers.getSigners();
  const token = await ethers.deployContract('GreenCarbonToken', [admin.address]);
  const registry = await ethers.deployContract('CarbonRegistry', [
    await token.getAddress(),
    oracle.address,
    admin.address,
  ]);
  await token.setRegistry(await registry.getAddress());
  const amount = ethers.parseEther('100');
  const proof = ethers.id('unique-energy-period');

  async function sign(who: string, n = amount, p = proof) {
    return oracle.signMessage(ethers.getBytes(await registry.verificationDigest(who, n, p)));
  }

  async function signWithExpiry(who: string, n: bigint, p: string, deadline: number) {
    return oracle.signMessage(
      ethers.getBytes(await registry.verificationDigestWithExpiry(who, n, p, deadline))
    );
  }

  return {admin, oracle, producer, buyer, attacker, token, registry, amount, proof, sign, signWithExpiry};
}

describe('AvaxGreen registry', () => {
  it('only registry can mint; registry can only be set once', async () => {
    const {token, producer, registry} = await loadFixture(fixture);
    await expect(token.mint(producer.address, 1)).to.be.revertedWith('Only registry');
    await expect(token.setRegistry(await registry.getAddress())).to.be.reverted;
  });

  it('mints valid oracle proof and rejects replay', async () => {
    const {token, registry, producer, amount, proof, sign} = await loadFixture(fixture);
    const sig = await sign(producer.address);
    await expect(registry.connect(producer).mintVerifiedCredits(amount, proof, sig)).to.emit(
      registry,
      'CreditsMinted'
    );
    expect(await token.balanceOf(producer.address)).to.equal(amount);
    await expect(registry.connect(producer).mintVerifiedCredits(amount, proof, sig)).to.be.revertedWith(
      'Proof already used'
    );
  });

  it('supports expiring oracle signatures and tracks ProofRecord + Project Registry', async () => {
    const {token, registry, producer, amount, proof, signWithExpiry} = await loadFixture(fixture);
    await registry
      .connect(producer)
      .registerProject('VN-HCMC-001', 'Thu Duc Solar Roof', 'TP.HCM', 5000);

    const now = await time.latest();
    const expiredSig = await signWithExpiry(producer.address, amount, proof, now - 10);
    await expect(
      registry
        .connect(producer)
        .mintVerifiedCreditsWithExpiry(amount, proof, now - 10, 'VN-HCMC-001', expiredSig)
    ).to.be.revertedWith('Signature expired');

    const validDeadline = now + 3600;
    const validSig = await signWithExpiry(producer.address, amount, proof, validDeadline);
    await registry
      .connect(producer)
      .mintVerifiedCreditsWithExpiry(amount, proof, validDeadline, 'VN-HCMC-001', validSig);

    expect(await token.balanceOf(producer.address)).to.equal(amount);
    const record = await registry.proofRecords(proof);
    expect(record.producer).to.equal(producer.address);
    expect(record.amount).to.equal(amount);
    expect(record.projectId).to.equal('VN-HCMC-001');

    const projects = await registry.getProjects();
    expect(projects.length).to.equal(1);
    expect(projects[0].totalMinted).to.equal(amount);
  });

  it('binds signature to recipient and amount', async () => {
    const {registry, producer, attacker, amount, proof, sign} = await loadFixture(fixture);
    const sig = await sign(producer.address);
    await expect(registry.connect(attacker).mintVerifiedCredits(amount, proof, sig)).to.be.revertedWith(
      'Invalid oracle'
    );
    await expect(registry.connect(producer).mintVerifiedCredits(amount + 1n, proof, sig)).to.be.revertedWith(
      'Invalid oracle'
    );
  });

  it('binds signature to registry domain', async () => {
    const {token, oracle, admin, producer, amount, proof, sign} = await loadFixture(fixture);
    const second = await ethers.deployContract('CarbonRegistry', [
      await token.getAddress(),
      oracle.address,
      admin.address,
    ]);
    await expect(
      second.connect(producer).mintVerifiedCredits(amount, proof, await sign(producer.address))
    ).to.be.revertedWith('Invalid oracle');
  });

  it('rejects unbacked purchases and sells only oracle verified inventory', async () => {
    const {registry, token, buyer, amount, proof, sign} = await loadFixture(fixture);
    await expect(registry.connect(buyer).buyCredits({value: ethers.parseEther('.001')})).to.be.revertedWith(
      'Insufficient verified inventory'
    );
    await registry.fundTreasury(amount, proof, await sign(await registry.getAddress()));
    await registry.connect(buyer).buyCredits({value: ethers.parseEther('.001')});
    expect(await token.balanceOf(buyer.address)).to.equal(ethers.parseEther('10'));
    expect(await registry.totalMintedCO2()).to.equal(amount);
  });

  it('supports P2P listings without mingling with treasury inventory', async () => {
    const {registry, token, producer, buyer, amount, proof, sign} = await loadFixture(fixture);
    await registry.connect(producer).mintVerifiedCredits(amount, proof, await sign(producer.address));
    await token.connect(producer).approve(await registry.getAddress(), amount);

    const pricePerKg = ethers.parseEther('0.0002');
    await registry.connect(producer).createListing(amount, pricePerKg, 'VN-HCMC-001 · Thu Duc 5kWp');

    expect(await registry.escrowedListingTokens()).to.equal(amount);
    expect(await registry.treasuryInventory()).to.equal(0n);
    await expect(registry.connect(buyer).buyCredits({value: ethers.parseEther('0.001')})).to.be.revertedWith(
      'Insufficient verified inventory'
    );

    const buyAmount = ethers.parseEther('40');
    const cost = ethers.parseEther('0.008');
    const producerBefore = await ethers.provider.getBalance(producer.address);
    await registry.connect(buyer).buyFromListing(1, buyAmount, {value: cost});
    const producerAfter = await ethers.provider.getBalance(producer.address);

    expect(producerAfter - producerBefore).to.equal(cost);
    expect(await token.balanceOf(buyer.address)).to.equal(buyAmount);

    await registry.connect(producer).cancelListing(1);
    expect(await token.balanceOf(producer.address)).to.equal(ethers.parseEther('60'));
    expect((await registry.activeListings()).length).to.equal(0);
  });

  it('requires approval; burns credits and generates precise NFT metadata', async () => {
    const {registry, token, producer, amount, proof, sign} = await loadFixture(fixture);
    await registry.connect(producer).mintVerifiedCredits(amount, proof, await sign(producer.address));
    await expect(registry.connect(producer).retireCredits(amount, 'Green VN', 'Climate action')).to.be.reverted;
    await token.connect(producer).approve(await registry.getAddress(), amount);
    await registry.connect(producer).retireCredits(amount, 'Green VN', 'Climate action');
    expect(await token.balanceOf(producer.address)).to.equal(0);
    expect(await registry.totalRetiredCO2()).to.equal(amount);
    expect(await registry.ownerOf(1)).to.equal(producer.address);

    const uri = await registry.tokenURI(1);
    const meta = JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString('utf-8'));
    expect(meta.company).to.equal('Green VN');
    expect(meta.amountWei).to.equal(amount.toString());
    expect(meta.attributes).to.be.an('array');
    const svg = Buffer.from(meta.image.split(',')[1], 'base64').toString('utf-8');
    expect(svg).to.include('100 kg CO2');
    expect(svg).to.include('AVAXGREEN | ON-CHAIN ESG CERTIFICATE');
  });

  it('enforces Soulbound (SBT) retirement certificates and SVG textLength overflow guard', async () => {
    const {registry, token, producer, buyer, amount, proof, sign} = await loadFixture(fixture);
    await registry.connect(producer).mintVerifiedCredits(amount, proof, await sign(producer.address));
    await token.connect(producer).approve(await registry.getAddress(), amount);

    const longCompany = 'Cong ty Co phan Nang luong Tai tao va Xuat khau Nong san Xanh Dong Nam Bo';
    const longReason =
      'Bu dap phat thai khi nha kinh pham vi 1 va 2 cho toan bo chuoi cung ung van tai logistics quy 4 nam 2026 tai Viet Nam';

    await registry.connect(producer).retireCreditsWithOptions(amount, longCompany, longReason, true);
    expect(await registry.certificateSoulbound(1)).to.equal(true);
    await expect(
      registry.connect(producer).transferFrom(producer.address, buyer.address, 1)
    ).to.be.revertedWith('Soulbound ESG certificate');

    const uri = await registry.tokenURI(1);
    const meta = JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString('utf-8'));
    expect(meta.soulbound).to.equal(true);
    const svg = Buffer.from(meta.image.split(',')[1], 'base64').toString('utf-8');
    expect(svg).to.include('textLength="660"');
    expect(svg).to.include('SOULBOUND (SBT)');
  });

  it('formats fractional kg cleanly and preserves Vietnamese UTF-8 metadata', async () => {
    const {registry, token, producer, proof, sign} = await loadFixture(fixture);
    const fractional = ethers.parseEther('394.6');
    await registry.connect(producer).mintVerifiedCredits(fractional, proof, await sign(producer.address, fractional));
    await token.connect(producer).approve(await registry.getAddress(), fractional);

    const vnCompany = 'Công ty Xuất khẩu Xanh Việt Nam';
    const vnReason = 'Bù đắp khí thải xuất khẩu quý 4/2026';
    await registry.connect(producer).retireCredits(fractional, vnCompany, vnReason);

    const uri = await registry.tokenURI(1);
    const meta = JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString('utf-8'));
    expect(meta.company).to.equal(vnCompany);
    expect(meta.description).to.equal(vnReason);

    const co2Attr = meta.attributes.find((a: {trait_type: string}) => a.trait_type === 'CO2 Retired (kg)');
    expect(co2Attr.value).to.equal('394.6');
    expect(meta.attributes.find((a: {trait_type: string}) => a.trait_type === 'Network').value).to.equal(
      'Avalanche Fuji'
    );

    const svg = Buffer.from(meta.image.split(',')[1], 'base64').toString('utf-8');
    expect(svg).to.include('394.6 kg CO2');
    expect(svg).to.include(vnCompany);
    expect(svg).to.include(vnReason);
  });

  it('enumerates owned certificates with certificatesOf across transfers and supports locking SBT later', async () => {
    const {registry, token, producer, buyer, amount, proof, sign} = await loadFixture(fixture);
    await registry.connect(producer).mintVerifiedCredits(amount, proof, await sign(producer.address));
    await token.connect(producer).approve(await registry.getAddress(), amount);

    const half = ethers.parseEther('40');
    const rest = ethers.parseEther('60');
    await registry.connect(producer).retireCredits(half, 'Company A', 'Reason A');
    await registry.connect(producer).retireCredits(rest, 'Company B', 'Reason B');

    expect((await registry.certificatesOf(producer.address)).map((x) => Number(x))).to.deep.equal([1, 2]);
    expect((await registry.certificatesOf(buyer.address)).map((x) => Number(x))).to.deep.equal([]);

    await registry.connect(producer).transferFrom(producer.address, buyer.address, 1);
    expect((await registry.certificatesOf(producer.address)).map((x) => Number(x))).to.deep.equal([2]);
    expect((await registry.certificatesOf(buyer.address)).map((x) => Number(x))).to.deep.equal([1]);

    await registry.connect(buyer).lockCertificateSoulbound(1);
    await expect(
      registry.connect(buyer).transferFrom(buyer.address, producer.address, 1)
    ).to.be.revertedWith('Soulbound ESG certificate');
  });

  it('rejects metadata injection and zero retirements', async () => {
    const {registry} = await loadFixture(fixture);
    await expect(registry.retireCredits(1, '<script>', 'x')).to.be.revertedWith('Unsafe metadata character');
    await expect(registry.retireCredits(0, 'Green', 'Reason')).to.be.revertedWith('Zero amount');
  });

  it('protects signer updates, price updates, soulbound defaults, and withdrawals', async () => {
    const {registry, admin, buyer, attacker, amount, proof, sign} = await loadFixture(fixture);
    await expect(registry.connect(attacker).setOracleSigner(attacker.address)).to.be.reverted;
    await expect(registry.connect(attacker).withdraw(attacker.address)).to.be.reverted;
    await expect(registry.connect(attacker).setCreditPrice(ethers.parseEther('0.0002'))).to.be.reverted;
    await expect(registry.connect(attacker).setDefaultSoulbound(true)).to.be.reverted;

    await registry.fundTreasury(amount, proof, await sign(await registry.getAddress()));
    await registry.connect(admin).setCreditPrice(ethers.parseEther('0.0002'));
    await registry.connect(buyer).buyCredits({value: ethers.parseEther('0.002')});
    const balanceBefore = await ethers.provider.getBalance(admin.address);
    await registry.connect(admin).withdraw(admin.address);
    expect(await ethers.provider.getBalance(await registry.getAddress())).to.equal(0n);
    expect(await ethers.provider.getBalance(admin.address)).to.be.greaterThan(balanceBefore - ethers.parseEther('0.001'));
  });
});
