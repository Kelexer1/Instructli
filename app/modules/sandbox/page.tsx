'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, File, FileDown, FileUp, Play, RotateCcw, StepForward } from 'lucide-react';
import { recordAnalyticsVisit } from '@/src/utils/analytics';
import CodeEditor from '@/components/sandbox/CodeEditor';
import DisassemblyPane from '@/components/sandbox/DisassemblyPane';
import RegisterPane from '@/components/sandbox/RegisterPane';
import TerminalPane from '@/components/sandbox/TerminalPane';
import { WindowTabs } from '@/components/WindowTabs';
import {
  assembleWasm,
  drainWasmOutput,
  loadWasm,
  readWasmDebugState,
  readWasmAddressForLine,
  addWasmBreakpoint,
  removeWasmBreakpoint,
  readWasmLastExecutedAddress,
  readWasmLastWrittenRegister,
  readWasmExitCode,
  readWasmProgramCounter,
  readWasmRegisters,
  writeWasmRegister,
  provideWasmInput,
  resumeWasm,
  resetWasmInput,
  runWasm,
  stepWasm,
  WASM_STOP_BREAKPOINT,
  WASM_STOP_EBREAK,
  WASM_STOP_EXITED,
  type WasmRegister,
  type WasmOutput,
  type DisassemblyInstruction,
} from '@/src/utils/wasm-debugger';

export default function SandboxModule() {
  const [source, setSource] = useState('# Write a RISC-V program\n');
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [assemblyState, setAssemblyState] = useState<'none' | 'outdated' | 'current'>('none');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<DisassemblyInstruction[]>([]);
  const [justExecutedAddress, setJustExecutedAddress] = useState<number | null>(null);
  const [nextAddress, setNextAddress] = useState<number | null>(null);
  const [breakpointAddresses, setBreakpointAddresses] = useState<ReadonlySet<number>>(new Set());
  const [terminalOutput, setTerminalOutput] = useState<WasmOutput[]>([]);
  const [registers, setRegisters] = useState<WasmRegister[]>(
    () => Array.from({ length: 32 }, (_, number) => ({ number, value: 0 })),
  );
  const [changedRegisters, setChangedRegisters] = useState<ReadonlySet<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    recordAnalyticsVisit('sandbox');
  }, []);

  function updateSource(nextSource: string) {
    setSource(nextSource);
    setAssemblyState((current) => (current === 'none' ? 'none' : 'outdated'));
    setLoaded(false);
    setInstructions([]);
    setJustExecutedAddress(null);
    setNextAddress(null);
    setChangedRegisters(new Set());
    setStatus(null);
  }

  function flushTerminalOutput() {
    const output = drainWasmOutput();
    if (output.length > 0) setTerminalOutput((current) => [...current, ...output]);
  }

  async function handleAssemble() {
    setBusy(true);
    setStatus(null);
    setTerminalOutput([]);
    try {
      await assembleWasm(source);
      await resetWasmInput();
      const debugState = await readWasmDebugState(source);
      const nextRegisters = await readWasmRegisters();
      setInstructions(debugState.instructions);
      setRegisters(nextRegisters);
      setChangedRegisters(new Set());
      setJustExecutedAddress(null);
      setNextAddress(debugState.currentAddress);
      setBreakpointAddresses(new Set());
      setAssemblyState('current');
      setLoaded(false);
      setStatus('Assembly is up to date.');
    } catch (error) {
      setAssemblyState('outdated');
      setStatus(error instanceof Error ? error.message : 'Assembly failed.');
    } finally {
      flushTerminalOutput();
      setBusy(false);
    }
  }

  async function handleLoad() {
    setBusy(true);
    setStatus(null);
    setTerminalOutput([]);
    try {
      await loadWasm();
      await resetWasmInput();
      const debugState = await readWasmDebugState(source);
      const nextRegisters = await readWasmRegisters();
      setInstructions(debugState.instructions);
      setRegisters(nextRegisters);
      setChangedRegisters(new Set());
      setJustExecutedAddress(null);
      setNextAddress(debugState.currentAddress);
      setLoaded(true);
      setStatus('Program loaded. Ready to run.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The program could not be loaded.');
    } finally {
      flushTerminalOutput();
      setBusy(false);
    }

  }

  async function toggleBreakpointAddress(address: number) {
    const next = new Set(breakpointAddresses);
    if (next.has(address)) {
      await removeWasmBreakpoint(address);
      next.delete(address);
    } else {
      await addWasmBreakpoint(address);
      next.add(address);
    }
    setBreakpointAddresses(next);
  }

  async function toggleBreakpointLine(line: number) {
    const address = await readWasmAddressForLine(line);
    if (address === null) {
      setStatus(`No executable instruction was found on or after line ${line}.`);
      return;
    }
    await toggleBreakpointAddress(address);
  }

  async function handleTerminalInput(input: string) {
    setBusy(true);
    try {
      await provideWasmInput(input);
      setTerminalOutput((current) => [...current, { stream: 'stdin', text: `${input}\n` }]);
      await resumeWasm();
      await handleExecution(runWasm);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Input could not be sent to the emulator.');
      setBusy(false);
    }
  }

  async function handleExecution(action: () => Promise<number>) {
    setBusy(true);
    setStatus(null);
    try {
      const stopReason = await action();
      flushTerminalOutput();
      const executedAddress = await readWasmLastExecutedAddress();
      const currentAddress = await readWasmProgramCounter();
      const nextRegisters = await readWasmRegisters();
      const lastWrittenRegister = await readWasmLastWrittenRegister();
      const changedRegister = lastWrittenRegister !== null
        && nextRegisters[lastWrittenRegister]?.value !== registers[lastWrittenRegister]?.value
        ? lastWrittenRegister
        : null;
      setChangedRegisters(changedRegister === null ? new Set() : new Set([changedRegister]));
      setRegisters(nextRegisters);
      setJustExecutedAddress(executedAddress);
      setNextAddress(currentAddress);
      if (stopReason === WASM_STOP_BREAKPOINT) {
        setStatus('Program hit breakpoint.');
      } else if (stopReason === WASM_STOP_EBREAK) {
        setStatus('Program hit ebreak.');
      } else if (stopReason === WASM_STOP_EXITED) {
        const exitCode = await readWasmExitCode();
        setStatus(`Program exited with code ${exitCode}.`);
      } else {
        setStatus('Execution stopped.');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The emulator could not execute the program.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRegisterChange(registerNumber: number, value: number) {
    try {
      await writeWasmRegister(registerNumber, value);
      const nextRegisters = await readWasmRegisters();
      setRegisters(nextRegisters);
      setChangedRegisters(new Set());
      setStatus(`Updated x${registerNumber}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The register could not be updated.');
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
      <div className="flex min-h-0 flex-1 w-full flex-col px-6 py-4">
        {/* Navbar */}
        <div className="flex w-full flex-row items-center gap-x-6 pb-4">
          <Link href="/" className="inline-flex items-center gap-1 text-sm text-gray-400 transition hover:text-gray-700">
            <ChevronLeft size={16} />
            All modules
          </Link>
          <div className="relative flex items-center gap-2">
            <input ref={fileInputRef} type="file" accept=".s,.asm,.txt,text/plain" onChange={readSourceFile} className="hidden" />
            <button type="button" onClick={() => setFileMenuOpen((open) => !open)} aria-expanded={fileMenuOpen} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-gray-600 transition hover:bg-slate-50">
              <File size={15} /> File
            </button>
            {fileMenuOpen && (
              <div className="absolute left-0 top-9 z-10 w-40 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
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
            <div className="flex w-[20%] min-w-0 shrink-0">
              <RegisterPane
                registers={registers}
                changedRegisters={changedRegisters}
                onChange={handleRegisterChange}
              />
            </div>
            <WindowTabs
              className="ml-6 min-h-0 min-w-0 flex-1"
              panelClassName="flex min-h-0 p-0"
              ariaLabel="Editor windows"
              tabs={[
                {
                  id: 'text-editor',
                  label: 'Text editor',
                  content: (
                    <CodeEditor
                      value={source}
                      onChange={updateSource}
                      breakpointLines={new Set(
                        instructions
                          .filter(
                            (instruction): instruction is DisassemblyInstruction & { sourceLine: number } =>
                              breakpointAddresses.has(instruction.address) && instruction.sourceLine !== null,
                          )
                          .map((instruction) => instruction.sourceLine),
                      )}
                      onToggleBreakpoint={(line) => {
                        void toggleBreakpointLine(line).catch((error) =>
                          setStatus(error instanceof Error ? error.message : 'The breakpoint could not be updated.'),
                        );
                      }}
                    />
                  ),
                },
                {
                  id: 'disassembly',
                  label: 'Disassembly',
                  content: (
                    <DisassemblyPane
                      instructions={instructions}
                      justExecutedAddress={justExecutedAddress}
                      nextAddress={nextAddress}
                      onGoToJustExecuted={() => setStatus('Showing the instruction that just executed.')}
                      onGoToNext={() => setStatus('Showing the next instruction to execute.')}
                      breakpoints={breakpointAddresses}
                      onToggleBreakpoint={(address) => {
                        void toggleBreakpointAddress(address).catch((error) =>
                          setStatus(error instanceof Error ? error.message : 'The breakpoint could not be updated.'),
                        );
                      }}
                    />
                  ),
                },
              ]}
            />
          </div>

          {/* Tool Pane */}
          <div className="ml-6 flex h-full min-h-0 w-[40%]">
            <WindowTabs
              className="min-h-0 min-w-0 flex-1"
              panelClassName="flex min-h-0 p-0"
              ariaLabel="Tool windows"
              tabs={[
                {
                  id: 'terminal',
                  label: 'Terminal',
                  content: <TerminalPane output={terminalOutput} onInput={handleTerminalInput} disabled={busy || !loaded} />,
                },
              ]}
            />
          </div>
        </div>
      </div>
    </main>
  );
}