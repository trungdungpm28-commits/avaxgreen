# AvaxGreen — AI-Verified RWA Carbon Credits & On-Chain ESG Certificates

**AvaxGreen** là ứng dụng web phi tập trung (dApp) trên mạng **Avalanche Fuji Testnet**, kết hợp **Gemini Vision AI**, dữ liệu vệ tinh **NASA POWER API**, chữ ký xác thực **ECDSA Oracle** và **Smart Contract ERC-20 / ERC-721** với chứng nhận SVG lưu trữ 100% on-chain.

## 4 Màn hình chức năng chính

1. **Trang Tổng quan (Overview Dashboard)**
   - Đọc dữ liệu thực tế từ blockchain Avalanche Fuji (`totalMintedCO2`, `totalRetiredCO2`, `totalCertificates`, tồn kho Market, số dư `GCARB` & `AVAX` của ví).
   - Hiển thị lịch sử sự kiện on-chain (`CreditsMinted`, `CreditsPurchased`, `CreditsRetired`) kèm liên kết trực tiếp tới **Snowtrace**.
2. **Hộ gia đình / Chủ điện mặt trời (Verify & Mint)**
   - Upload ảnh mái nhà lắp pin mặt trời hoặc hóa đơn điện, hoặc bấm **Load Sample Solar Data** (nạp ảnh mái nhà Thủ Đức thật).
   - Server `/api/verify` gọi **Gemini Vision AI** (nhận diện tấm pin, ước tính công suất, chấm điểm chống gian lận) + **NASA POWER API** (bức xạ mặt trời thực tế tại tọa độ) → **Oracle ký ECDSA**.
   - Người dùng bấm **Mint GCARB** để Smart Contract kiểm tra chữ ký, chống replay (`usedProofHashes`) và đúc token `GCARB` (1 GCARB = 1 kg CO₂) về ví.
3. **Doanh nghiệp (Market & Retire)**
   - Dùng test AVAX mua token `GCARB` trực tiếp từ kho tín chỉ đã xác minh trên `CarbonRegistry` (`0.0001 AVAX / GCARB`).
   - Nhập tên doanh nghiệp và lý do bù đắp carbon → thực hiện luồng 2 bước (`Approve GCARB` → `retireCredits`) để đốt vĩnh viễn tín chỉ và đúc **ESG Certificate NFT (ERC-721)**.
4. **Bộ sưu tập Chứng nhận (My Certificates)**
   - Đọc trực tiếp các NFT thuộc sở hữu của ví thông qua `certificatesOf(wallet)` và `tokenURI(id)`.
   - Render ảnh **SVG 100% On-Chain** từ chuỗi `data:application/json;base64,...`, hỗ trợ soi mã JSON/SVG on-chain và tải xuống SVG/JSON.

---

## Cài đặt & Triển khai lên Avalanche Fuji Testnet

### 1. Cài đặt dependencies
```bash
npm install
```

### 2. Deploy Smart Contracts lên Fuji (Chain ID `43113`)
Sao chép `contracts/.env.example` thành `contracts/.env` và điền:
- `DEPLOYER_PRIVATE_KEY`: Private key ví có sẵn test AVAX trên Fuji ([Faucet](https://core.app/tools/testnet-faucet/?subnet=c&token=c)).
- `ORACLE_PRIVATE_KEY`: Private key dùng để ký Oracle (script tự suy ra `ORACLE_SIGNER_ADDRESS` và tự động seed `10,000 GCARB` vào kho Market).

Chạy test và deploy:
```bash
npm test
npm run deploy:fuji -w contracts
```
Script `deploy:fuji` tự động ghi địa chỉ contract & ABI vào `frontend/src/contracts/`.

### 3. Cấu hình Frontend Server (`/api/verify`)
Sao chép `frontend/.env.example` thành `frontend/.env.local` và điền:
- `GEMINI_API_KEY`: API key từ Google AI Studio.
- `ORACLE_PRIVATE_KEY`: Trùng với khóa Oracle đã thiết lập lúc deploy.
- `REGISTRY_ADDRESS`: Địa chỉ `CarbonRegistry` vừa deploy (hoặc để trống, server tự đọc từ `frontend/src/contracts/addresses.json`).

### 4. Chạy ứng dụng
```bash
npm run dev
```
Mở `http://localhost:3000`, kết nối MetaMask hoặc Core Wallet (ứng dụng tự động chuyển sang mạng Avalanche Fuji Testnet `43113`).

## Build Production
```bash
npm run build
```
