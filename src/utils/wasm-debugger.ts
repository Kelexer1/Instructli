'use client';

type WasmModule = {
  ccall: (name: string, returnType: string | null, argTypes: string[], args: unknown[]) => number;
  UTF8ToString: (pointer: number) => string;
  _free: (pointer: number) => void;
};

type WasmFactory = (options?: Record<string, unknown>) => Promise<WasmModule>;

let modulePromise: Promise<WasmModule> | undefined;
let wasmModule: WasmModule | undefined;
let activeSession = 0;
let outputBuffer: WasmOutput[] = [];

export interface WasmOutput {
  stream: 'stdin' | 'stdout' | 'stderr';
  text: string;
}

export interface DisassemblyInstruction {
  address: number;
  text: string;
  sourceLine: number | null;
  sourceText: string | null;
}

export interface WasmDebugState {
  instructions: DisassemblyInstruction[];
  currentAddress: number;
}

export interface WasmRegister {
  number: number;
  value: number;
}

export const WASM_STOP_BREAKPOINT = 0;
export const WASM_STOP_EBREAK = 2;
export const WASM_STOP_EXITED = 3;
export const WASM_STOP_WAITING_INPUT = 4;

function loadModule(): Promise<WasmModule> {
  if (modulePromise) return modulePromise;

  const version = Date.now().toString(36);
  modulePromise = import(/* webpackIgnore: true */ `/wasm/riscv.js?v=${version}`)
    .then(async (module: { default?: WasmFactory; createRiscv?: WasmFactory }) => {
      const factory = module.default ?? module.createRiscv;
      if (!factory) throw new Error('The RISC-V WASM factory was not found.');
      const wasm = await factory({
        locateFile: (path: string) =>
          path.endsWith('.wasm') ? `/wasm/riscv.wasm?v=${version}` : path,
        printErr: (text: string) => outputBuffer.push({ stream: 'stderr', text }),
      });
      wasmModule = wasm;
      return wasm;
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
  if (wasmModule) {
    const pointer = wasmModule.ccall('wasm_output_take', 'number', [], []);
    if (pointer) {
      const text = wasmModule.UTF8ToString(pointer);
      wasmModule._free(pointer);
      if (text) output.push({ stream: 'stdout', text });
    }
  }
  return output;
}

export async function provideWasmInput(input: string): Promise<void> {
  const wasm = await loadModule();
  wasm.ccall('wasm_input_feed', null, ['string'], [`${input}\n`]);
}

export async function resumeWasm(): Promise<void> {
  const wasm = await loadModule();
  if (!activeSession) throw new Error('Load the program before resuming it.');
  const resumed = wasm.ccall('wasm_resume', 'number', ['number'], [activeSession]);
  if (!resumed) throw new Error('The emulator could not be resumed.');
}

export async function resetWasmInput(): Promise<void> {
  const wasm = await loadModule();
  wasm.ccall('wasm_input_reset', null, [], []);
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

export async function readWasmDebugState(source = ''): Promise<WasmDebugState> {
  const wasm = await loadModule();
  if (!activeSession) throw new Error('Assemble the program before viewing disassembly.');

  const textBase = wasm.ccall('wasm_text_base', 'number', ['number'], [activeSession]);
  const textSize = wasm.ccall('wasm_text_size', 'number', ['number'], [activeSession]);
  const currentAddress = wasm.ccall('wasm_pc', 'number', ['number'], [activeSession]);
  const sourceLines = source.split('\n');
  const instructions: DisassemblyInstruction[] = [];

  for (let address = textBase; address < textBase + textSize; address += 4) {
    const pointer = wasm.ccall('wasm_disas_at', 'number', ['number', 'number'], [activeSession, address]);
    if (!pointer) continue;

    try {
      const sourceLine = wasm.ccall('wasm_line_for_addr', 'number', ['number', 'number', 'number'], [
        activeSession,
        address,
        textBase,
      ]);
      instructions.push({
        address,
        text: wasm.UTF8ToString(pointer),
        sourceLine: sourceLine || null,
        sourceText: sourceLine ? sourceLines[sourceLine - 1]?.trim() || null : null,
      });
    } finally {
      wasm._free(pointer);
    }

  }

  return { instructions, currentAddress };
}

export async function readWasmAddressForLine(line: number): Promise<number | null> {
  const debugState = await readWasmDebugState();
  return debugState.instructions.find(
    (instruction) => instruction.sourceLine !== null && instruction.sourceLine >= line,
  )?.address ?? null;
}

export async function readWasmProgramCounter(): Promise<number> {
  const wasm = await loadModule();
  if (!activeSession) throw new Error('Load the program before reading execution state.');
  return wasm.ccall('wasm_pc', 'number', ['number'], [activeSession]);
}

export async function readWasmInstructionAt(address: number): Promise<{ raw: number; text: string } | null> {
  const wasm = await loadModule();
  if (!activeSession) throw new Error('Assemble the program before fetching instructions.');
  const readable = wasm.ccall('wasm_memory_readable', 'number', ['number', 'number', 'number'], [
    activeSession,
    address >>> 0,
    4,
  ]);
  if (!readable) return null;

  const pointer = wasm.ccall('wasm_disas_at', 'number', ['number', 'number'], [activeSession, address >>> 0]);
  if (!pointer) return null;
  try {
    const text = wasm.UTF8ToString(pointer);
    const raw = wasm.ccall('wasm_read_u32_value', 'number', ['number', 'number'], [activeSession, address >>> 0]) >>> 0;
    return { raw, text };
  } finally {
    wasm._free(pointer);
  }
}

export async function readWasmLastRaw(): Promise<number> {
  const wasm = await loadModule();
  if (!activeSession) throw new Error('Load the program before reading execution state.');
  return wasm.ccall('wasm_last_raw', 'number', ['number'], [activeSession]) >>> 0;
}

export async function readWasmLastExecutedAddress(): Promise<number> {
  const wasm = await loadModule();
  if (!activeSession) throw new Error('Load the program before reading execution state.');
  return wasm.ccall('wasm_last_pc_old', 'number', ['number'], [activeSession]);
}

export async function readWasmSymbolAddress(name: string): Promise<number | null> {
  const wasm = await loadModule();
  if (!activeSession) throw new Error('Assemble the program before resolving symbols.');
  const address = wasm.ccall('wasm_symbol_value', 'number', [
    'number',
    'string',
    'number',
  ], [activeSession, name, name.length]) >>> 0;
  return address === 0xffffffff ? null : address;
}

export async function readWasmLastWrittenRegister(): Promise<number | null> {
  const wasm = await loadModule();
  if (!activeSession) throw new Error('Load the program before reading execution state.');

  const raw = wasm.ccall('wasm_last_raw', 'number', ['number'], [activeSession]) >>> 0;
  const opcode = raw & 0x7f;
  const writesRegister = opcode === 0x03
    || opcode === 0x13
    || opcode === 0x17
    || opcode === 0x33
    || opcode === 0x37
    || opcode === 0x67
    || opcode === 0x6f;

  if (!writesRegister) return null;
  const register = (raw >>> 7) & 0x1f;
  return register === 0 ? null : register;
}

export async function readWasmExitCode(): Promise<number> {
  const wasm = await loadModule();
  if (!activeSession) throw new Error('Load the program before reading execution state.');
  return wasm.ccall('wasm_exit_code', 'number', ['number'], [activeSession]);
}

export async function readWasmRegisters(): Promise<WasmRegister[]> {
  const wasm = await loadModule();
  if (!activeSession) throw new Error('Assemble the program before viewing registers.');

  return Array.from({ length: 32 }, (_, number) => ({
    number,
    value: wasm.ccall('wasm_reg', 'number', ['number', 'number'], [activeSession, number]) >>> 0,
  }));
}

export async function writeWasmRegister(number: number, value: number): Promise<void> {
  const wasm = await loadModule();
  if (!activeSession) throw new Error('Load the program before editing registers.');
  if (!Number.isInteger(number) || number < 1 || number >= 32) {
    throw new Error('Only registers x1 through x31 can be edited.');
  }

  const written = wasm.ccall('wasm_set_reg', 'number', ['number', 'number', 'number'], [
    activeSession,
    number,
    value >>> 0,
  ]);
  if (!written) throw new Error(`Register x${number} could not be updated.`);
}

export async function readWasmMemory(address: number, size: number): Promise<number> {
  const wasm = await loadModule();
  if (!activeSession) throw new Error('Load the program before reading memory.');
  const readable = wasm.ccall('wasm_memory_readable', 'number', ['number', 'number', 'number'], [
    activeSession,
    address >>> 0,
    size,
  ]);
  if (!readable) throw new Error(`Memory read failed at 0x${(address >>> 0).toString(16)}.`);
  if (size === 1) {
    return wasm.ccall('wasm_read_u8_value', 'number', ['number', 'number'], [activeSession, address >>> 0]);
  }
  return wasm.ccall('wasm_read_u32_value', 'number', ['number', 'number'], [activeSession, address >>> 0]) >>> 0;
}

export async function writeWasmMemory(address: number, size: number, value: number): Promise<void> {
  const wasm = await loadModule();
  if (!activeSession) throw new Error('Load the program before editing memory.');
  const functionName = size === 1 ? 'wasm_write_u8' : size === 2 ? 'wasm_write_u16' : 'wasm_write_u32';
  const written = wasm.ccall(functionName, 'number', ['number', 'number', 'number'], [
    activeSession,
    address >>> 0,
    value >>> 0,
  ]);
  if (written !== 0) throw new Error(`Memory at 0x${(address >>> 0).toString(16)} could not be updated.`);
}

export async function addWasmBreakpoint(address: number): Promise<void> {
  const wasm = await loadModule();
  if (!activeSession) throw new Error('Assemble the program before setting breakpoints.');
  const added = wasm.ccall('wasm_bp_add', 'number', ['number', 'number'], [activeSession, address]);
  if (!added) throw new Error(`The emulator could not set a breakpoint at 0x${address.toString(16)}.`);
}

export async function removeWasmBreakpoint(address: number): Promise<void> {
  const wasm = await loadModule();
  if (!activeSession) throw new Error('Assemble the program before removing breakpoints.');
  wasm.ccall('wasm_bp_remove', null, ['number', 'number'], [activeSession, address]);
}
