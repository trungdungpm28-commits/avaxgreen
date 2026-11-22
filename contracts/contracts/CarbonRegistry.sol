// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721URIStorage} from '@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol';
import {ERC721} from '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {ECDSA} from '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import {MessageHashUtils} from '@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol';
import {Base64} from '@openzeppelin/contracts/utils/Base64.sol';
import {Strings} from '@openzeppelin/contracts/utils/Strings.sol';
import {GreenCarbonToken} from './GreenCarbonToken.sol';

contract CarbonRegistry is ERC721URIStorage, Ownable, ReentrancyGuard {
    struct ProofRecord {
        address producer;
        uint256 amount;
        uint64 timestamp;
        string projectId;
    }

    struct Project {
        address owner;
        string projectId;
        string name;
        string location;
        uint256 capacityWatt;
        uint256 totalMinted;
        uint64 registeredAt;
        bool active;
    }

    struct Listing {
        uint256 id;
        address seller;
        uint256 remainingAmount;
        uint256 pricePerKgWei;
        string projectInfo;
        bool active;
    }

    GreenCarbonToken public immutable token;
    address public oracleSigner;
    uint256 public totalMintedCO2;
    uint256 public totalRetiredCO2;
    uint256 public totalCertificates;
    uint256 public creditPriceWei = 1e14;
    uint256 public totalListings;
    uint256 public escrowedListingTokens;
    bool public defaultSoulbound;

    mapping(bytes32 => bool) public usedProofHashes;
    mapping(bytes32 => ProofRecord) public proofRecords;
    mapping(uint256 => Listing) public listings;
    mapping(uint256 => bool) public certificateSoulbound;
    mapping(bytes32 => uint256) private _projectIndexPlusOne;
    Project[] private _projects;

    event CreditsMinted(address indexed producer, uint256 amount, bytes32 indexed proofHash);
    event CreditsPurchased(address indexed buyer, uint256 amount, uint256 paid);
    event CreditsRetired(address indexed company, uint256 amount, uint256 indexed certificateId);
    event ProjectRegistered(
        uint256 indexed id,
        address indexed owner,
        string projectId,
        string name,
        uint256 capacityWatt
    );
    event ListingCreated(
        uint256 indexed listingId,
        address indexed seller,
        uint256 amount,
        uint256 pricePerKgWei,
        string projectInfo
    );
    event ListingPurchased(
        uint256 indexed listingId,
        address indexed buyer,
        address indexed seller,
        uint256 amount,
        uint256 paid
    );
    event ListingCancelled(uint256 indexed listingId, address indexed seller, uint256 returnedAmount);
    event CreditPriceUpdated(uint256 newPriceWei);
    event DefaultSoulboundUpdated(bool enabled);
    event CertificateLockedSoulbound(uint256 indexed tokenId);

    constructor(address carbonToken, address signer, address admin)
        ERC721('AvaxGreen ESG Retirement', 'GREEN-ESG')
        Ownable(admin)
    {
        require(carbonToken != address(0) && signer != address(0), 'Zero address');
        token = GreenCarbonToken(carbonToken);
        oracleSigner = signer;
    }

    function setOracleSigner(address signer) external onlyOwner {
        require(signer != address(0), 'Zero signer');
        oracleSigner = signer;
    }

    function setCreditPrice(uint256 newPriceWei) external onlyOwner {
        require(newPriceWei >= 1e10, 'Price too low');
        creditPriceWei = newPriceWei;
        emit CreditPriceUpdated(newPriceWei);
    }

    function setDefaultSoulbound(bool enabled) external onlyOwner {
        defaultSoulbound = enabled;
        emit DefaultSoulboundUpdated(enabled);
    }

    function treasuryInventory() public view returns (uint256) {
        uint256 bal = token.balanceOf(address(this));
        return bal > escrowedListingTokens ? bal - escrowedListingTokens : 0;
    }

    function verificationDigest(address producer, uint256 amount, bytes32 proofHash) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), producer, amount, proofHash));
    }

    function verificationDigestWithExpiry(
        address producer,
        uint256 amount,
        bytes32 proofHash,
        uint256 deadline
    ) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), producer, amount, proofHash, deadline));
    }

    function mintVerifiedCredits(uint256 amount, bytes32 proofHash, bytes calldata signature) external nonReentrant {
        require(amount > 0, 'Zero amount');
        require(!usedProofHashes[proofHash], 'Proof already used');
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(verificationDigest(msg.sender, amount, proofHash));
        require(ECDSA.recover(digest, signature) == oracleSigner, 'Invalid oracle');
        _finalizeMint(msg.sender, amount, proofHash, '');
    }

    function mintVerifiedCreditsWithExpiry(
        uint256 amount,
        bytes32 proofHash,
        uint256 deadline,
        string calldata projectId,
        bytes calldata signature
    ) external nonReentrant {
        require(amount > 0, 'Zero amount');
        require(block.timestamp <= deadline, 'Signature expired');
        require(!usedProofHashes[proofHash], 'Proof already used');
        if (bytes(projectId).length > 0) {
            _validateText(projectId, 64);
        }
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            verificationDigestWithExpiry(msg.sender, amount, proofHash, deadline)
        );
        require(ECDSA.recover(digest, signature) == oracleSigner, 'Invalid oracle');
        _finalizeMint(msg.sender, amount, proofHash, projectId);
    }

    function _finalizeMint(address producer, uint256 amount, bytes32 proofHash, string memory projectId) private {
        usedProofHashes[proofHash] = true;
        proofRecords[proofHash] = ProofRecord({
            producer: producer,
            amount: amount,
            timestamp: uint64(block.timestamp),
            projectId: projectId
        });
        if (bytes(projectId).length > 0) {
            uint256 idxPlusOne = _projectIndexPlusOne[keccak256(bytes(projectId))];
            if (idxPlusOne > 0) {
                Project storage proj = _projects[idxPlusOne - 1];
                if (proj.active && proj.owner == producer) {
                    proj.totalMinted += amount;
                }
            }
        }
        totalMintedCO2 += amount;
        token.mint(producer, amount);
        emit CreditsMinted(producer, amount, proofHash);
    }

    function fundTreasury(uint256 amount, bytes32 proofHash, bytes calldata signature) external nonReentrant {
        require(amount > 0 && !usedProofHashes[proofHash], 'Invalid proof');
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(verificationDigest(address(this), amount, proofHash));
        require(ECDSA.recover(digest, signature) == oracleSigner, 'Invalid oracle');
        usedProofHashes[proofHash] = true;
        proofRecords[proofHash] = ProofRecord({
            producer: address(this),
            amount: amount,
            timestamp: uint64(block.timestamp),
            projectId: 'TREASURY'
        });
        totalMintedCO2 += amount;
        token.mint(address(this), amount);
        emit CreditsMinted(address(this), amount, proofHash);
    }

    function registerProject(
        string calldata projectId,
        string calldata name,
        string calldata location,
        uint256 capacityWatt
    ) external {
        _validateText(projectId, 64);
        _validateText(name, 100);
        _validateText(location, 100);
        require(capacityWatt > 0, 'Zero capacity');
        bytes32 key = keccak256(bytes(projectId));
        require(_projectIndexPlusOne[key] == 0, 'Project exists');

        _projects.push(
            Project({
                owner: msg.sender,
                projectId: projectId,
                name: name,
                location: location,
                capacityWatt: capacityWatt,
                totalMinted: 0,
                registeredAt: uint64(block.timestamp),
                active: true
            })
        );
        uint256 id = _projects.length;
        _projectIndexPlusOne[key] = id;
        emit ProjectRegistered(id, msg.sender, projectId, name, capacityWatt);
    }

    function getProjects() external view returns (Project[] memory) {
        return _projects;
    }

    function buyCredits() external payable nonReentrant {
        require(msg.value > 0 && msg.value % creditPriceWei == 0, 'Use multiples of 0.0001 AVAX');
        uint256 amount = (msg.value * 1e18) / creditPriceWei;
        require(treasuryInventory() >= amount, 'Insufficient verified inventory');
        require(token.transfer(msg.sender, amount), 'Transfer failed');
        emit CreditsPurchased(msg.sender, amount, msg.value);
    }

    function createListing(
        uint256 amount,
        uint256 pricePerKgWei,
        string calldata projectInfo
    ) external nonReentrant returns (uint256) {
        require(amount > 0 && pricePerKgWei >= 1e10, 'Invalid listing params');
        _validateText(projectInfo, 120);
        require(token.transferFrom(msg.sender, address(this), amount), 'Transfer failed');
        escrowedListingTokens += amount;
        uint256 id = ++totalListings;
        listings[id] = Listing({
            id: id,
            seller: msg.sender,
            remainingAmount: amount,
            pricePerKgWei: pricePerKgWei,
            projectInfo: projectInfo,
            active: true
        });
        emit ListingCreated(id, msg.sender, amount, pricePerKgWei, projectInfo);
        return id;
    }

    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage l = listings[listingId];
        require(l.active && l.seller == msg.sender, 'Not seller or inactive');
        uint256 rem = l.remainingAmount;
        l.remainingAmount = 0;
        l.active = false;
        escrowedListingTokens -= rem;
        require(token.transfer(msg.sender, rem), 'Transfer failed');
        emit ListingCancelled(listingId, msg.sender, rem);
    }

    function buyFromListing(uint256 listingId, uint256 amount) external payable nonReentrant {
        Listing storage l = listings[listingId];
        require(l.active && amount > 0 && amount <= l.remainingAmount, 'Listing unavailable');
        uint256 numerator = amount * l.pricePerKgWei;
        require(numerator % 1e18 == 0, 'Invalid payment precision');
        uint256 cost = numerator / 1e18;
        require(cost > 0 && msg.value == cost, 'Incorrect AVAX payment');

        l.remainingAmount -= amount;
        if (l.remainingAmount == 0) {
            l.active = false;
        }
        escrowedListingTokens -= amount;
        require(token.transfer(msg.sender, amount), 'Transfer failed');
        (bool ok,) = payable(l.seller).call{value: msg.value}('');
        require(ok, 'Seller payout failed');
        emit ListingPurchased(listingId, msg.sender, l.seller, amount, msg.value);
    }

    function activeListings() external view returns (Listing[] memory) {
        uint256 total = totalListings;
        uint256 count;
        for (uint256 i = 1; i <= total; i++) {
            if (listings[i].active) count++;
        }
        Listing[] memory items = new Listing[](count);
        uint256 idx;
        for (uint256 i = 1; i <= total; i++) {
            if (listings[i].active) {
                items[idx++] = listings[i];
            }
        }
        return items;
    }

    function retireCredits(uint256 amount, string calldata companyName, string calldata reason) external nonReentrant {
        _retire(amount, companyName, reason, defaultSoulbound);
    }

    function retireCreditsWithOptions(
        uint256 amount,
        string calldata companyName,
        string calldata reason,
        bool soulbound
    ) external nonReentrant {
        _retire(amount, companyName, reason, soulbound || defaultSoulbound);
    }

    function lockCertificateSoulbound(uint256 tokenId) external {
        require(_ownerOf(tokenId) == msg.sender, 'Not certificate owner');
        require(!certificateSoulbound[tokenId], 'Already soulbound');
        certificateSoulbound[tokenId] = true;
        emit CertificateLockedSoulbound(tokenId);
    }

    function _retire(uint256 amount, string calldata companyName, string calldata reason, bool soulbound) private {
        require(amount > 0, 'Zero amount');
        _validateText(companyName, 120);
        _validateText(reason, 256);
        uint256 id = ++totalCertificates;
        totalRetiredCO2 += amount;
        if (soulbound) {
            certificateSoulbound[id] = true;
        }
        token.burnFrom(msg.sender, amount);
        _safeMint(msg.sender, id);
        _setTokenURI(id, _metadata(id, amount, companyName, reason, soulbound));
        emit CreditsRetired(msg.sender, amount, id);
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            require(!defaultSoulbound && !certificateSoulbound[tokenId], 'Soulbound ESG certificate');
        }
        return super._update(to, tokenId, auth);
    }

    function certificatesOf(address owner) external view returns (uint256[] memory) {
        uint256 total = totalCertificates;
        uint256 count;
        for (uint256 i = 1; i <= total; i++) {
            if (_ownerOf(i) == owner) count++;
        }
        uint256[] memory ids = new uint256[](count);
        uint256 idx;
        for (uint256 i = 1; i <= total; i++) {
            if (_ownerOf(i) == owner) {
                ids[idx++] = i;
            }
        }
        return ids;
    }

    function withdraw(address payable recipient) external onlyOwner nonReentrant {
        require(recipient != address(0), 'Zero recipient');
        (bool ok,) = recipient.call{value: address(this).balance}('');
        require(ok, 'Withdrawal failed');
    }

    function _validateText(string calldata text, uint256 maxLength) private pure {
        bytes memory b = bytes(text);
        require(b.length > 0 && b.length <= maxLength, 'Text length');
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            require(
                uint8(c) >= 32 && c != '"' && c != '\\' && c != '<' && c != '>' && c != '&',
                'Unsafe metadata character'
            );
        }
    }

    function _formatKg(uint256 amount) private pure returns (string memory) {
        uint256 whole = amount / 1e18;
        uint256 milli = (amount % 1e18) / 1e15;
        if (milli == 0) {
            return Strings.toString(whole);
        }
        uint256 d1 = milli / 100;
        uint256 d2 = (milli / 10) % 10;
        uint256 d3 = milli % 10;
        if (d3 != 0) {
            return string.concat(
                Strings.toString(whole),
                '.',
                Strings.toString(d1),
                Strings.toString(d2),
                Strings.toString(d3)
            );
        }
        if (d2 != 0) {
            return string.concat(Strings.toString(whole), '.', Strings.toString(d1), Strings.toString(d2));
        }
        return string.concat(Strings.toString(whole), '.', Strings.toString(d1));
    }

    function _buildSvg(uint256 id, string memory kg, string memory company, string memory reason, bool soulbound)
        private
        view
        returns (string memory)
    {
        string memory idStr = Strings.toString(id);
        string memory tsStr = Strings.toString(block.timestamp);
        string memory companyOpen = bytes(company).length > 42
            ? '<text x="400" y="176" font-size="22" fill="#eef2eb" font-weight="700" textLength="660" lengthAdjust="spacingAndGlyphs">'
            : '<text x="400" y="176" font-size="28" fill="#eef2eb" font-weight="700">';
        string memory reasonOpen = bytes(reason).length > 72
            ? '<text x="400" y="294" font-size="12" fill="#9fb89f" textLength="660" lengthAdjust="spacingAndGlyphs">'
            : '<text x="400" y="294" font-size="13" fill="#9fb89f">';
        string memory badge = soulbound ? 'SOULBOUND (SBT)' : 'VERIFIED ERC-721';

        string memory header = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">',
            '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
            '<stop offset="0%" stop-color="#0e1d15"/><stop offset="100%" stop-color="#172e21"/></linearGradient></defs>',
            '<rect width="800" height="500" rx="18" fill="url(#bg)"/>',
            '<rect x="20" y="20" width="760" height="460" rx="12" fill="none" stroke="#b8ec88" stroke-opacity="0.65" stroke-width="1.5"/>',
            '<rect x="30" y="30" width="740" height="440" rx="8" fill="none" stroke="#b8ec88" stroke-opacity="0.18" stroke-width="1"/>'
        );
        string memory body = string.concat(
            '<g fill="#b8ec88" font-family="system-ui, -apple-system, sans-serif" text-anchor="middle">',
            '<text x="400" y="76" font-size="13" letter-spacing="3" font-weight="600">AVAXGREEN | ON-CHAIN ESG CERTIFICATE</text>',
            '<text x="400" y="106" font-size="11" fill="#89a88d" letter-spacing="1.5">PROOF OF PERMANENT CARBON RETIREMENT</text>',
            companyOpen,
            company,
            '</text>',
            '<text x="400" y="250" font-size="48" fill="#b8ec88" font-weight="700">',
            kg,
            ' kg CO2</text>',
            reasonOpen,
            reason,
            '</text>'
        );
        string memory footer = string.concat(
            '<line x1="90" y1="358" x2="710" y2="358" stroke="#b8ec88" stroke-opacity="0.22"/>',
            '<text x="400" y="394" font-size="13" fill="#cfe6bc">Certificate #',
            idStr,
            ' &#x2022; Timestamp ',
            tsStr,
            '</text>',
            '<text x="400" y="428" font-size="11" fill="#7c987d" letter-spacing="1.2">Avalanche Fuji &#x2022; 100% On-Chain SVG &#x2022; ',
            badge,
            '</text></g></svg>'
        );
        return string.concat(header, body, footer);
    }

    function _metadata(uint256 id, uint256 amount, string memory company, string memory reason, bool soulbound)
        private
        view
        returns (string memory)
    {
        string memory kg = _formatKg(amount);
        string memory idStr = Strings.toString(id);
        string memory tsStr = Strings.toString(block.timestamp);
        string memory svg = _buildSvg(id, kg, company, reason, soulbound);
        string memory transferLabel = soulbound ? 'Soulbound (Non-transferable)' : 'Standard ERC-721';
        string memory attrs = string.concat(
            '[{"trait_type":"Company","value":"',
            company,
            '"},{"trait_type":"CO2 Retired (kg)","value":"',
            kg,
            '"},{"trait_type":"Certificate ID","value":',
            idStr,
            '},{"trait_type":"Retired At","value":',
            tsStr,
            '},{"trait_type":"Transferability","value":"',
            transferLabel,
            '"},{"trait_type":"Network","value":"Avalanche Fuji"}]'
        );
        string memory json = string.concat(
            '{"name":"AvaxGreen Retirement #',
            idStr,
            '","description":"',
            reason,
            '","company":"',
            company,
            '","amountWei":"',
            Strings.toString(amount),
            '","retiredAt":',
            tsStr,
            ',"soulbound":',
            soulbound ? 'true' : 'false',
            ',"attributes":',
            attrs,
            ',"image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg)),
            '"}'
        );
        return string.concat('data:application/json;base64,', Base64.encode(bytes(json)));
    }
}
