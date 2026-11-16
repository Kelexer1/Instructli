import type { DataPath, Block_Data } from '@/src/utils/return-types';
import type { JsonResponse } from '@/src/utils/single-processor';
import datapathConfig from '@/src/data/sandbox-single-cycle.json';
import { EMPTY_BLOCK_DATA } from '@/src/data/sandbox-single-cycle-ui';
import type { SandboxCpuData } from '@/src/utils/sandbox-cpu-data';
import {
  branchZeroFlag,
  decodeInstruction,
  evaluateBranch,
  isRepresentable,
  type InstructionKind,
} from '@/src/utils/sandbox-decode';
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

export type SandboxSingleCycleSnapshot = JsonResponse & {
  representable: boolean;
  approximate: boolean;
};

const TYPE_BY_KIND: Partial<Record<InstructionKind, InstructionType>> = {
  R: 'R', I: 'I', load: 'L', store: 'S', branch: 'B',
};

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
  instruction: { text: string; raw: number; address: number },
  nextPc: number,
  cpuData: SandboxCpuData,
  options: { registersAreFinal?: boolean } = {},
): SandboxSingleCycleSnapshot {
  const { text, raw, address: pc } = instruction;
  const decoded = decodeInstruction(raw);
  const mnemonic = text.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  const representable = isRepresentable(decoded.kind);
  const dataPath = createDataPath(TYPE_BY_KIND[decoded.kind] ?? null);
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

  if (!representable) {
    blockData.instruction_mem.value = text;
    return {
      data_path: dataPath, block_data: blockData, command_type: mnemonic, representable, approximate: false,
    };
  }

  const isBranch = decoded.kind === 'branch';
  const isLoad = decoded.kind === 'load';
  const isStore = decoded.kind === 'store';
  const isRegister = decoded.kind === 'R';
  const usesSecondRegister = isRegister || isStore || isBranch;
  const rd = isBranch || isStore ? null : decoded.rd;
  const rs1 = decoded.rs1;
  const rs2 = usesSecondRegister ? decoded.rs2 : null;
  const firstValue = cpuData.readRegister(rs1);
  const secondValue = rs2 === null ? 0 : cpuData.readRegister(rs2);
  const immediate = decoded.imm;
  const approximate = Boolean(options.registersAreFinal)
    && decoded.writes !== null
    && decoded.reads.includes(decoded.writes);

  blockData.pc.value = formatPcValue(pc, nextPc);
  blockData.pc.comment = '';
  blockData.default_adder.value = formatAdderCalculation(pc, 4);
  blockData.instruction_mem.value = text;
  blockData.instruction_mem.comment = formatInstructionFetch(pc);

  if (isBranch) {
    const branchTaken = evaluateBranch(raw, firstValue, secondValue);
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
    dataPath.zero = branchZeroFlag(raw, branchTaken);
    dataPath.branch = true;
    dataPath.branch_taken = branchTaken;
    dataPath.alu_op_0 = true;
    blockData.immediate_generator = buildImmediateDetails(immediate);
    blockData.branch_adder = { value: formatBranchTargetValue(pc, immediate) };
    blockData.registers.read_register_1 = buildRegisterReadDetails(rs1, firstValue, 'ALU input rs1');
    blockData.registers.read_register_2 = buildRegisterReadDetails(rs2, secondValue, 'ALU input rs2');
    blockData.registers.write_register = buildRegisterWriteDetails({
      rd, mnemonic, isBranch: true,
    });
    blockData.alu.alu_result = `${mnemonic.toUpperCase()} ${branchTaken ? 'taken' : 'not taken'}`;
    blockData.data_memory.read_data = 'No data read';
    blockData.data_memory.write_data = 'No data written';
  } else {
    dataPath.im_reg1 = true;
    dataPath.im_imm_gen = !isRegister;
    dataPath.reg1_mux = true;
    dataPath.mux_alu = true;
    dataPath.alu_src = !isRegister;
    dataPath.im_reg2 = isRegister || isStore;
    dataPath.reg2_mux = isRegister || isStore;
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
    blockData.immediate_generator = !isRegister ? buildImmediateDetails(immediate) : undefined;
    blockData.registers.read_register_1 = buildRegisterReadDetails(rs1, firstValue, 'ALU input rs1');
    blockData.registers.read_register_2 = isRegister || isStore
      ? buildRegisterReadDetails(rs2, secondValue, isStore ? 'Data written to memory' : 'ALU input rs2')
      : { value: 'N/A', comment: 'ALU input rs2' };
    blockData.registers.write_register = buildRegisterWriteDetails({
      rd, mnemonic, isLoad, isStore,
    });
    blockData.alu.alu_result = buildAluDetails(
      mnemonic, firstValue, secondValue, immediate,
      { isLoad, isStore, isRegister },
    );
    blockData.data_memory.read_data = isLoad ? formatMemoryRead((firstValue + immediate) >>> 0) : 'No data read';
    blockData.data_memory.write_data = isStore ? formatMemoryWrite(secondValue, (firstValue + immediate) >>> 0) : 'No data written';
  }

  if (cpuData.stopStatus === 3) {
    blockData.pc.comment += ' The program has exited after this instruction';
  }

  return {
    data_path: dataPath, block_data: blockData, command_type: mnemonic, representable, approximate,
  };
}
