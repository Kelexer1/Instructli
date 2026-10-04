'use client';

import type { WasmRegister } from '@/src/utils/wasm-debugger';

interface RegisterPaneProps {
  registers: WasmRegister[];
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

export default function RegisterPane({ registers }: RegisterPaneProps) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-l-xl border border-slate-200 bg-slate-50">
      <div className="shrink-0 border-b border-slate-200 px-3 py-2">
        <h2 className="text-xs font-medium text-gray-700">Registers</h2>
        <p className="text-[11px] text-gray-400">Current register state</p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-2 font-mono text-xs">
        {registers.map((register) => (
          <div key={register.number} className="flex items-center gap-2 px-3 py-1 text-gray-800">
            <span className="w-7 shrink-0">{`x${register.number}`}</span>
            <span className="min-w-0 flex-1 truncate text-gray-500">{REGISTER_NAMES[register.number]}</span>
            <span className="shrink-0 text-right text-indigo-700">{formatValue(register.value)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
