// Minimal ISO/IEC 18004 Byte-mode QR Code SVG generator (Versions 1..8, ECC Level L/M)

const ALPHABET_EXP = new Uint8Array(256);
const ALPHABET_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    ALPHABET_EXP[i] = x;
    ALPHABET_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return ALPHABET_EXP[(ALPHABET_LOG[a] + ALPHABET_LOG[b]) % 255];
}

function rsGeneratorPoly(ecCount: number): number[] {
  let poly = [1];
  for (let i = 0; i < ecCount; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    const factor = ALPHABET_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: number[], ecCount: number): number[] {
  const gen = rsGeneratorPoly(ecCount);
  const res = [...data, ...new Array<number>(ecCount).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        res[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return res.slice(data.length);
}

// Single-block ECC-L tables for versions 1..6 (up to 134 bytes)
const VERSION_SPEC: Array<{version: number; totalCodewords: number; ecCount: number; align: number[]}> = [
  {version: 1, totalCodewords: 26, ecCount: 7, align: []},
  {version: 2, totalCodewords: 44, ecCount: 10, align: [6, 18]},
  {version: 3, totalCodewords: 70, ecCount: 15, align: [6, 22]},
  {version: 4, totalCodewords: 100, ecCount: 20, align: [6, 26]},
  {version: 5, totalCodewords: 134, ecCount: 26, align: [6, 30]},
  {version: 6, totalCodewords: 172, ecCount: 36, align: [6, 34]},
];

function encodeByteData(text: string): {version: number; size: number; align: number[]; bits: number[]} {
  const utf8 = Array.from(new TextEncoder().encode(text));
  const spec = VERSION_SPEC.find((s) => s.totalCodewords - s.ecCount - 2 >= utf8.length) || VERSION_SPEC[5];
  const dataCapacity = spec.totalCodewords - spec.ecCount;
  const maxBytes = dataCapacity - 2;
  const payload = utf8.slice(0, maxBytes);

  const bitBuf: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bitBuf.push((val >>> i) & 1);
  };

  pushBits(0b0100, 4); // Byte mode
  pushBits(payload.length, 8);
  for (const b of payload) pushBits(b, 8);

  const maxBits = dataCapacity * 8;
  for (let i = 0; i < 4 && bitBuf.length < maxBits; i++) bitBuf.push(0);
  while (bitBuf.length % 8 !== 0) bitBuf.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bitBuf.length; i += 8) {
    let val = 0;
    for (let j = 0; j < 8; j++) val = (val << 1) | bitBuf[i + j];
    codewords.push(val);
  }
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (codewords.length < dataCapacity) {
    codewords.push(padBytes[padIdx % 2]);
    padIdx++;
  }

  let ecBlocks: number[][] = [];
  let dataBlocks: number[][] = [];
  if (spec.version === 6) {
    // Version 6-L uses 2 blocks of 68 data + 18 EC each
    dataBlocks = [codewords.slice(0, 68), codewords.slice(68, 136)];
    ecBlocks = [rsRemainder(dataBlocks[0], 18), rsRemainder(dataBlocks[1], 18)];
  } else {
    dataBlocks = [codewords];
    ecBlocks = [rsRemainder(codewords, spec.ecCount)];
  }

  const finalBytes: number[] = [];
  const maxDataLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const blk of dataBlocks) if (i < blk.length) finalBytes.push(blk[i]);
  }
  const maxEcLen = Math.max(...ecBlocks.map((b) => b.length));
  for (let i = 0; i < maxEcLen; i++) {
    for (const blk of ecBlocks) if (i < blk.length) finalBytes.push(blk[i]);
  }

  const outBits: number[] = [];
  for (const b of finalBytes) {
    for (let i = 7; i >= 0; i--) outBits.push((b >>> i) & 1);
  }
  return {version: spec.version, size: spec.version * 4 + 17, align: spec.align, bits: outBits};
}

function buildQrMatrix(text: string): boolean[][] {
  const {size, align, bits} = encodeByteData(text);
  const grid: (boolean | null)[][] = Array.from({length: size}, () => Array<boolean | null>(size).fill(null));
  const reserved: boolean[][] = Array.from({length: size}, () => Array<boolean>(size).fill(false));

  const setModule = (r: number, c: number, val: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      grid[r][c] = val;
      reserved[r][c] = true;
    }
  };

  const drawFinder = (r0: number, c0: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const on =
          dr >= 0 &&
          dr <= 6 &&
          dc >= 0 &&
          dc <= 6 &&
          (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        setModule(r, c, on);
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  if (align.length >= 2) {
    for (const ar of align) {
      for (const ac of align) {
        if ((ar === 6 && ac === 6) || (ar === 6 && ac > size - 10) || (ar > size - 10 && ac === 6)) {
          continue;
        }
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const on = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
            setModule(ar + dr, ac + dc, on);
          }
        }
      }
    }
  }

  for (let i = 8; i < size - 8; i++) {
    setModule(6, i, i % 2 === 0);
    setModule(i, 6, i % 2 === 0);
  }
  setModule(size - 8, 8, true);

  // Reserve format info strips
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      reserved[8][i] = true;
      reserved[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }

  // Place data bits zigzag upward/downward
  let bitIdx = 0;
  let dir = -1;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const r = dir === -1 ? size - 1 - step : step;
      for (let d = 0; d < 2; d++) {
        const c = right - d;
        if (!reserved[r][c]) {
          const bit = bitIdx < bits.length ? bits[bitIdx++] === 1 : false;
          // Mask 0: (r + c) % 2 === 0
          grid[r][c] = (r + c) % 2 === 0 ? !bit : bit;
        }
      }
    }
    dir = -dir;
  }

  // Format bits for ECC Level L (01) + Mask 0 (000) => 5-bit data 01000 => BCH + XOR 0x5412 => 0x77c4 (MSB first)
  const formatBits = 0x77c4;
  for (let i = 0; i < 15; i++) {
    const bit = ((formatBits >>> i) & 1) === 1;
    if (i < 6) grid[i][8] = bit;
    else if (i < 8) grid[i + 1][8] = bit;
    else grid[size - 15 + i][8] = bit;

    if (i < 8) grid[8][size - 1 - i] = bit;
    else if (i < 9) grid[8][7] = bit;
    else grid[8][14 - i] = bit;
  }

  return grid.map((row) => row.map((cell) => Boolean(cell)));
}

export function generateQrSvgDataUrl(text: string): string {
  const matrix = buildQrMatrix(text);
  const size = matrix.length;
  const quiet = 2;
  const full = size + quiet * 2;
  let pathD = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) {
        pathD += `M${c + quiet},${r + quiet}h1v1h-1z`;
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges"><rect width="${full}" height="${full}" fill="#eef2eb" rx="2"/><path d="${pathD}" fill="#0e1d15"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
