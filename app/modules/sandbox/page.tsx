'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, File, FileDown, FileUp, Play, RotateCcw, StepForward } from 'lucide-react';
import { recordAnalyticsVisit } from '@/src/utils/analytics';
import CodeEditor from '@/components/sandbox/CodeEditor';
import { assembleWasm, loadWasm, runWasm, stepWasm } from '@/src/utils/wasm-debugger';

export default function SandboxModule() {
  const [source, setSource] = useState('# Write a RISC-V program\n');
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [assemblyState, setAssemblyState] = useState<'none' | 'outdated' | 'current'>('none');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    recordAnalyticsVisit('sandbox');
  }, []);

  function updateSource(nextSource: string) {
    setSource(nextSource);
    setAssemblyState((current) => (current === 'none' ? 'none' : 'outdated'));
    setLoaded(false);
    setStatus(null);
  }

  async function handleAssemble() {
    setBusy(true);
    setStatus(null);
    try {
      await assembleWasm(source);
      setAssemblyState('current');
      setLoaded(false);
      setStatus('Assembly is up to date.');
    } catch (error) {
      setAssemblyState('outdated');
      setStatus(error instanceof Error ? error.message : 'Assembly failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleLoad() {
    setBusy(true);
    setStatus(null);
    try {
      await loadWasm();
      setLoaded(true);
      setStatus('Program loaded. Ready to run.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The program could not be loaded.');
    } finally {
      setBusy(false);
    }
  }

  async function handleExecution(action: () => Promise<number>) {
    setBusy(true);
    setStatus(null);
    try {
      await action();
      setStatus('Execution stopped.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The emulator could not execute the program.');
    } finally {
      setBusy(false);
    }
  }

  function saveSource() {
    const blob = new Blob([source], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'main.s';
    anchor.click();
    URL.revokeObjectURL(url);
    setFileMenuOpen(false);
  }

  function openFilePicker() {
    fileInputRef.current?.click();
    setFileMenuOpen(false);
  }

  async function readSourceFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      updateSource(await file.text());
      setStatus(`Loaded ${file.name} into the editor.`);
    } catch {
      setStatus('The selected file could not be read.');
    }
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 w-full flex-col px-6 py-6">
        {/* Navbar */}
        <div className="flex w-full flex-row items-start justify-between">
          <Link href="/" className="mb-6 inline-flex items-center gap-1 self-start text-sm text-gray-400 transition hover:text-gray-700">
            <ChevronLeft size={16} />
            All modules
          </Link>
          <div className="relative flex items-center gap-2">
            <input ref={fileInputRef} type="file" accept=".s,.asm,.txt,text/plain" onChange={readSourceFile} className="hidden" />
            <button type="button" onClick={() => setFileMenuOpen((open) => !open)} aria-expanded={fileMenuOpen} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-gray-600 transition hover:bg-slate-50">
              <File size={15} /> File
            </button>
            {fileMenuOpen && (
              <div className="absolute right-0 top-9 z-10 w-40 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
                <button type="button" onClick={openFilePicker} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50"><FileUp size={15} /> Open file</button>
                <button type="button" onClick={saveSource} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50"><FileDown size={15} /> Save file</button>
              </div>
            )}
            <button type="button" onClick={handleAssemble} disabled={busy} className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${assemblyState === 'current' ? 'border-green-300 bg-green-50 text-green-700' : assemblyState === 'outdated' ? 'border-yellow-300 bg-yellow-50 text-yellow-700' : 'border-slate-200 text-gray-600 hover:bg-slate-50'}`}>
              <RotateCcw size={15} /> Assemble
            </button>
            <button type="button" onClick={handleLoad} disabled={busy || assemblyState !== 'current'} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-gray-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Load</button>
            <button type="button" onClick={() => handleExecution(runWasm)} disabled={busy || !loaded} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-gray-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"><Play size={15} /> Run</button>
            <button type="button" onClick={() => handleExecution(stepWasm)} disabled={busy || !loaded} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-gray-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"><StepForward size={15} /> Step</button>
          </div>
        </div>
        {status && <p role="status" className="mb-3 text-right text-xs text-gray-500">{status}</p>}
        {/* Sandbox Environment */}
        <div className='flex min-h-0 h-full flex-1 flex-row'>
          {/* Editor Pane */}
          <div className='flex h-full w-[60%] min-w-0 flex-row'>
            {/* Register File */}
            <div className='w-[20%] shrink-0 rounded-l-xl border border-r-0 border-slate-200 bg-slate-50'>
            </div>
            {/* Code Input */}
            <CodeEditor value={source} onChange={updateSource} />
          </div>

          {/* Tool Pane */}
          <div className='ml-6 flex h-full min-h-0 w-[40%]'>

          </div>
        </div>
      </div>
    </main>
  );
}