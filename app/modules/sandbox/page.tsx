'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, File, FileDown, FileUp, Play, RotateCcw, StepForward } from 'lucide-react';
import { recordAnalyticsVisit } from '@/src/utils/analytics';
import CodeEditor from '@/components/sandbox/CodeEditor';
import DisassemblyPane from '@/components/sandbox/DisassemblyPane';
import RegisterPane from '@/components/sandbox/RegisterPane';
import TerminalPane from '@/components/sandbox/TerminalPane';
import MemoryPane from '@/components/sandbox/MemoryPane';
import CachePane from '@/components/sandbox/CachePane';
import SingleProcessor from '@/components/sandbox/SandboxSingleCycle';
import PipelineProcessor from '@/components/sandbox/SandboxPipelineProcessor';
import { createSandboxSingleCycleSnapshot, type SandboxSingleCycleSnapshot } from '@/src/utils/sandbox-single-cycle';
import { PipelineBlockedError, PipelineEngine, type PipelineEnv, type PipelineSlot } from '@/src/utils/sandbox-pipeline-engine';
import type { PipelineState } from '@/src/utils/pipeline-types';
import { createSandboxCpuData } from '@/src/utils/sandbox-cpu-data';
import { CacheSimulator, DEFAULT_CACHE_CONFIG, type AccessResult, type CacheConfig, type CacheSnapshot } from '@/src/utils/sandbox-cache';
import type { SandboxCpuData } from '@/src/utils/sandbox-cpu-data';
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
  readWasmLastRaw,
  readWasmInstructionAt,
  readWasmLastWrittenRegister,
  readWasmExitCode,
  readWasmProgramCounter,
  readWasmRegisters,
  writeWasmRegister,
  readWasmMemory,
  writeWasmMemory,
  provideWasmInput,
  setWasmLoadListener,
  resumeWasm,
  resetWasmInput,
  runWasm,
  stepWasm,
  WASM_STOP_BREAKPOINT,
  WASM_STOP_EBREAK,
  WASM_STOP_EXITED,
  WASM_STOP_WAITING_INPUT,
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
  const [singleCycleSnapshot, setSingleCycleSnapshot] = useState<SandboxSingleCycleSnapshot | null>(null);
  const [pipelineResults, setPipelineResults] = useState<PipelineState[]>([]);
  const pipelineEngineRef = useRef<PipelineEngine | null>(null);
  const pipelineSteppingRef = useRef(false);
  const pipelineCycle = pipelineResults.length - 1;
  const [activeToolTab, setActiveToolTab] = useState('terminal');
  const [initialCacheSim] = useState(() => new CacheSimulator(DEFAULT_CACHE_CONFIG));
  const cacheSimRef = useRef(initialCacheSim);
  const [cacheSnapshot, setCacheSnapshot] = useState<CacheSnapshot>(() => initialCacheSim.snapshot());
  const [cacheLastRead, setCacheLastRead] = useState<AccessResult | null>(null);
  const [cpuMode, setCpuMode] = useState<'single-cycle' | 'pipeline'>('single-cycle');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cpuData: SandboxCpuData = useMemo(
    () => createSandboxCpuData(
      registers.map((register) => register.value),
      {
        programCounter: nextAddress ?? 0,
        lastExecutedAddress: justExecutedAddress,
        readMemory: readWasmMemory,
        writeMemory: writeWasmMemory,
      },
    ),
    [justExecutedAddress, nextAddress, registers],
  );
  const lastInstruction = useMemo(() => {
    if (justExecutedAddress === null) return null;
    const instruction = instructions.find((candidate) => candidate.address === justExecutedAddress);
    return instruction ? { address: instruction.address, text: instruction.text } : null;
  }, [instructions, justExecutedAddress]);

  function resetPipeline() {
    pipelineEngineRef.current = null;
    setPipelineResults([]);
  }

  function resetCache() {
    cacheSimRef.current.reset();
    setCacheSnapshot(cacheSimRef.current.snapshot());
    setCacheLastRead(null);
  }

  useEffect(() => {
    recordAnalyticsVisit('sandbox');
  }, []);

  useEffect(() => {
    setWasmLoadListener((access) => {
      cacheSimRef.current.access(access.address, access.pc);
    });
    return () => setWasmLoadListener(null);
  }, []);

  function updateSource(nextSource: string) {
    setSource(nextSource);
    setAssemblyState((current) => (current === 'none' ? 'none' : 'outdated'));
    setLoaded(false);
    setInstructions([]);
    setJustExecutedAddress(null);
    setNextAddress(null);
    setChangedRegisters(new Set());
    setSingleCycleSnapshot(null);
    resetPipeline();
    resetCache();
    setStatus(null);
  }

  async function refreshDisassembly() {
    const debugState = await readWasmDebugState(source);
    setInstructions((current) => (
      current.length === debugState.instructions.length
        && current.every((item, index) => item.text === debugState.instructions[index].text)
        ? current
        : debugState.instructions
    ));
  }

  async function handlePipelineStep() {
    if (pipelineSteppingRef.current) return;
    pipelineSteppingRef.current = true;
    try {
      await advancePipeline();
    } finally {
      pipelineSteppingRef.current = false;
    }
  }

  async function advancePipeline() {
    if (!loaded || instructions.length === 0) {
      setStatus('Assemble and load a program with supported instructions first.');
      return;
    }

    const engine = pipelineEngineRef.current ?? new PipelineEngine(await readWasmProgramCounter());
    pipelineEngineRef.current = engine;
    if (engine.finished) {
      setStatus('The pipeline has completed. Load the program again to restart it.');
      return;
    }

    let waitingForInput = false;
    const env: PipelineEnv = {
      fetch: readWasmInstructionAt,
      readRegisters: async () => (await readWasmRegisters()).map((register) => register.value),
      retire: async (slot: PipelineSlot) => {
        const outcome = await handleExecution(stepWasm);
        if (!outcome || outcome.stopReason === WASM_STOP_WAITING_INPUT) {
          waitingForInput = outcome?.stopReason === WASM_STOP_WAITING_INPUT;
          return {
            address: slot.address,
            raw: slot.raw,
            nextPc: slot.address,
            halted: false,
            blocked: true,
            message: 'The emulator stopped on this instruction. Enter input in the terminal, then step again.',
          };
        }
        if (slot.decoded.kind === 'store') await refreshDisassembly();
        return {
          address: outcome.executedAddress,
          raw: await readWasmLastRaw(),
          nextPc: outcome.currentAddress,
          halted: outcome.stopReason === WASM_STOP_EXITED,
          message: outcome.stopReason === WASM_STOP_EXITED ? 'The program exited.' : undefined,
        };
      },
    };

    try {
      await engine.step(env);
      setPipelineResults([...engine.history]);
      setStatus(`Advanced the pipelined processor to cycle ${engine.history.length}.`);
    } catch (error) {
      if (error instanceof PipelineBlockedError) {
        setStatus(waitingForInput
          ? 'The program is waiting for input. Enter it in the terminal, then step again.'
          : error.message);
        return;
      }
      setStatus(error instanceof Error ? error.message : 'The pipeline could not advance.');
    }
  }

  async function handleMemoryWrite(address: number, size: number, value: number) {
    await writeWasmMemory(address, size, value);
    await refreshDisassembly();
    const updated = pipelineEngineRef.current?.invalidate(
      address,
      size,
      `Code at 0x${(address >>> 0).toString(16)} was edited in memory. Stale in-flight copies were flushed and fetching restarts there.`,
    );
    if (updated && pipelineEngineRef.current) setPipelineResults([...pipelineEngineRef.current.history]);
  }

  function handleToolTabChange(tabId: string) {
    setActiveToolTab(tabId);
  }

  async function handleCpuModeChange(mode: 'single-cycle' | 'pipeline') {
    if (mode === cpuMode || busy) return;

    setCpuMode(mode);
    if (loaded) {
      await handleLoad();
    }
  }

  async function handleCacheConfigChange(config: CacheConfig) {
    if (busy) return;

    const nextSim = new CacheSimulator(config);
    cacheSimRef.current = nextSim;
    setCacheSnapshot(nextSim.snapshot());
    setCacheLastRead(null);
    if (loaded) {
      await handleLoad();
    }
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
      setSingleCycleSnapshot(null);
      resetPipeline();
      resetCache();
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
      setSingleCycleSnapshot(null);
      resetPipeline();
      resetCache();
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
      if (cpuMode === 'pipeline') {
        setStatus('Input received. Step the pipeline to continue.');
        setBusy(false);
        return;
      }
      await handleExecution(runWasm);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Input could not be sent to the emulator.');
      setBusy(false);
    }
  }

  async function handleExecution(action: () => Promise<number>): Promise<{ stopReason: number; executedAddress: number; currentAddress: number } | null> {
    setBusy(true);
    setStatus(null);
    const cacheSim = cacheSimRef.current;
    const readsBefore = cacheSim.accessCount;
    try {
      const stepping = action === stepWasm;
      const startAddress = stepping ? await readWasmProgramCounter() : null;
      const fetchedBefore = startAddress === null ? null : await readWasmInstructionAt(startAddress);
      const registersBefore = stepping ? await readWasmRegisters() : null;
      const stopReason = await action();
      flushTerminalOutput();
      const executedAddress = await readWasmLastExecutedAddress();
      const lastAccess = cacheSim.lastAccess;
      setCacheSnapshot(cacheSim.snapshot());
      setCacheLastRead(
        lastAccess !== null && cacheSim.accessCount > readsBefore && lastAccess.pc === executedAddress
          ? lastAccess.result
          : null,
      );
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
      const executedRaw = await readWasmLastRaw();
      const executedInstruction = fetchedBefore && fetchedBefore.raw === executedRaw && startAddress === executedAddress
        ? fetchedBefore
        : await readWasmInstructionAt(executedAddress);
      if (executedInstruction) {
        const valuesUsed = registersBefore ?? nextRegisters;
        setSingleCycleSnapshot(
          createSandboxSingleCycleSnapshot(
            { text: executedInstruction.text, raw: executedRaw, address: executedAddress },
            currentAddress,
            createSandboxCpuData(
              valuesUsed.map((register) => register.value),
              {
                programCounter: currentAddress,
                lastExecutedAddress: executedAddress,
                stopStatus: stopReason,
                readMemory: cpuData.readMemory,
                writeMemory: cpuData.writeMemory,
              },
            ),
            { registersAreFinal: !stepping },
          ),
        );
      }
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
      return { stopReason, executedAddress, currentAddress };
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The emulator could not execute the program.');
      return null;
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
            <button type="button" onClick={() => { resetPipeline(); void handleExecution(runWasm); }} disabled={busy || !loaded} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-gray-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"><Play size={15} /> Run</button>
            <button
              type="button"
              onClick={cpuMode === 'pipeline' ? () => void handlePipelineStep() : () => void handleExecution(stepWasm)}
              disabled={busy || !loaded}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-gray-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <StepForward size={15} /> Cycle
            </button>
          </div>
        </div>
        {status && <p role="status" className="mb-3 text-right text-xs text-gray-500">{status}</p>}
        {/* Sandbox Environment */}
        <div className='flex min-h-0 h-full flex-1 flex-row'>
          {/* Editor Pane */}
          <div className='flex h-full w-[60%] min-w-0 flex-row'>
            <div className="flex w-[20%] min-w-0 shrink-0">
              <RegisterPane
                pc={nextAddress}
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
              panelClassName="flex min-h-0 overflow-hidden p-0"
              ariaLabel="Tool windows"
              activeTabId={activeToolTab}
              onTabChange={handleToolTabChange}
              tabs={[
                {
                  id: 'terminal',
                  label: 'Terminal',
                  content: <TerminalPane output={terminalOutput} onInput={handleTerminalInput} disabled={busy || !loaded} />,
                },
                {
                  id: 'memory',
                  label: 'Memory',
                  content: (
                    <MemoryPane
                      loaded={loaded}
                      readValue={cpuData.readMemory}
                      writeValue={handleMemoryWrite}
                      onError={setStatus}
                    />
                  ),
                },
                {
                  id: 'cache',
                  label: 'Cache',
                  content: (
                    <CachePane
                      snapshot={cacheSnapshot}
                      lastRead={cacheLastRead}
                      lastInstruction={lastInstruction}
                      disabled={busy}
                      onConfigChange={(config) => void handleCacheConfigChange(config)}
                    />
                  ),
                },
                {
                  id: 'cpu',
                  label: 'CPU',
                  content: (
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                      <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h2 className="text-xs font-medium text-gray-700">
                              {cpuMode === 'pipeline' ? 'Pipelined datapath' : 'Single-cycle datapath'}
                            </h2>
                            <p className="text-[11px] text-gray-400">
                              {cpuMode === 'pipeline'
                                ? pipelineCycle >= 0
                                  ? `Cycle ${pipelineResults[pipelineCycle]?.cycle ?? pipelineCycle + 1}; instructions are shown per logical stage.`
                                  : 'Execute an instruction to inspect the pipeline stages.'
                                : singleCycleSnapshot?.block_data.instruction_mem.value
                                  ? singleCycleSnapshot.approximate
                                  ? 'Last executed instruction. Register values are from after the run, so operands this instruction also overwrote may differ.'
                                  : 'Last executed instruction; hover blocks for values.'
                                  : 'No instruction executed.'}
                            </p>
                          </div>
                          <div className="inline-flex shrink-0 rounded-md border border-slate-200 bg-white p-0.5" role="group" aria-label="CPU mode">
                            <button
                              type="button"
                              onClick={() => void handleCpuModeChange('single-cycle')}
                              disabled={busy}
                              aria-pressed={cpuMode === 'single-cycle'}
                              className={`rounded px-2 py-1 text-[11px] transition ${cpuMode === 'single-cycle' ? 'bg-indigo-100 font-medium text-indigo-700' : 'text-gray-500 hover:text-gray-700'} disabled:cursor-not-allowed disabled:opacity-60`}
                            >
                              Single Cycle
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleCpuModeChange('pipeline')}
                              disabled={busy}
                              aria-pressed={cpuMode === 'pipeline'}
                              className={`rounded px-2 py-1 text-[11px] transition ${cpuMode === 'pipeline' ? 'bg-indigo-100 font-medium text-indigo-700' : 'text-gray-500 hover:text-gray-700'} disabled:cursor-not-allowed disabled:opacity-60`}
                            >
                              Pipelined
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="min-h-0 flex-1 overflow-auto p-2">
                        {cpuMode === 'pipeline' ? (
                          <PipelineProcessor
                            results={pipelineResults}
                            currCycle={pipelineCycle}
                            currentPreset={null}
                            cpuData={cpuData}
                          />
                        ) : (() => {
                          const instruction = singleCycleSnapshot?.block_data.instruction_mem.value ?? null;
                          const unrepresented = singleCycleSnapshot !== null && !singleCycleSnapshot.representable;

                          return (
                            <>
                              {instruction && (
                                <p className={`mb-2 text-center font-mono text-sm font-semibold ${unrepresented ? 'text-yellow-600' : 'text-gray-700'}`}>
                                  {instruction}
                                </p>
                              )}
                              {unrepresented && (
                                <p className="mb-2 rounded border border-yellow-200 bg-yellow-50 px-3 py-2 text-center text-xs text-yellow-800">
                                  This instruction has no representation in the single-cycle CPU diagram.
                                </p>
                              )}
                              <SingleProcessor results={singleCycleSnapshot} suppressHover={unrepresented} />
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </div>
      </div>
    </main>
  );
}