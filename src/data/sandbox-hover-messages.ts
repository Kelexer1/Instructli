import {
  formatComponentMessage,
  formatDataMemoryMessage,
  formatInstructionMemoryMessage,
  formatPcMessage,
  formatStaticMessage,
  formatNoBranchTargetMessage,
  formatNoImmediateMessage,
} from './sandbox-messages';

export type SandboxHoverData = {
  instruction?: string;
  pc?: number | null;
  pcNext?: number;
  instructionAddress?: number | null;
  pcAdder?: string;
  registerFile?: {
    rs1?: string;
    rs2?: string;
    rd?: string;
    read1?: string;
    read2?: string;
    write?: string;
    writeDetails?: RegisterWriteDetails;
    upperImmediate?: boolean;
    conditionalBranch?: boolean;
  };
  immediateGenerator?: { value?: string; usesImmediate?: boolean };
  alu?: string;
  branchAdder?: { value?: string; usesBranch?: boolean };
  aluInputMux?: string;
  dataMemory?: { readData: string; writeData: string };
  nextPcMux?: string;
  writeBackMux?: string;
  hazards?: string[];
};

export type RegisterWriteInput = {
  rd: string | number | null;
  mnemonic: string;
  isLoad?: boolean;
  isStore?: boolean;
  isBranch?: boolean;
  isUpperImmediate?: boolean;
};

export type RegisterWriteDetails = {
  value: string;
  comment: string;
};

export function buildRegisterWriteDetails({
  rd,
  mnemonic,
  isLoad = false,
  isStore = false,
  isBranch = false,
  isUpperImmediate = false,
}: RegisterWriteInput): RegisterWriteDetails {
  if (isBranch) {
    return { value: 'N/A', comment: 'Branches do not write a register' };
  }
  if (isStore) {
    return { value: 'N/A', comment: 'Stores do not write a register' };
  }
  const destinationRegister = typeof rd === 'number' ? `x${rd}` : rd;
  return {
    value: `${destinationRegister} ← result`,
    comment: `Destination register receives the ${isLoad ? 'loaded memory value' : 'ALU result'}`,
  };
}

export function buildRegisterReadDetails(
  register: number | null,
  value: number,
  comment: string,
) {
  return { value: `x${register} = ${formatHexValue(value)}`, comment };
}

export function formatHexValue(value: number) {
  return `0x${(value >>> 0).toString(16).padStart(8, '0').toUpperCase()}`;
}

export function buildImmediateDetails(value: number | null, symbolic = false) {
  return {
    value: symbolic ? 'Immediate: symbolic branch target' : `Immediate: ${formatHexValue(value ?? 0)}`,
  };
}

export function buildAluDetails(
  mnemonic: string,
  firstValue: number,
  secondValue: number,
  immediateValue: number,
  options: { isLoad?: boolean; isStore?: boolean; isRegister?: boolean; isUpperImmediate?: boolean; pc?: number } = {},
) {
  if (options.isUpperImmediate) {
    return mnemonic === 'auipc'
      ? `${formatHexValue(options.pc ?? 0)} + ${formatHexValue(immediateValue)}`
      : `Immediate = ${formatHexValue(immediateValue)}`;
  }
  if (options.isLoad || options.isStore) {
    return `Address = ${formatHexValue(firstValue)} + ${formatHexValue(immediateValue)}`;
  }
  return `${mnemonic.toUpperCase()} uses ${formatHexValue(firstValue)}${options.isRegister ? ` and ${formatHexValue(secondValue)}` : ` and ${formatHexValue(immediateValue)}`
    }`;
}

export function formatRegisterFileDetails(
  read1: string,
  read2: string,
  writeDetails: RegisterWriteDetails,
  conditionalBranch: boolean,
) {
  const writeLabel = conditionalBranch
    ? writeDetails.comment
    : writeDetails.comment || 'Destination register receives the result';
  return `ALU input rs1: ${read1}\nALU input rs2: ${read2}\n\n` +
    `${writeLabel}: ${writeDetails.value}\n\n`;
}

function registerValue(register: string | undefined, value: string | undefined) {
  return register && value ? `${register} = ${value}` : value || 'N/A';
}

export function buildSandboxHoverMessage(
  label: string | null,
  data: SandboxHoverData,
): string | null {
  if (!label) return null;

  const instruction = data.instruction;
  switch (label) {
    case 'PC':
      return instruction && data.pc !== undefined
        ? formatPcMessage(instruction, data.pc ?? 0, data.pcNext)
        : null;
    case 'INSTRUCTION MEMORY':
      return instruction && data.instructionAddress !== undefined
        ? formatInstructionMemoryMessage(instruction, data.instructionAddress ?? 0)
        : null;
    case 'ADD (PC + 4)':
      return instruction
        ? formatComponentMessage('pcAdder', instruction, data.pcAdder ?? 'PC + 4')
        : null;
    case 'REGISTER FILE': {
      if (!instruction || !data.registerFile) return null;
      const registers = data.registerFile;
      const read1 = registers.upperImmediate
        ? 'N/A'
        : registers.rs1
          ? registerValue(registers.rs1, registers.read1)
          : registers.read1 || 'N/A';
      const read2 = registers.rs2
        ? registerValue(registers.rs2, registers.read2)
        : registers.read2 || 'N/A';
      const writeDetails = registers.writeDetails || {
        value: registers.write || 'N/A',
        comment: registers.conditionalBranch
          ? 'Branches do not write a register'
          : 'Destination register receives the result',
      };
      return formatComponentMessage(
        'registerFile',
        instruction,
        formatRegisterFileDetails(read1, read2, writeDetails, Boolean(registers.conditionalBranch)),
      );
    }
    case 'IMMEDIATE GENERATOR':
      return instruction
        ? formatComponentMessage(
          'immediateGenerator',
          instruction,
          data.immediateGenerator?.usesImmediate === false
            ? formatNoImmediateMessage()
            : data.immediateGenerator?.value ?? formatNoImmediateMessage(),
        )
        : null;
    case 'ALU':
      return instruction && data.alu !== undefined
        ? formatComponentMessage('alu', instruction, data.alu)
        : null;
    case 'ADD (Branch Target)':
      return instruction
        ? formatComponentMessage(
          'branchAdder',
          instruction,
          data.branchAdder?.usesBranch === false
            ? formatNoBranchTargetMessage()
            : data.branchAdder?.value ?? formatNoBranchTargetMessage(),
        )
        : null;
    case 'MUX (ALU Input)':
      return instruction && data.aluInputMux !== undefined
        ? formatComponentMessage('aluInputMux', instruction, data.aluInputMux)
        : null;
    case 'DATA MEMORY':
      return instruction && data.dataMemory
        ? formatDataMemoryMessage(instruction, data.dataMemory.readData, data.dataMemory.writeData)
        : null;
    case 'MUX (Next PC)':
      return instruction
        ? formatComponentMessage('nextPcMux', instruction, data.nextPcMux ?? 'N/A')
        : null;
    case 'MUX (Write Back)':
      return instruction
        ? formatComponentMessage('writeBackMux', instruction, data.writeBackMux ?? 'N/A')
        : null;
    case 'IF/ID':
      return formatStaticMessage('IF/ID', 'Holds the fetched instruction and program counter while the decode stage reads the fields.\nThis lets the next cycle begin ID without waiting for IF to finish.');
    case 'ID/EX':
      return formatStaticMessage('ID/EX', 'Carries decoded register values, control signals, and immediate values into the execute stage.\nIt separates instruction decode from execution.');
    case 'EX/MEM':
      return formatStaticMessage('EX/MEM', 'Stores the ALU result, branch decision signals, and register data for the memory stage.\nIt separates execution from memory access.');
    case 'MEM/WB':
      return formatStaticMessage('MEM/WB', 'Holds the value from data memory or the ALU result until the write-back stage writes it into the register file.');
    case 'HAZARDS':
      return formatStaticMessage('HAZARDS:', data.hazards?.length ? data.hazards.join('\n') : 'None');
    default:
      return label;
  }
}
