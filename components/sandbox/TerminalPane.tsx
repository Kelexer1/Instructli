'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import type { WasmOutput } from '@/src/utils/wasm-debugger';

interface TerminalPaneProps {
  output: WasmOutput[];
  onInput: (input: string) => void;
  disabled?: boolean;
}

export default function TerminalPane({ output, onInput, disabled = false }: TerminalPaneProps) {
  const terminalLogRef = useRef<HTMLDivElement>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');

  useEffect(() => {
    const animationFrame = requestAnimationFrame(() => {
      const log = terminalLogRef.current;
      if (log) log.scrollTop = log.scrollHeight;
      terminalEndRef.current?.scrollIntoView({ block: 'end' });
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [output]);

  function submitInput(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input.trim()) return;
    onInput(input);
    setInput('');
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex shrink-0 items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs">
        <h2 className="font-medium text-gray-700">Terminal</h2>
      </div>
      <div
        ref={terminalLogRef}
        role="log"
        aria-live="polite"
        className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs leading-5 text-gray-800"
      >
        {output.length === 0 ? (
          <p className="text-gray-400">Assembler and emulator output will appear here.</p>
        ) : (
          output.map((entry, index) => (
            <div key={`${index}-${entry.stream}`} className={entry.stream === 'stderr' ? 'text-red-600' : entry.stream === 'stdin' ? 'text-indigo-700' : 'text-gray-800'}>
              <span className="mr-2 select-none text-gray-400">{entry.stream}$</span>
              <span className="whitespace-pre-wrap break-words">{entry.text}</span>
            </div>
          ))
        )}
        <div ref={terminalEndRef} />
      </div>
      <form onSubmit={submitInput} className="flex shrink-0 gap-2 border-t border-gray-100 bg-gray-50 p-3">
        <label htmlFor="terminal-input" className="sr-only">Program input</label>
        <input
          id="terminal-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={disabled}
          placeholder="Input for the next read..."
          className="min-w-0 flex-1 rounded border border-gray-200 bg-white px-2 py-1.5 font-mono text-xs text-gray-800 outline-none placeholder:text-gray-400 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-gray-100"
        />
        <button type="submit" disabled={disabled || !input.trim()} className="rounded border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40">
          Send
        </button>
      </form>
    </section>
  );
}
