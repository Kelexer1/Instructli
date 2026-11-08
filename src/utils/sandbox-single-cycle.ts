import type { DataPath, Block_Data } from '@/src/utils/return-types';
import type { JsonResponse } from '@/src/utils/single-processor';
import datapathConfig from '@/src/data/sandbox-single-cycle.json';
import { EMPTY_BLOCK_DATA } from '@/src/data/sandbox-single-cycle-ui';
import type { SandboxCpuData } from '@/src/utils/sandbox-cpu-data';
import {
  buildAluDetails,
  buildImmediateDetails,
  buildRegisterReadDetails,
  buildRegisterWriteDetails,
} from '@/src/data/sandbox-hover-messages';
import {
  formatAdderCalculation,
  formatBranchTargetValue,
  formatInstructionFetch,
  formatMemoryRead,
  formatMemoryWrite,
  formatPcValue,
} from '@/src/data/sandbox-messages';

type InstructionType = keyof typeof datapathConfig.activeSignals;

function registerNumber(token: string | undefined) {
  const match = token?.match(/^x(\d+)$/i);
  return match ? Number(match[1]) : null;
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
  cpuData: SandboxCpuData,
  symbolAddress: number | null = null,
): JsonResponse {
  const tokens = instruction.replace(/,/g, ' ').trim().split(/\s+/);
  const mnemonic = tokens[0]?.toLowerCase() ?? '';
  const instructionType = classifyInstruction(mnemonic);
  const dataPath = createDataPath(instructionType);
  const blockData: Block_Data = {
    ...EMPTY_BLOCK_DATA,
    pc: { ...EMPTY_BLOCK_DATA.pc },
    instruction_mem: { ...EMPTY_BLOCK_DATA.instruction_mem },
    default_adder: { ...EMPTY_BLOCK_DATA.default_adder },
    registers: {
      read_register_1: { ...EMPTY_BLOCK_DATA.registers.read_register_1 },
      read_register_2: { ...EMPTY_BLOCK_DATA.registers.read_register_2 },
      write_register: { ...EMPTY_BLOCK_DATA.registers.write_register },
    },
    data_memory: { ...EMPTY_BLOCK_DATA.data_memory },
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
  const firstValue = rs1 === null ? 0 : cpuData.readRegister(rs1);
  const secondValue = rs2 === null ? 0 : cpuData.readRegister(rs2);
  const encodedImmediate = instructionImmediate(instructionType, tokens, memoryOperand);
  const parsedImmediate = isBranch
    ? branchImmediate(tokens[3], pc)
    : encodedImmediate;
  const resolvedBranchImmediate = isBranch && parsedImmediate === null && symbolAddress !== null
    ? symbolAddress - pc
    : null;
  const immediate = parsedImmediate ?? resolvedBranchImmediate;
  const immediateValue = immediate ?? 0;

  blockData.pc.value = formatPcValue(pc, nextPc);
  blockData.pc.comment = '';
  blockData.default_adder.value = formatAdderCalculation(pc, 4);
  blockData.instruction_mem.value = instruction;
  blockData.instruction_mem.comment = formatInstructionFetch(pc);

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
    blockData.immediate_generator = buildImmediateDetails(immediate, immediate === null);
    blockData.branch_adder = {
      value: immediate === null
        ? 'Branch target is symbolic and cannot be resolved'
        : formatBranchTargetValue(pc, immediate),
    };
    blockData.registers.read_register_1 = buildRegisterReadDetails(rs1, firstValue, 'ALU input rs1');
    blockData.registers.read_register_2 = buildRegisterReadDetails(rs2, secondValue, 'ALU input rs2');
    blockData.registers.write_register = buildRegisterWriteDetails({
      rd, mnemonic, isBranch: true,
    });
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
    blockData.immediate_generator = buildImmediateDetails(immediateValue);
    blockData.registers.read_register_1 = { value: 'N/A', comment: 'Upper-immediate instructions do not read rs1' };
    blockData.registers.read_register_2 = { value: 'N/A', comment: 'Upper-immediate instructions do not read rs2' };
    blockData.registers.write_register = buildRegisterWriteDetails({
      rd, mnemonic, isUpperImmediate: true,
    });
    blockData.alu.alu_result = buildAluDetails(
      mnemonic, firstValue, secondValue, immediateValue,
      { isUpperImmediate: true, pc },
    );
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
    blockData.immediate_generator = !isRegister ? buildImmediateDetails(immediateValue) : undefined;
    blockData.registers.read_register_1 = buildRegisterReadDetails(rs1, firstValue, 'ALU input rs1');
    blockData.registers.read_register_2 = usesSecondRegister
      ? buildRegisterReadDetails(rs2, secondValue, isStore ? 'Data written to memory' : 'ALU input rs2')
      : { value: 'N/A', comment: 'ALU input rs2' };
    blockData.registers.write_register = buildRegisterWriteDetails({
      rd, mnemonic, isLoad, isStore,
    });
    blockData.alu.alu_result = buildAluDetails(
      mnemonic, firstValue, secondValue, immediateValue,
      { isLoad, isStore, isRegister },
    );
    blockData.data_memory.read_data = isLoad ? formatMemoryRead((firstValue + immediateValue) >>> 0) : 'No data read';
    blockData.data_memory.write_data = isStore ? formatMemoryWrite(secondValue, (firstValue + immediateValue) >>> 0) : 'No data written';
  } else {
    blockData.instruction_mem.comment = 'The instruction is not represented by a dedicated single-cycle control mapping';
  }

  if (cpuData.stopStatus === 3) {
    blockData.pc.comment += ' The program has exited after this instruction';
  }

  return { data_path: dataPath, block_data: blockData, command_type: mnemonic };
}
