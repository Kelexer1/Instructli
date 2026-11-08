import { CommandType, instructionTypeMap } from '@/src/utils/pipeline-types';

export const BRANCH_INSTRUCTIONS = ['beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu'] as const;
export const JUMP_INSTRUCTIONS = ['jal', 'jalr'] as const;
export const UPPER_IMMEDIATE_INSTRUCTIONS = ['lui', 'auipc'] as const;
export const IMMEDIATE_INSTRUCTIONS = [
  'addi', 'andi', 'ori', 'xori', 'slli', 'srli', 'srai', 'slti', 'sltiu',
  'lw', 'lh', 'lb', 'lbu', 'lhu', 'sw', 'sh', 'sb',
] as const;
export const LOAD_INSTRUCTIONS = ['lb', 'lh', 'lw', 'lbu', 'lhu'] as const;
export const STORE_INSTRUCTIONS = ['sb', 'sh', 'sw'] as const;
export const NO_SINGLE_CYCLE_HOVER_INSTRUCTIONS = ['ecall', 'ebreak', 'fence', 'fence.i'] as const;

export const PIPELINE_STAGES = ['IF', 'ID', 'EX', 'MEM', 'WB'] as const;

export function isBranchInstruction(mnemonic: string) {
  return BRANCH_INSTRUCTIONS.includes(mnemonic as typeof BRANCH_INSTRUCTIONS[number])
    || JUMP_INSTRUCTIONS.includes(mnemonic as typeof JUMP_INSTRUCTIONS[number]);
}

export function isConditionalBranch(mnemonic: string) {
  return BRANCH_INSTRUCTIONS.includes(mnemonic as typeof BRANCH_INSTRUCTIONS[number]);
}

export function isUpperImmediateInstruction(mnemonic: string) {
  return UPPER_IMMEDIATE_INSTRUCTIONS.includes(mnemonic as typeof UPPER_IMMEDIATE_INSTRUCTIONS[number]);
}

export function usesImmediateInstruction(mnemonic: string) {
  return IMMEDIATE_INSTRUCTIONS.includes(mnemonic as typeof IMMEDIATE_INSTRUCTIONS[number])
    || BRANCH_INSTRUCTIONS.includes(mnemonic as typeof BRANCH_INSTRUCTIONS[number])
    || UPPER_IMMEDIATE_INSTRUCTIONS.includes(mnemonic as typeof UPPER_IMMEDIATE_INSTRUCTIONS[number]);
}

export function isLoadInstruction(mnemonic: string) {
  return LOAD_INSTRUCTIONS.includes(mnemonic as typeof LOAD_INSTRUCTIONS[number]);
}

export function isStoreInstruction(mnemonic: string) {
  return STORE_INSTRUCTIONS.includes(mnemonic as typeof STORE_INSTRUCTIONS[number]);
}

export function isRegisterWritingInstruction(mnemonic: string) {
  const commandType = instructionTypeMap[mnemonic];
  return commandType === CommandType.RType
    || commandType === CommandType.UType
    || (commandType === CommandType.IType && !isStoreInstruction(mnemonic) && !isBranchInstruction(mnemonic));
}
