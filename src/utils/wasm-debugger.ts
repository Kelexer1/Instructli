'use client';

type WasmModule = {
  ccall: (name: string, returnType: string | null, argTypes: string[], args: unknown[]) => number;
  UTF8ToString: (pointer: number) => string;
  _free: (pointer: number) => void;
};

type WasmFactory = (options?: Record<string, unknown>) => Promise<WasmModule>;

let modulePromise: Promise<WasmModule> | undefined;
let activeSession = 0;
let outputBuffer: WasmOutput[] = [];

export interface WasmOutput {
  stream: 'stdout' | 'stderr';
  text: string;
}

export interface DisassemblyInstruction {
  address: number;
  text: string;
}

export interface WasmDebugState {
  instructions: DisassemblyInstruction[];
  currentAddress: number;
}

export interface WasmRegister {
  number: number;
  value: number;
}

function loadModule(): Promise<WasmModule> {
  if (modulePromise) return modulePromise;

  modulePromise = import(/* webpackIgnore: true */ '/wasm/riscv.js')
    .then((module: { default?: WasmFactory; createRiscv?: WasmFactory }) => {
      const factory = module.default ?? module.createRiscv;
      if (!factory) throw new Error('The RISC-V WASM factory was not found.');
      return factory({
        print: (text: string) => outputBuffer.push({ stream: 'stdout', text }),
        printErr: (text: string) => outputBuffer.push({ stream: 'stderr', text }),
      });
    })
    .catch((error) => {
      modulePromise = undefined;
      throw new Error(
        error instanceof Error
          ? `The RISC-V WASM module could not be loaded: ${error.message}`
          : 'The RISC-V WASM module could not be loaded.',
      );
    });

  return modulePromise;
}

export function drainWasmOutput(): WasmOutput[] {
  const output = outputBuffer;
  outputBuffer = [];
  return output;
}

function closeActiveSession(wasm: WasmModule) {
  if (!activeSession) return;
  wasm.ccall('wasm_session_close', null, ['number'], [activeSession]);
  activeSession = 0;
}

export async function assembleWasm(source: string): Promise<void> {
  const wasm = await loadModule();
  closeActiveSession(wasm);

  const session = wasm.ccall('wasm_session_open', 'number', ['string'], [source]);
  if (!session) throw new Error('The source could not be assembled.');
  activeSession = session;
}

export async function loadWasm(): Promise<void> {
  const wasm = await loadModule();
  if (!activeSession) throw new Error('Assemble the program before loading it.');
  const loaded = wasm.ccall('wasm_dbg_reset', 'number', ['number'], [activeSession]);
  if (!loaded) throw new Error('The assembled program could not be loaded into the emulator.');
}

export async function runWasm(): Promise<number> {
  const wasm = await loadModule();
  if (!activeSession) throw new Error('Load the program before running it.');
  return wasm.ccall('wasm_continue', 'number', ['number'], [activeSession]);
}

export async function stepWasm(): Promise<number> {
  const wasm = await loadModule();
  if (!activeSession) throw new Error('Load the program before stepping it.');
  return wasm.ccall('wasm_step', 'number', ['number'], [activeSession]);
}

export async function readWasmDebugState(): Promise<WasmDebugState> {
  const wasm = await loadModule();
  if (!activeSession) throw new Error('Assemble the program before viewing disassembly.');

  const textBase = wasm.ccall('wasm_text_base', 'number', ['number'], [activeSession]);
  const textSize = wasm.ccall('wasm_text_size', 'number', ['number'], [activeSession]);
  const currentAddress = wasm.ccall('wasm_pc', 'number', ['number'], [activeSession]);
  const instructions: DisassemblyInstruction[] = [];

  for (let address = textBase; address < textBase + textSize; address += 4) {
    const pointer = wasm.ccall('wasm_disas_at', 'number', ['number', 'number'], [activeSession, address]);
    if (!pointer) continue;

    try {
      instructions.push({ address, text: wasm.UTF8ToString(pointer) });
    } finally {
      wasm._free(pointer);
    }
  }

  return { instructions, currentAddress };
}

export async function readWasmLastExecutedAddress(): Promise<number> {
  const wasm = await loadModule();
  if (!activeSession) throw new Error('Load the program before reading execution state.');
  return wasm.ccall('wasm_last_pc_old', 'number', ['number'], [activeSession]);
}

export async function readWasmRegisters(): Promise<WasmRegister[]> {
  const wasm = await loadModule();
  if (!activeSession) throw new Error('Assemble the program before viewing registers.');

  return Array.from({ length: 32 }, (_, number) => ({
    number,
    value: wasm.ccall('wasm_reg', 'number', ['number', 'number'], [activeSession, number]) >>> 0,
  }));
}

/**
 * Recreates the debugger session from source and reapplies all active line
 * breakpoints. The native API currently exposes adding line breakpoints but
 * not removing them by line, so rebuilding keeps the native state exact.
 */
export async function syncWasmBreakpoints(source: string, lines: number[]): Promise<void> {
  const wasm = await loadModule();
  closeActiveSession(wasm);

  const session = wasm.ccall('wasm_session_open', 'number', ['string'], [source]);
  if (!session) throw new Error('The source could not be assembled by the emulator.');

  try {
    const textBase = wasm.ccall('wasm_text_base', 'number', ['number'], [session]);
    for (const line of lines) {
      const added = wasm.ccall('wasm_bp_add_line', 'number', ['number', 'number', 'number'], [
        session,
        line,
        textBase,
      ]);
      if (!added) throw new Error(`The emulator could not set a breakpoint on line ${line}.`);
    }
    activeSession = session;
  } catch (error) {
    wasm.ccall('wasm_session_close', null, ['number'], [session]);
    throw error;
  }
}
