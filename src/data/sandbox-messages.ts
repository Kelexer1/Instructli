export type SandboxMessageKind =
  | 'pc'
  | 'instructionMemory'
  | 'dataMemory'
  | 'registerFile'
  | 'immediateGenerator'
  | 'alu'
  | 'branchAdder'
  | 'pcAdder'
  | 'nextPcMux'
  | 'aluInputMux'
  | 'writeBackMux';

const MESSAGE_COPY: Record<SandboxMessageKind, { title: string; description: string }> = {
  pc: {
    title: 'PROGRAM COUNTER (PC)',
    description: 'Holds the address of the current instruction being executed.',
  },
  instructionMemory: {
    title: 'INSTRUCTION MEMORY',
    description: 'Stores all program instructions and outputs the instruction at the given address.',
  },
  dataMemory: {
    title: 'DATA MEMORY',
    description: 'Stores program data (loaded by lw, stored by sw). Allows reading and writing in a single cycle.',
  },
  registerFile: {
    title: 'REGISTER FILE',
    description: 'Stores CPU registers (x0-x31). Allows simultaneous reading of two registers and writing one register per cycle.',
  },
  immediateGenerator: {
    title: 'IMMEDIATE GENERATOR',
    description: "Extracts the instruction's immediate field and formats it for use by the datapath (including positioning the 20-bit field for upper-immediate instructions).",
  },
  alu: {
    title: 'ARITHMETIC LOGIC UNIT (ALU)',
    description: 'Performs arithmetic (add, subtract) and logical (and, or) operations on two 32-bit operands.',
  },
  branchAdder: {
    title: 'ADDER (Branch Target)',
    description: 'Computes the branch target address by adding the sign-extended immediate to the PC.',
  },
  pcAdder: {
    title: 'ADDER (PC + 4)',
    description: 'Computes the next sequential program counter value by adding 4 to the current PC.',
  },
  nextPcMux: {
    title: 'MULTIPLEXER (Next PC)',
    description: 'Selects between the sequential PC (PC+4) or branch target address based on the branch condition.',
  },
  aluInputMux: {
    title: 'MULTIPLEXER (ALU Input)',
    description: 'Selects the second operand for the ALU: either a register value or the immediate value.',
  },
  writeBackMux: {
    title: 'MULTIPLEXER (Write Back)',
    description: 'Selects which value to write back to the register file: ALU result or data from memory.',
  },
};

const NO_IMMEDIATE = 'This instruction does not use an immediate';
const NO_BRANCH_TARGET = 'This instruction does not use a branch target';

export function formatComponentMessage(
  kind: SandboxMessageKind,
  instruction: string,
  details: string,
) {
  const copy = MESSAGE_COPY[kind];
  return formatSandboxMessage(copy.title, copy.description, instruction, details);
}

export function formatStaticMessage(title: string, details: string) {
  return `${title}\n\n${details}`;
}

export function formatNoImmediateMessage() {
  return NO_IMMEDIATE;
}

export function formatNoBranchTargetMessage() {
  return NO_BRANCH_TARGET;
}

export function formatHex(value: number) {
  return `0x${(value >>> 0).toString(16).padStart(8, '0').toUpperCase()}`;
}

export function formatImmediate(value: string) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? formatHex(numericValue)
    : value || 'N/A';
}

export function formatUpperImmediate(value: string) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? formatHex(numericValue * 2 ** 12)
    : value || 'N/A';
}

export function formatPipelineValue(value: string) {
  return value.replace(/Val\(x0\)/g, formatHex(0)).replace(/\bx0\b/g, formatHex(0));
}

export function formatMemoryValue(value: string, fallback: string) {
  const normalized = value && value !== 'N/A' ? value : fallback;
  return normalized.replace(/^(Read|Write) Data:\s*/, '');
}

export function formatSandboxMessage(title: string, description: string, instruction: string, details: string) {
  return `${title}\n${description}\n\nInstruction: ${instruction}\n\n${details}`;
}

export function formatPcMessage(instruction: string, pc: number, nextPc = pc + 4) {
  return formatComponentMessage('pc', instruction, `PC ${formatHex(pc)} → ${formatHex(nextPc)}`);
}

export function formatPcValue(pc: number, nextPc: number) {
  return `PC ${formatHex(pc)} → ${formatHex(nextPc)}`;
}

export function formatInstructionMemoryMessage(instruction: string, address: number) {
  return formatComponentMessage('instructionMemory', instruction, `Fetched at address ${formatHex(address)}`);
}

export function formatInstructionFetch(address: number) {
  return `Fetched at address ${formatHex(address)}`;
}

export function formatAdderCalculation(left: number, right: number) {
  return `${formatHex(left)} + ${formatHex(right)} = ${formatHex(left + right)}`;
}

export function formatAddition(left: number, right: number) {
  return `${formatHex(left)} + ${formatHex(right)}`;
}

export function formatRegisterValue(register: number | null, value: number) {
  return `x${register} = ${formatHex(value)}`;
}

export function formatImmediateValue(value: number) {
  return `Immediate: ${formatHex(value)}`;
}

export function formatBranchTargetValue(pc: number, immediate: number) {
  return formatAdderCalculation(pc, immediate);
}

export function formatMemoryAddress(base: number, offset: number) {
  return `Address = ${formatHex(base)} + ${formatHex(offset)}`;
}

export function formatMemoryRead(address: number) {
  return `Read at ${formatHex(address)}`;
}

export function formatMemoryWrite(value: number, address: number) {
  return `Write ${formatHex(value)} at ${formatHex(address)}`;
}

export function formatDataMemoryMessage(instruction: string, readData: string, writeData: string) {
  return formatComponentMessage(
    'dataMemory',
    instruction,
    `${formatMemoryValue(readData, 'No data read')}\n${formatMemoryValue(writeData, 'No data written')}`,
  );
}
