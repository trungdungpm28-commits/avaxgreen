'use client';

import {useMemo} from 'react';
import type {Leaf} from 'lucide-react';
import type {OnChainActivityItem} from '../lib/onchain';
import {fmt} from '../lib/types';

export function Metric({
  label,
  value,
  unit,
  icon: Icon,
  note,
  sub,
}: {
  label: string;
  value: string;
  unit: string;
  icon: typeof Leaf;
  note: string;
  sub: string;
}) {
  return (
    <section className="metric">
      <div>
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
      <p>
        <span>{note}</span>
        {sub}
      </p>
    </section>
  );
}

export function OnChainChart({
  activity,
  totalMinted,
  totalRetired,
}: {
  activity: OnChainActivityItem[];
  totalMinted: number;
  totalRetired: number;
}) {
  const points = useMemo(() => {
    const asc = [...activity].reverse();
    let cumMinted = 0;
    let cumRetired = 0;
    const series: Array<{label: string; minted: number; retired: number}> = [
      {label: 'Khởi tạo', minted: 0, retired: 0},
    ];

    for (const item of asc) {
      if (item.type === 'Minted') cumMinted += item.amountKg;
      if (item.type === 'Retired') cumRetired += item.amountKg;
      if (item.type === 'Minted' || item.type === 'Retired') {
        series.push({
          label: item.timestamp
            ? new Date(item.timestamp * 1000).toLocaleTimeString('vi-VN', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : `#${item.blockNumber.toString().slice(-4)}`,
          minted: cumMinted,
          retired: cumRetired,
        });
      }
    }

    if (series.length === 1 && (totalMinted > 0 || totalRetired > 0)) {
      series.push({label: 'Hiện tại', minted: totalMinted, retired: totalRetired});
    } else if (series.length === 1) {
      series.push({label: 'Hiện tại', minted: 0, retired: 0});
    }
    return series.slice(-10);
  }, [activity, totalMinted, totalRetired]);

  const maxVal = Math.max(
    100,
    totalMinted,
    totalRetired,
    ...points.map((p) => Math.max(p.minted, p.retired))
  );
  const ceil = Math.ceil(maxVal * 1.15);

  const toCoords = (key: 'minted' | 'retired') =>
    points.map((p, idx) => {
      const x = points.length === 1 ? 620 : Math.round((idx / (points.length - 1)) * 620);
      const y = Math.round(162 - (p[key] / ceil) * 148);
      return `${x} ${y}`;
    });

  const mintedCoords = toCoords('minted');
  const retiredCoords = toCoords('retired');
  const mintedPath = `M${mintedCoords.join(' L')}`;
  const areaPath = `${mintedPath} L620 175 L0 175 Z`;
  const retiredPath = `M${retiredCoords.join(' L')}`;
  const lastMintedY = mintedCoords[mintedCoords.length - 1]?.split(' ')[1] || '162';

  return (
    <div className="chart">
      <div className="chart-y">
        <span>{fmt(ceil, 0)}</span>
        <span>{fmt(Math.round((ceil * 2) / 3), 0)}</span>
        <span>{fmt(Math.round(ceil / 3), 0)}</span>
        <span>0</span>
      </div>
      <div className="chart-plot">
        <svg
          viewBox="0 0 620 175"
          preserveAspectRatio="none"
          role="img"
          aria-label="Biểu đồ sản lượng CO2 on-chain"
        >
          <defs>
            <linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#a7df77" stopOpacity=".21" />
              <stop offset="100%" stopColor="#a7df77" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[14, 63, 112, 162].map((y) => (
            <line
              key={y}
              x1="0"
              x2="620"
              y1={y}
              y2={y}
              stroke="#26322e"
              strokeDasharray="3 5"
            />
          ))}
          <path d={areaPath} fill="url(#chartFill)" />
          <path d={mintedPath} fill="none" stroke="#b8ed88" strokeWidth="2.5" />
          <path
            d={retiredPath}
            fill="none"
            stroke="#4b9685"
            strokeWidth="2"
            strokeDasharray="5 5"
          />
          <circle cx="620" cy={lastMintedY} r="4" fill="#c3f79a" />
        </svg>
        <div className="chart-x">
          {points.map((p, i) => (
            <span key={i}>{p.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SolarScene() {
  return (
    <div className="solar-scene" aria-hidden="true">
      <svg viewBox="0 0 650 390">
        <defs>
          <radialGradient id="halo">
            <stop offset="0" stopColor="#b7d684" stopOpacity=".19" />
            <stop offset="1" stopColor="#7eac62" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="roof" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#63816c" />
            <stop offset="1" stopColor="#2b493c" />
          </linearGradient>
          <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#608b94" />
            <stop offset=".5" stopColor="#294e61" />
            <stop offset="1" stopColor="#193b4c" />
          </linearGradient>
          <linearGradient id="wall">
            <stop stopColor="#a9b3a0" />
            <stop offset="1" stopColor="#647c69" />
          </linearGradient>
          <filter id="shadow">
            <feGaussianBlur stdDeviation="14" />
          </filter>
        </defs>
        <circle cx="340" cy="180" r="210" fill="url(#halo)" />
        <g stroke="#60825f" fill="none" opacity=".25">
          <ellipse cx="345" cy="265" rx="260" ry="106" />
          <ellipse cx="345" cy="265" rx="210" ry="84" />
          <path d="M120 340 L565 150 M145 130 L575 330" strokeDasharray="3 7" />
        </g>
        <ellipse cx="355" cy="300" rx="185" ry="45" fill="#000" opacity=".4" filter="url(#shadow)" />
        <path d="M142 252 L350 157 L567 259 L358 365 Z" fill="#203c2b" stroke="#4b6a44" />
        <path d="M142 252 L358 354 L567 259 L567 274 L358 374 L142 268Z" fill="#182c24" />
        <path d="M224 215 L371 151 L480 214 L335 281 Z" fill="#c9d0b3" />
        <path d="M224 215 L335 274 L335 327 L224 267 Z" fill="url(#wall)" />
        <path d="M335 274 L480 208 L480 267 L335 327Z" fill="#748a75" />
        <path d="M205 214 L351 133 L497 207 L335 285Z" fill="url(#roof)" stroke="#99aa82" />
        <path d="M205 214 L335 279 L497 207 L497 214 L335 291 L205 221Z" fill="#3e5c4a" />
        {[0, 1, 2].map((row) =>
          [0, 1, 2, 3].map((col) => {
            const x = 237 + col * 32 + row * 27;
            const y = 208 - col * 17 + row * 14;
            return (
              <g key={`${row}${col}`}>
                <path
                  d={`M${x} ${y} l28 -15 25 13 -28 15Z`}
                  fill="url(#panel)"
                  stroke="#8aaeb1"
                  strokeWidth="1.2"
                />
                <path
                  d={`M${x + 9} ${y - 5} l25 13 m-16 -18 l25 13 m-31 -3 l28 -15`}
                  stroke="#8cb4bb"
                  strokeWidth=".45"
                  opacity=".8"
                />
              </g>
            );
          })
        )}
        <path d="M248 252 l22 12 v29 l-22 -12Z" fill="#344c40" stroke="#80947d" />
        <path d="M286 273 l21 11 v18 l-21 -11Z" fill="#749ea0" stroke="#c0c9af" />
        <path
          d="M353 281 l25 -12 v25 l-25 12Z M404 257 l25 -12 v25 l-25 12Z M446 237 l20 -10 v25 l-20 10Z"
          fill="#35535a"
          stroke="#b0bda5"
        />
        {[
          [178, 233],
          [513, 263],
          [467, 304],
        ].map(([x, y], i) => (
          <g key={i}>
            <path d={`M${x} ${y + 12} v-43`} stroke="#8d9a61" strokeWidth="5" />
            <path d={`M${x - 19} ${y - 19} l19 -48 20 48Z`} fill="#5b8150" />
            <path d={`M${x - 24} ${y - 3} l24 -48 25 48Z`} fill="#759455" />
            <path d={`M${x - 27} ${y + 9} l27 -42 28 42Z`} fill="#507044" />
          </g>
        ))}
        <g stroke="#c7e396" strokeWidth="1.3" fill="none">
          <circle cx="489" cy="99" r="19" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <path key={a} d="M489 70 v-7" transform={`rotate(${a} 489 99)`} />
          ))}
        </g>
        <path
          d="M474 128 L442 160 M489 138 L464 169"
          stroke="#bdd98c"
          opacity=".4"
          strokeDasharray="4 5"
        />
      </svg>
    </div>
  );
}
