'use client';

import { useRef } from 'react';
import type { DisassemblyInstruction } from '@/src/utils/wasm-debugger';

interface DisassemblyPaneProps {
  instructions: DisassemblyInstruction[];
  justExecutedAddress: number | null;
  nextAddress: number | null;
  onGoToJustExecuted: () => void;
  onGoToNext: () => void;
  breakpoints: ReadonlySet<number>;
  onToggleBreakpoint: (address: number) => void;
}

function formatAddress(address: number) {
  return `0x${address.toString(16).padStart(8, '0')}`;
}

export default function DisassemblyPane({
  instructions,
  justExecutedAddress,
  nextAddress,
  onGoToJustExecuted,
  onGoToNext,
  breakpoints,
  onToggleBreakpoint,
}: DisassemblyPaneProps) {
  const rowRefs = useRef(new Map<number, HTMLDivElement>());

  function goTo(address: number | null) {
    if (address === null) return;
    rowRefs.current.get(address)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex h-11 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-4">
        <div>
          <h2 className="text-xs font-medium text-gray-700">Disassembly</h2>
          <p className="text-[11px] text-gray-400">{instructions.length} instructions</p>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            disabled={justExecutedAddress === null}
            onClick={() => {
              goTo(justExecutedAddress);
              onGoToJustExecuted();
            }}
            className="rounded border border-amber-200 px-2 py-1 text-[11px] text-amber-700 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Just executed
          </button>
          <button
            type="button"
            disabled={nextAddress === null}
            onClick={() => {
              goTo(nextAddress);
              onGoToNext();
            }}
            className="rounded border border-indigo-200 px-2 py-1 text-[11px] text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-auto py-2 font-mono text-xs">
        {instructions.length === 0 ? (
          <p className="px-4 py-3 text-gray-400">Assemble a program to view its disassembly.</p>
        ) : (
          instructions.map((instruction) => {
            const isJustExecuted = instruction.address === justExecutedAddress;
            const isNext = instruction.address === nextAddress;
            return (
              <div
                key={instruction.address}
                ref={(element) => {
                  if (element) rowRefs.current.set(instruction.address, element);
                  else rowRefs.current.delete(instruction.address);
                }}
                className={`flex min-h-7 items-center gap-2 border-l-2 px-3 ${
                  isJustExecuted
                    ? 'border-amber-400 bg-amber-50'
                    : isNext
                      ? 'border-indigo-400 bg-indigo-50'
                      : 'border-transparent'
                }`}
              >
                <span className="w-20 shrink-0 text-right text-gray-400">{formatAddress(instruction.address)}</span>
                <button
                  type="button"
                  aria-label={`${breakpoints.has(instruction.address) ? 'Remove' : 'Add'} breakpoint at ${formatAddress(instruction.address)}`}
                  aria-pressed={breakpoints.has(instruction.address)}
                  onClick={() => onToggleBreakpoint(instruction.address)}
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${breakpoints.has(instruction.address) ? 'bg-red-500' : 'bg-transparent hover:bg-red-200'}`}
                />
                <span className="min-w-0 flex-1 truncate text-gray-800">{instruction.text}</span>
                <span className="flex w-[42%] min-w-0 items-center gap-2 truncate text-gray-400" title={instruction.sourceText ?? undefined}>
                  <span aria-hidden="true" className="shrink-0 text-gray-500">#</span>
                  <span className="truncate">{instruction.sourceText ?? 'original unavailable'}</span>
                </span>
                {isJustExecuted && <span className="ml-auto shrink-0 text-[10px] text-amber-700">executed</span>}
                {isNext && <span className="ml-auto shrink-0 text-[10px] text-indigo-700">next</span>}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
