'use client';

import { useMemo, useRef, useState } from 'react';
import { syncWasmBreakpoints } from '@/src/utils/wasm-debugger';

const INDENT = '  ';

interface CodeEditorProps {
  initialValue?: string;
  value?: string;
  onChange?: (value: string) => void;
}

export default function CodeEditor({ initialValue = '', value: controlledValue, onChange }: CodeEditorProps) {
  const [localValue, setLocalValue] = useState(initialValue);
  const value = controlledValue ?? localValue;
  const [breakpoints, setBreakpoints] = useState<Set<number>>(() => new Set());
  const [wasmError, setWasmError] = useState<string | null>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => value.split('\n'), [value]);

  function updateValue(nextValue: string) {
    if (controlledValue === undefined) setLocalValue(nextValue);
    onChange?.(nextValue);
    setWasmError(null);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Tab') return;

    event.preventDefault();
    const textarea = event.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end);
    const replacement = event.shiftKey
      ? selected.replace(/^ {1,2}/gm, '')
      : selected.includes('\n')
        ? selected.replace(/^/gm, INDENT)
        : INDENT;

    const nextValue = value.slice(0, start) + replacement + value.slice(end);
    updateValue(nextValue);
    requestAnimationFrame(() => {
      const nextPosition = event.shiftKey ? start : start + replacement.length;
      textarea.setSelectionRange(nextPosition, nextPosition);
    });
  }

  async function toggleBreakpoint(line: number) {
    const nextBreakpoints = new Set(breakpoints);
    if (nextBreakpoints.has(line)) nextBreakpoints.delete(line);
    else nextBreakpoints.add(line);
    setBreakpoints(nextBreakpoints);

    try {
      await syncWasmBreakpoints(value, [...nextBreakpoints].sort((a, b) => a - b));
    } catch (error) {
      setWasmError(error instanceof Error ? error.message : 'The emulator could not be updated.');
    }
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs text-gray-400">
        <span className="font-medium text-gray-700">main.s</span>
        <span>{lines.length} {lines.length === 1 ? 'line' : 'lines'}</span>
      </div>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div
          ref={lineNumbersRef}
          aria-hidden="true"
          className="editor-scrollbar w-16 shrink-0 overflow-hidden border-r border-gray-100 bg-gray-50 py-4 text-right font-mono text-sm leading-6 text-gray-400"
        >
          {lines.map((_, index) => {
            const line = index + 1;
            return (
              <button
                key={line}
                type="button"
                aria-label={`${breakpoints.has(line) ? 'Remove' : 'Add'} breakpoint on line ${line}`}
                aria-pressed={breakpoints.has(line)}
                onClick={() => toggleBreakpoint(line)}
                className={`flex h-6 w-full items-center justify-end gap-2 pr-3 transition-colors hover:bg-gray-100 ${
                  breakpoints.has(line) ? 'text-red-500' : ''
                }`}
              >
                {breakpoints.has(line) && <span className="h-2.5 w-2.5 rounded-full bg-red-500" />}
                {line}
              </button>
            );
          })}
        </div>

        <textarea
          value={value}
          spellCheck={false}
          wrap="off"
          aria-label="Assembly source code"
          onChange={(event) => updateValue(event.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={(event) => {
            if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = event.currentTarget.scrollTop;
          }}
          className="min-h-0 min-w-0 flex-1 resize-none overflow-auto bg-white p-4 font-mono text-sm leading-6 text-gray-800 outline-none placeholder:text-gray-400"
          placeholder="# Enter RISC-V assembly here"
        />
      </div>

      {wasmError && (
        <p role="status" className="border-t border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-700">
          Breakpoint preview updated locally. {wasmError}
        </p>
      )}
    </section>
  );
}
