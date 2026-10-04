'use client';

import { useEffect, useRef } from 'react';
import type { WasmOutput } from '@/src/utils/wasm-debugger';

interface TerminalPaneProps {
  output: WasmOutput[];
}

export default function TerminalPane({ output }: TerminalPaneProps) {
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [output]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-sm">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-4 py-2 text-xs">
        <h2 className="font-medium text-slate-200">Terminal</h2>
        <span className="text-slate-500">emulator output</span>
      </div>
      <div
        role="log"
        aria-live="polite"
        className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs leading-5"
      >
        {output.length === 0 ? (
          <p className="text-slate-500">Assembler and emulator output will appear here.</p>
        ) : (
          output.map((entry, index) => (
            <div key={`${index}-${entry.stream}`} className={entry.stream === 'stderr' ? 'text-red-300' : 'text-slate-200'}>
              <span className="mr-2 select-none text-slate-500">{entry.stream === 'stderr' ? 'stderr' : 'stdout'}$</span>
              <span className="whitespace-pre-wrap break-words">{entry.text}</span>
            </div>
          ))
        )}
        <div ref={terminalEndRef} />
      </div>
    </section>
  );
}
