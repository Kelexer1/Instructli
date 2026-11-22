'use client';

import type { ReactNode } from 'react';
import {
  BLOCK_COUNT_OPTIONS,
  BLOCK_SIZE_OPTIONS,
  POLICY_LABELS,
  POLICY_OPTIONS,
  blockBaseFor,
  cacheSets,
  describeAccess,
  normalizeCacheConfig,
  usesReplacement,
  wayOptions,
  type AccessResult,
  type AddressBreakdown,
  type CacheConfig,
  type CacheSnapshot,
  type CacheType,
  type ReplacementPolicy,
} from '@/src/utils/sandbox-cache';

interface CachePaneProps {
  snapshot: CacheSnapshot;
  lastRead: AccessResult | null;
  lastInstruction: { address: number; text: string } | null;
  disabled: boolean;
  onConfigChange: (config: CacheConfig) => void;
}

const HIT = { bg: '#e9f2dd', fg: '#3f681b' };
const MISS = { bg: '#fef2f2', fg: '#7f1d1d' };
const UPDATED = '#6d28d9';

const selectClass = 'rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-gray-700 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60';

function hex(value: number) {
  return `0x${(value >>> 0).toString(16).padStart(8, '0')}`;
}

function binary(value: number, width: number) {
  return value.toString(2).padStart(width, '0');
}

function ConfigField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500">
      {label}
      {children}
    </label>
  );
}

function BreakdownBoxes({ breakdown, config }: { breakdown: AddressBreakdown; config: CacheConfig }) {
  const hasIndex = config.type !== 'fully-associative' && breakdown.indexBits > 0;
  const fields = [
    { label: 'Tag', bits: breakdown.tagBits, value: breakdown.tag, style: 'border-indigo-300 bg-indigo-50 text-indigo-800' },
    ...(hasIndex
      ? [{ label: 'Index', bits: breakdown.indexBits, value: breakdown.index, style: 'border-amber-300 bg-amber-50 text-amber-800' }]
      : []),
    ...(breakdown.blockOffsetBits > 0
      ? [{ label: 'Block offset', bits: breakdown.blockOffsetBits, value: breakdown.blockOffset, style: 'border-teal-300 bg-teal-50 text-teal-800' }]
      : []),
    { label: 'Byte offset', bits: breakdown.byteOffsetBits, value: breakdown.byteOffset, style: 'border-slate-300 bg-slate-50 text-slate-700' },
  ];

  return (
    <div className="flex flex-wrap items-stretch gap-1.5">
      {fields.map((field) => (
        <div key={field.label} className={`min-w-0 rounded border px-2 py-1 text-center flex flex-col items-center ${field.style}`}>
          <p className="text-[10px] font-semibold uppercase tracking-wide">
            {field.label} · {field.bits} {field.bits === 1 ? 'bit' : 'bits'}
          </p>
          <div className="flex flex-row gap-x-1">
            <p className="break-all font-mono text-xs">{binary(field.value, field.bits)}</p>
            <p className="text-[10px] opacity-70">= {field.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function LastAccessCard({
  lastRead,
  lastInstruction,
  config,
}: {
  lastRead: AccessResult | null;
  lastInstruction: CachePaneProps['lastInstruction'];
  config: CacheConfig;
}) {
  if (!lastInstruction) {
    return (
      <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-xs text-gray-400 h-[10rem]">
        Step or run the program to see how its memory reads use the cache.
      </p>
    );
  }

  const tone = lastRead ? (lastRead.hit ? HIT : MISS) : null;

  return (
    <div className="rounded-lg border border-slate-200 p-3 h-[10rem]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Last executed instruction</p>
          <p className="break-all font-mono text-xs text-gray-800">
            <span className="text-gray-400">{hex(lastInstruction.address)}</span> {lastInstruction.text}
          </p>
        </div>
        {tone && lastRead ? (
          <span
            className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold"
            style={{ backgroundColor: tone.bg, color: tone.fg }}
          >
            {lastRead.hit ? 'Hit' : 'Miss'}
          </span>
        ) : (
          <span className="shrink-0 text-[11px] text-gray-400">No memory read</span>
        )}
      </div>

      {lastRead && (
        <div className="mt-3 space-y-2">
          <p className="font-mono text-xs text-gray-600">
            Address {hex(lastRead.breakdown.address)}
            <span className="text-gray-400"> · {binary(lastRead.breakdown.address, 32)}</span>
          </p>
          <BreakdownBoxes breakdown={lastRead.breakdown} config={config} />
          <p className="text-xs leading-relaxed text-gray-600">{describeAccess(lastRead, config)}</p>
        </div>
      )}
    </div>
  );
}

function CacheTable({ snapshot, lastRead }: { snapshot: CacheSnapshot; lastRead: AccessResult | null }) {
  const { config, sets } = snapshot;
  const hasSetColumn = config.type === 'set-associative';
  const hasWayColumn = config.numWays > 1;
  const orderLabel = usesReplacement(config) && config.policy !== 'random' ? POLICY_LABELS[config.policy] : null;
  const indexLabel = config.type === 'direct-mapped' ? 'Index' : 'Set';
  const headerClass = 'pb-1.5 text-left text-[11px] font-semibold text-gray-400 border-b border-slate-200';
  const cellClass = 'border-b border-slate-100 px-1 py-1 text-xs text-gray-600';

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          {config.type !== 'fully-associative' && <th className={headerClass}>{indexLabel}</th>}
          {hasWayColumn && <th className={headerClass}>Way</th>}
          <th className={headerClass}>Valid</th>
          <th className={headerClass}>Tag</th>
          <th className={headerClass}>Block address range</th>
          {orderLabel && <th className={headerClass} title="Higher is newer; the lowest value in a set is evicted next.">{orderLabel}</th>}
        </tr>
      </thead>
      <tbody>
        {sets.map((set, setIndex) =>
          set.map((slot, way) => {
            const isLast = lastRead !== null && lastRead.breakdown.index === setIndex && lastRead.way === way;
            const rowTone = isLast ? (lastRead.hit ? HIT : { bg: '#f5f3ff', fg: UPDATED }) : null;
            const blockBase = blockBaseFor(slot.tag, setIndex, config);
            const blockEnd = blockBase + config.blockSizeWords * 4 - 1;

            return (
              <tr key={`${setIndex}-${way}`} style={rowTone ? { backgroundColor: rowTone.bg } : undefined}>
                {config.type !== 'fully-associative' && (hasSetColumn ? way === 0 : true) && (
                  <td className={`${cellClass} align-middle font-bold text-gray-800`} rowSpan={hasSetColumn ? config.numWays : 1}>
                    {setIndex}
                  </td>
                )}
                {hasWayColumn && <td className={cellClass}>{way}</td>}
                <td className={cellClass}>{slot.valid ? '1' : '0'}</td>
                <td className={`${cellClass} font-mono`} style={rowTone ? { color: rowTone.fg, fontWeight: 700 } : undefined}>
                  {slot.valid ? slot.tag : '–'}
                  {isLast && lastRead && !lastRead.hit ? ' ← new' : ''}
                </td>
                <td className={`${cellClass} font-mono text-[11px]`}>
                  {slot.valid ? `${hex(blockBase)} – ${hex(blockEnd)}` : '–'}
                </td>
                {orderLabel && <td className={`${cellClass} text-gray-400`}>{slot.valid ? slot.stamp : '–'}</td>}
              </tr>
            );
          }),
        )}
      </tbody>
    </table>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="font-mono text-sm font-semibold text-gray-800">{value}</p>
    </div>
  );
}

export default function CachePane({ snapshot, lastRead, lastInstruction, disabled, onConfigChange }: CachePaneProps) {
  const { config, sets, stats } = snapshot;
  const setCount = cacheSets(config);
  const blockBytes = config.blockSizeWords * 4;
  const filled = sets.reduce((total, set) => total + set.filter((slot) => slot.valid).length, 0);
  const hitRate = stats.accesses > 0 ? `${((stats.hits / stats.accesses) * 100).toFixed(1)}%` : '–';

  const change = (patch: Partial<CacheConfig>) => onConfigChange(normalizeCacheConfig({ ...config, ...patch }));

  function handleTypeChange(type: CacheType) {
    change({ type, numWays: type === 'set-associative' ? 2 : config.numWays });
  }

  const summary = config.type === 'direct-mapped'
    ? `${setCount} sets × 1 way`
    : config.type === 'fully-associative'
      ? `1 set × ${config.numBlocks} ways (${POLICY_LABELS[config.policy]})`
      : `${setCount} sets × ${config.numWays} ways (${POLICY_LABELS[config.policy]})`;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <ConfigField label="Type">
            <select className={selectClass} value={config.type} disabled={disabled} onChange={(event) => handleTypeChange(event.target.value as CacheType)}>
              <option value="direct-mapped">direct-mapped</option>
              <option value="set-associative">set-associative</option>
              <option value="fully-associative">fully-associative</option>
            </select>
          </ConfigField>
          <ConfigField label="Blocks">
            <select className={selectClass} value={config.numBlocks} disabled={disabled} onChange={(event) => change({ numBlocks: Number(event.target.value) })}>
              {BLOCK_COUNT_OPTIONS.filter((count) => config.type !== 'set-associative' || count >= 2).map((count) => (
                <option key={count} value={count}>{count}</option>
              ))}
            </select>
          </ConfigField>
          {config.type === 'set-associative' && (
            <ConfigField label="Ways">
              <select className={selectClass} value={config.numWays} disabled={disabled} onChange={(event) => change({ numWays: Number(event.target.value) })}>
                {wayOptions(config.numBlocks).map((ways) => (
                  <option key={ways} value={ways}>{ways}-way</option>
                ))}
              </select>
            </ConfigField>
          )}
          <ConfigField label="Block size">
            <select className={selectClass} value={config.blockSizeWords} disabled={disabled} onChange={(event) => change({ blockSizeWords: Number(event.target.value) })}>
              {BLOCK_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size} {size === 1 ? 'word' : 'words'}</option>
              ))}
            </select>
          </ConfigField>
          {usesReplacement(config) && (
            <ConfigField label="Replacement">
              <select className={selectClass} value={config.policy} disabled={disabled} onChange={(event) => change({ policy: event.target.value as ReplacementPolicy })}>
                {POLICY_OPTIONS.map((policy) => (
                  <option key={policy} value={policy}>{POLICY_LABELS[policy]}</option>
                ))}
              </select>
            </ConfigField>
          )}
        </div>
        {/* <p className="mt-2 text-[11px] text-gray-500">
          <span className="mr-1.5 inline-block rounded-full bg-[#f0f4ff] px-2.5 py-0.5 font-medium text-[#3b5bdb]">
            {summary} · block size {config.blockSizeWords} {config.blockSizeWords === 1 ? 'word' : 'words'} ({blockBytes} B)
          </span>
          Simulates data reads (loads) only. Changing the cache reloads the program.
        </p> */}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
        <LastAccessCard lastRead={lastRead} lastInstruction={lastInstruction} config={config} />
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-400">Cache state</p>
          <CacheTable snapshot={snapshot} lastRead={lastRead} />
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-3 gap-2 border-t border-slate-200 bg-slate-50 p-3">
        <Stat label="Reads" value={String(stats.accesses)} />
        <Stat label="Hits" value={String(stats.hits)} />
        <Stat label="Misses" value={String(stats.misses)} />
        <Stat label="Hit rate" value={hitRate} />
        <Stat label="Evictions" value={String(stats.evictions)} />
        <Stat label="Blocks filled" value={`${filled} / ${config.numBlocks}`} />
      </div>
    </div>
  );
}
