import type { DataPath, Block_Data } from '@/src/utils/return-types';
import type { JsonResponse } from '@/src/utils/single-processor';
import datapathConfig from '@/src/data/sandbox-single-cycle.json';

type InstructionType = keyof typeof datapathConfig.activeSignals;

const emptyBlockData: Block_Data = {
  pc: { value: '', comment: '' },
  instruction_mem: { value: '', comment: '' },
  default_adder: { value: '' },
  registers: {
    read_register_1: { value: '', comment: '' },
    read_register_2: { value: '', comment: '' },
    write_register: { value: '', comment: '' },
  },
  alu: { alu_result: '' },
  data_memory: { read_data: '', write_data: '' },
};

function hex(value: number) {
  return `0x${(value >>> 0).toString(16).padStart(8, '0').toUpperCase()}`;
}

function registerNumber(token: string | undefined) {
  const match = token?.match(/^x(\d+)$/i);
  return match ? Number(match[1]) : null;
}

function registerValue(registers: readonly number[], number: number | null) {
  return number === null ? 0 : registers[number] ?? 0;
}

function signedImmediate(token: string | undefined) {
  const value = Number(token);
  return Number.isFinite(value) ? value : 0;
}

function instructionImmediate(
  instructionType: InstructionType | null,
  tokens: string[],
  memoryOperand: RegExpMatchArray | null,
) {
  const token = memoryOperand?.[1] ?? (
    instructionType === 'U' ? tokens[2] : tokens[3]
  );
  const value = signedImmediate(token);

  return instructionType === 'U' ? value * 2 ** 12 : value;
}

function addressValue(token: string | undefined) {
  const value = token?.startsWith('0x') || token?.startsWith('0X')
    ? Number.parseInt(token, 16)
    : Number(token);
  return Number.isFinite(value) ? value >>> 0 : null;
}

function branchImmediate(token: string | undefined, pc: number) {
  if (token?.startsWith('0x') || token?.startsWith('0X')) {
    const target = addressValue(token);
    return target === null ? null : target - pc;
  }

  const offset = Number(token);
  return Number.isFinite(offset) ? offset : null;
}

function classifyInstruction(mnemonic: string): InstructionType | null {
  const type = datapathConfig.instructionTypes[mnemonic as keyof typeof datapathConfig.instructionTypes];
  return (type as InstructionType | undefined) ?? null;
}

function createDataPath(type: InstructionType | null): DataPath {
  const dataPath = Object.fromEntries(
    datapathConfig.signals.map((key) => [key, false]),
  ) as DataPath;
  const allSignals = new Set(
    type ? datapathConfig.activeSignals[type] : [],
  );
  for (const key of Object.keys(dataPath) as (keyof DataPath)[]) {
    dataPath[key] = allSignals.has(key);
  }
  return dataPath;
}

export function createSandboxSingleCycleSnapshot(
  instruction: string,
  pc: number,
  nextPc: number,
  registers: readonly number[],
  stopStatus: number,
): JsonResponse {
  const tokens = instruction.replace(/,/g, ' ').trim().split(/\s+/);
  const mnemonic = tokens[0]?.toLowerCase() ?? '';
  const instructionType = classifyInstruction(mnemonic);
  const dataPath = createDataPath(instructionType);
  const blockData: Block_Data = {
    ...emptyBlockData,
    pc: { ...emptyBlockData.pc },
    instruction_mem: { ...emptyBlockData.instruction_mem },
    default_adder: { ...emptyBlockData.default_adder },
    registers: {
      read_register_1: { ...emptyBlockData.registers.read_register_1 },
      read_register_2: { ...emptyBlockData.registers.read_register_2 },
      write_register: { ...emptyBlockData.registers.write_register },
    },
    data_memory: { ...emptyBlockData.data_memory },
  };

  const memoryOperand = tokens[2]?.match(/^(-?\d+)\((x\d+)\)$/i);
  const isBranch = instructionType === 'B';
  const rd = registerNumber(tokens[1]);
  const rs1 = isBranch
    ? registerNumber(tokens[1])
    : memoryOperand
      ? registerNumber(memoryOperand[2])
      : registerNumber(tokens[2]);
  const isLoad = instructionType === 'L';
  const isStore = instructionType === 'S';
  const isImmediate = instructionType === 'I';
  const isRegister = instructionType === 'R';
  const isUpperImmediate = instructionType === 'U';
  const rs2 = isBranch
    ? registerNumber(tokens[2])
    : isStore
      ? rd
      : registerNumber(tokens[3]);
  const firstValue = registerValue(registers, rs1);
  const secondValue = registerValue(registers, rs2);
  const encodedImmediate = instructionImmediate(instructionType, tokens, memoryOperand);
  const parsedImmediate = isBranch
    ? branchImmediate(tokens[3], pc)
    : encodedImmediate;
  const resolvedBranchImmediate = isBranch && parsedImmediate === null
    && nextPc !== ((pc + 4) >>> 0)
    ? nextPc - pc
    : null;
  const immediate = parsedImmediate ?? resolvedBranchImmediate;
  const immediateValue = immediate ?? 0;

  blockData.pc.value = `PC ${hex(pc)} → ${hex(nextPc)}`;
  blockData.pc.comment = '';
  blockData.default_adder.value = `${hex(pc)} + 4 = ${hex((pc + 4) >>> 0)}`;
  blockData.instruction_mem.value = instruction;
  blockData.instruction_mem.comment = `Fetched at address ${hex(pc)}`;

  if (isBranch) {
    const signedFirstValue = firstValue | 0;
    const signedSecondValue = secondValue | 0;
    const branchTaken = mnemonic === 'beq'
      ? firstValue === secondValue
      : mnemonic === 'bne'
        ? firstValue !== secondValue
        : mnemonic === 'blt'
          ? signedFirstValue < signedSecondValue
          : mnemonic === 'bge'
            ? signedFirstValue >= signedSecondValue
            : mnemonic === 'bltu'
              ? firstValue < secondValue
              : firstValue >= secondValue;
    dataPath.im_reg1 = true;
    dataPath.im_reg2 = true;
    dataPath.reg1_mux = true;
    dataPath.reg2_mux = true;
    dataPath.im_imm_gen = true;
    dataPath.imm_gen_shift = true;
    dataPath.mux_alu = true;
    dataPath.pc_add = branchTaken;
    dataPath.pc_default = !branchTaken;
    dataPath.pc_increment = !branchTaken;
    dataPath.zero = mnemonic === 'beq' ? branchTaken : !branchTaken;
    dataPath.branch = true;
    dataPath.branch_taken = branchTaken;
    dataPath.alu_op_0 = true;
    blockData.immediate_generator = {
      value: immediate === null
        ? 'Immediate: symbolic branch target'
        : `Immediate: ${hex(immediate)}`,
    };
    blockData.branch_adder = {
      value: immediate === null
        ? 'Branch target is symbolic and cannot be resolved'
        : `${hex(pc)} + ${hex(immediate)} = ${hex((pc + immediate) >>> 0)}`,
    };
    blockData.registers.read_register_1 = { value: `x${rs1} = ${hex(firstValue)}`, comment: 'Branch comparison operand rs1' };
    blockData.registers.read_register_2 = { value: `x${rs2} = ${hex(secondValue)}`, comment: 'Branch comparison operand rs2' };
    blockData.registers.write_register = { value: 'N/A', comment: 'Branches do not write a register' };
    blockData.alu.alu_result = `${mnemonic.toUpperCase()} ${branchTaken ? 'taken' : 'not taken'}`;
    blockData.data_memory.read_data = 'No data read';
    blockData.data_memory.write_data = 'No data written';
  } else if (isUpperImmediate) {
    dataPath.im_imm_gen = true;
    dataPath.im_reg_write = true;
    dataPath.imm_gen_mux = true;
    dataPath.mux_alu = true;
    dataPath.reg_write = true;
    dataPath.alu_src = true;
    dataPath.alu_res_mux = true;
    dataPath.reg_write_control = true;
    blockData.immediate_generator = { value: `Immediate: ${hex(immediateValue)}` };
    blockData.registers.read_register_1 = { value: 'N/A', comment: 'Upper-immediate instructions do not read rs1' };
    blockData.registers.read_register_2 = { value: 'N/A', comment: 'Upper-immediate instructions do not read rs2' };
    blockData.registers.write_register = { value: `x${rd} ← result`, comment: `${mnemonic.toUpperCase()} writes the immediate-derived value to rd` };
    blockData.alu.alu_result = mnemonic === 'auipc'
      ? `${hex(pc)} + ${hex(immediateValue)}`
      : `Immediate = ${hex(immediateValue)}`;
    blockData.data_memory.read_data = 'No data read';
    blockData.data_memory.write_data = 'No data written';
  } else if (isStore || isLoad || isImmediate || isRegister) {
    const usesSecondRegister = isRegister || isStore;
    dataPath.im_reg1 = true;
    dataPath.im_imm_gen = !isRegister;
    dataPath.reg1_mux = true;
    dataPath.mux_alu = true;
    dataPath.alu_src = !isRegister;
    dataPath.im_reg2 = usesSecondRegister;
    dataPath.reg2_mux = usesSecondRegister;
    dataPath.reg2_dm = isStore;
    dataPath.alu_res_mem = isLoad || isStore;
    dataPath.reg_write = !isStore;
    dataPath.im_reg_write = !isStore;
    dataPath.alu_res_mux = !isLoad && !isStore;
    dataPath.reg_write_control = !isStore;
    dataPath.mem_read = isLoad;
    dataPath.mem_write = isStore;
    dataPath.dm_mux = isLoad;
    dataPath.memto_reg = isLoad;
    dataPath.alu_op_0 = isRegister || isStore;
    dataPath.alu_op_1 = isRegister;
    blockData.immediate_generator = !isRegister ? { value: `Immediate: ${hex(immediateValue)}` } : undefined;
    blockData.registers.read_register_1 = { value: `x${rs1} = ${hex(firstValue)}`, comment: 'ALU input rs1' };
    blockData.registers.read_register_2 = usesSecondRegister
      ? { value: `x${rs2} = ${hex(secondValue)}`, comment: isStore ? 'Data written to memory' : 'ALU input rs2' }
      : { value: 'N/A', comment: 'ALU input rs2' };
    blockData.registers.write_register = isStore
      ? { value: 'N/A', comment: 'Stores do not write a register' }
      : { value: `x${rd} ← result`, comment: `Destination register receives the ${isLoad ? 'loaded memory value' : 'ALU result'}` };
    blockData.alu.alu_result = isLoad || isStore
      ? `Address = ${hex(firstValue)} + ${hex(immediateValue)}`
      : `${mnemonic.toUpperCase()} uses ${hex(firstValue)}${isRegister ? ` and ${hex(secondValue)}` : ` and ${hex(immediateValue)}`}`;
    blockData.data_memory.read_data = isLoad ? `Read at ${hex((firstValue + immediateValue) >>> 0)}` : 'No data read';
    blockData.data_memory.write_data = isStore ? `Write ${hex(secondValue)} at ${hex((firstValue + immediateValue) >>> 0)}` : 'No data written';
  } else {
    blockData.instruction_mem.comment = 'The instruction is not represented by a dedicated single-cycle control mapping';
  }

  if (stopStatus === 3) {
    blockData.pc.comment += ' The program has exited after this instruction';
  }

  return { data_path: dataPath, block_data: blockData, command_type: mnemonic };
}
