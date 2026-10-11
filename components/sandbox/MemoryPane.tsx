'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export type MemoryDisplayMode = 'bytes' | 'words' | 'ascii';

interface MemoryPaneProps {
  loaded: boolean;
  readValue: (address: number, size: number) => Promise<number>;
  writeValue: (address: number, size: number, value: number) => Promise<void>;
  onError: (message: string) => void;
}

const BYTES_PER_ROW = 16;
const ROW_COUNT = 32;
const PAGE_BYTES = BYTES_PER_ROW * ROW_COUNT;
const WINDOW_PAGES = 3;
const MAX_ADDRESS = 0xffffffff;

function parseAddress(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  const parsed = Number.parseInt(normalized.replace(/^0x/, ''), 16);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xffffffff ? parsed : null;
}

function formatAddress(address: number) {
  return `0x${(address >>> 0).toString(16).padStart(8, '0')}`;
}

function formatAscii(value: number) {
  return value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '·';
}

function formatValue(value: number, mode: MemoryDisplayMode) {
  if (mode === 'ascii') return formatAscii(value);
  return `0x${value.toString(16).padStart(mode === 'bytes' ? 2 : 8, '0')}`;
}

function valueSize(mode: MemoryDisplayMode) {
  return mode === 'words' ? 4 : 1;
}

export default function MemoryPane({ loaded, readValue, writeValue, onError }: MemoryPaneProps) {
  const [mode, setMode] = useState<MemoryDisplayMode>('bytes');
  const [addressText, setAddressText] = useState('0x00000000');
  const [windowStartAddress, setWindowStartAddress] = useState(0);
  const [values, setValues] = useState<Record<number, number | undefined>>({});
  const [editingAddress, setEditingAddress] = useState<number | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);
  const pendingScrollDelta = useRef<number | null>(null);

  const size = valueSize(mode);
  const cellCount = BYTES_PER_ROW / size;
  const addresses = useMemo(
    () => Array.from({ length: ROW_COUNT * WINDOW_PAGES * cellCount }, (_, index) => windowStartAddress + index * size),
    [cellCount, size, windowStartAddress],
  );

  useEffect(() => {
    let cancelled = false;
    if (!loaded) {
      return;
    }

    Promise.all(addresses.map(async (address) => {
      try {
        return [address, await readValue(address, size)] as const;
      } catch {
        return [address, undefined] as const;
      }
    })).then((entries) => {
      if (!cancelled) {
        setValues((current) => Object.fromEntries([...Object.entries(current), ...entries]));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [addresses, loaded, readValue, size]);

  useLayoutEffect(() => {
    const delta = pendingScrollDelta.current;
    const grid = gridRef.current;
    if (delta === null || !grid) return;
    grid.scrollTop += delta;
    pendingScrollDelta.current = null;
  }, [windowStartAddress]);

  function shiftWindow(nextStartAddress: number, grid: HTMLDivElement) {
    const nextPage = Math.min(
      Math.max(nextStartAddress - (nextStartAddress % PAGE_BYTES), 0),
      MAX_ADDRESS - PAGE_BYTES * WINDOW_PAGES + 1,
    );
    if (nextPage === windowStartAddress) return;
    const rows = Array.from(grid.querySelectorAll<HTMLTableRowElement>('tbody tr'));
    const pageHeight = rows
      .slice(0, ROW_COUNT)
      .reduce((height, row) => height + row.getBoundingClientRect().height, 0);
    pendingScrollDelta.current = nextPage > windowStartAddress ? -pageHeight : pageHeight;
    setWindowStartAddress(nextPage);
    setValues((current) => Object.fromEntries(
      Object.entries(current).filter(([address]) => {
        const numericAddress = Number(address);
        return numericAddress >= nextPage && numericAddress < nextPage + PAGE_BYTES * WINDOW_PAGES;
      }),
    ));
  }

  function handleGridScroll(event: React.UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    const rows = Array.from(element.querySelectorAll<HTMLTableRowElement>('tbody tr'));
    const pageHeight = rows
      .slice(0, ROW_COUNT)
      .reduce((height, row) => height + row.getBoundingClientRect().height, 0);
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < pageHeight / 3;
    const nearTop = element.scrollTop < pageHeight / 3;
    if (nearBottom && windowStartAddress <= MAX_ADDRESS - PAGE_BYTES * (WINDOW_PAGES + 1)) {
      shiftWindow(windowStartAddress + PAGE_BYTES, element);
    } else if (nearTop && windowStartAddress >= PAGE_BYTES) {
      shiftWindow(windowStartAddress - PAGE_BYTES, element);
    }
  }

  function navigate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseAddress(addressText);
    if (parsed === null) {
      onError('Enter a valid hexadecimal address.');
      return;
    }
    setWindowStartAddress(Math.max(parsed - (parsed % PAGE_BYTES) - PAGE_BYTES, 0));
    setValues({});
  }

  function beginEditing(address: number, value: number) {
    setEditingAddress(address);
    setDraftValue(mode === 'ascii' ? (value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '') : formatValue(value, mode));
  }

  async function finishEditing(address: number) {
    const normalized = draftValue.trim();
    let value: number | null;
    if (mode === 'ascii') {
      value = normalized.length === 1 ? normalized.charCodeAt(0) : null;
    } else {
      const digits = normalized.toLowerCase().replace(/^0x/, '');
      const maxDigits = mode === 'bytes' ? 2 : 8;
      value = new RegExp(`^[0-9a-f]{1,${maxDigits}}$`).test(digits) ? Number.parseInt(digits, 16) : null;
    }

    if (value === null) {
      onError(mode === 'ascii' ? 'Enter one ASCII character.' : `Enter a valid ${mode === 'bytes' ? 'byte' : 'word'} value.`);
      return;
    }

    try {
      await writeValue(address, size, value);
      setValues((current) => ({ ...current, [address]: value }));
      setEditingAddress(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Memory could not be updated.');
    }
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-medium text-gray-700">Memory</h2>
            <p className="text-[11px] text-gray-400">Click a value to edit it</p>
          </div>
          <div className="flex items-center gap-1">
            {(['bytes', 'words', 'ascii'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMode(option)}
                className={`rounded border px-2 py-1 text-[11px] capitalize ${mode === option ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-gray-500 hover:bg-white'}`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
        <form onSubmit={navigate} className="mt-2 flex gap-2">
          <label htmlFor="memory-address" className="sr-only">Memory address</label>
          <input
            id="memory-address"
            value={addressText}
            onChange={(event) => setAddressText(event.target.value)}
            className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 py-1 font-mono text-xs outline-none focus:border-indigo-400"
            placeholder="0x00000000"
          />
          <button type="submit" className="rounded border border-indigo-200 px-2 py-1 text-[11px] text-indigo-700 hover:bg-indigo-50">Go</button>
        </form>
      </div>
      <div ref={gridRef} onScroll={handleGridScroll} className="memory-scrollbar min-h-0 flex-1 overflow-auto font-mono text-xs">
        {!loaded ? (
          <p className="p-4 text-gray-400">Load a program to browse its memory.</p>
        ) : (
          <table className="min-w-full border-collapse">
            <thead className="sticky top-0 bg-white text-[10px] text-gray-400">
              <tr>
                <th className="sticky left-0 bg-white px-3 py-2 text-left font-normal">Address</th>
                {Array.from({ length: cellCount }, (_, index) => <th key={index} className="px-2 py-2 text-center font-normal">+{(index * size).toString(16).padStart(2, '0')}</th>)}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: ROW_COUNT * WINDOW_PAGES }, (_, row) => (
                <tr key={row} className="border-t border-slate-100">
                  <th className="sticky left-0 bg-white px-3 py-1.5 text-left font-normal text-gray-400">{formatAddress(windowStartAddress + row * BYTES_PER_ROW)}</th>
                  {Array.from({ length: cellCount }, (_, column) => {
                    const index = row * cellCount + column;
                    const address = addresses[index];
                    const value = values[address];
                    return (
                      <td key={address} className="px-1 py-1 text-center">
                        {editingAddress === address ? (
                          <input
                            autoFocus
                            value={draftValue}
                            onChange={(event) => setDraftValue(event.target.value)}
                            onBlur={() => void finishEditing(address)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') void finishEditing(address);
                              if (event.key === 'Escape') setEditingAddress(null);
                            }}
                            aria-label={`Edit memory at ${formatAddress(address)}`}
                            className="w-16 rounded border border-indigo-300 px-1 text-center text-indigo-700 outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => beginEditing(address, value ?? 0)}
                            disabled={value === undefined}
                            className="min-w-12 rounded px-1.5 py-1 text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                            title={`Edit ${formatAddress(address)}`}
                          >
                            {value === undefined ? '??' : formatValue(value, mode)}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
