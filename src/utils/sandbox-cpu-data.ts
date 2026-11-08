export interface SandboxCpuData {
  readonly registers: readonly number[];
  readonly programCounter: number;
  readonly lastExecutedAddress: number | null;
  readonly stopStatus: number | null;
  readRegister(number: number): number;
  readMemory(address: number, size: number): Promise<number>;
  writeMemory(address: number, size: number, value: number): Promise<void>;
}

export function createSandboxCpuData(
  registers: readonly number[],
  options: {
    programCounter?: number;
    lastExecutedAddress?: number | null;
    stopStatus?: number | null;
    readMemory: SandboxCpuData['readMemory'];
    writeMemory: SandboxCpuData['writeMemory'];
  },
): SandboxCpuData {
  return {
    registers,
    programCounter: options.programCounter ?? 0,
    lastExecutedAddress: options.lastExecutedAddress ?? null,
    stopStatus: options.stopStatus ?? null,
    readRegister: (number) => registers[number] ?? 0,
    readMemory: options.readMemory,
    writeMemory: options.writeMemory,
  };
}
