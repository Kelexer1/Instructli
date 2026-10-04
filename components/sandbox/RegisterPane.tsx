'use client';

import { useState } from 'react';
import type { WasmRegister } from '@/src/utils/wasm-debugger';

interface RegisterPaneProps {
  registers: WasmRegister[];
  changedRegisters: ReadonlySet<number>;
  onChange: (registerNumber: number, value: number) => void;
}

const REGISTER_NAMES = [
  'zero',
  'ra',
  'sp',
  'gp',
  'tp',
  't0',
  't1',
  't2',
  's0/fp',
  's1',
  'a0',
  'a1',
  'a2',
  'a3',
  'a4',
  'a5',
  'a6',
  'a7',
  's2',
  's3',
  's4',
  's5',
  's6',
  's7',
  's8',
  's9',
  's10',
  's11',
  't3',
  't4',
  't5',
  't6',
];

function formatValue(value: number) {
  return `0x${value.toString(16).padStart(8, '0')}`;
}

export default function RegisterPane({ registers, changedRegisters, onChange }: RegisterPaneProps) {
  const [editingRegister, setEditingRegister] = useState<number | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  function startEditing(register: WasmRegister) {
    if (register.number === 0) return;
    setEditingRegister(register.number);
    setDraftValue(formatValue(register.value));
    setEditError(null);
  }

  function finishEditing(register: WasmRegister) {
    const normalized = draftValue.trim().toLowerCase().replace(/^0x/, '');
    if (!/^[0-9a-f]{1,8}$/.test(normalized)) {
      setEditError('Use 1-8 hexadecimal digits.');
      return;
    }

    onChange(register.number, Number.parseInt(normalized, 16) >>> 0);
    setEditingRegister(null);
    setEditError(null);
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-l-xl border border-slate-200 bg-slate-50">
      <div className="shrink-0 border-b border-slate-200 px-3 py-2">
        <h2 className="text-xs font-medium text-gray-700">Registers</h2>
        <p className="text-[11px] text-gray-400">Current register state</p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-2 font-mono text-xs">
        {registers.map((register) => (
          <div key={register.number} className={`flex items-center gap-2 px-3 py-1 text-gray-800 ${changedRegisters.has(register.number) ? 'bg-amber-100' : ''}`}>
            <span className="w-7 shrink-0">{`x${register.number}`}</span>
            <span className="min-w-0 flex-1 truncate text-gray-500">{REGISTER_NAMES[register.number]}</span>
            {editingRegister === register.number ? (
              <input
                autoFocus
                aria-label={`Value for x${register.number}`}
                aria-invalid={editError !== null}
                className="w-24 shrink-0 rounded border border-indigo-300 bg-white px-1 text-right text-indigo-700 outline-none"
                value={draftValue}
                onChange={(event) => setDraftValue(event.target.value)}
                onBlur={() => finishEditing(register)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') finishEditing(register);
                  if (event.key === 'Escape') {
                    setEditingRegister(null);
                    setEditError(null);
                  }
                }}
                title={editError ?? 'Enter a hexadecimal register value'}
              />
            ) : (
              <button
                type="button"
                disabled={register.number === 0}
                onClick={() => startEditing(register)}
                className="shrink-0 text-right text-indigo-700 disabled:cursor-default"
                title={register.number === 0 ? 'x0 is always zero' : 'Click to edit register value'}
              >
                {formatValue(register.value)}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
