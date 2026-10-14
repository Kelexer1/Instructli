import type { Block_Data } from '@/src/utils/return-types';

export function buildSandboxSingleCycleHoverText(
  label: string | null,
  blockData: Block_Data,
): string | null {
  if (!label) return null;

  const instruction = blockData.instruction_mem.value || 'No instruction is currently being modeled.';
  const mnemonic = instruction.trim().split(/\s+/)[0]?.toLowerCase();
  if (mnemonic === 'jal' || mnemonic === 'jalr' || mnemonic === 'ecall' || mnemonic === 'ebreak' || mnemonic === 'fence' || mnemonic === 'fence.i') {
    return null;
  }

  switch (label) {
    case 'INSTRUCTION MEMORY':
      return `INSTRUCTION MEMORY\nStores all program instructions and outputs the instruction at the given address.\n\nInstruction: ${instruction}\n\n${blockData.instruction_mem.comment}`;
    case 'PC':
      return `PROGRAM COUNTER (PC)\nHolds the address of the current instruction being executed.\n\nInstruction: ${instruction}\n\n${blockData.pc.value}\n${blockData.pc.comment}`;
    case 'DATA MEMORY':
      return `DATA MEMORY\nStores program data (loaded by lw, stored by sw). Allows reading and writing in a single cycle.\n\nInstruction: ${instruction}\n\n${blockData.data_memory.read_data}\n${blockData.data_memory.write_data}`;
    case 'REGISTER FILE':
      return (
        `REGISTER FILE\nStores CPU registers (x0–x31). Allows simultaneous reading of two registers and writing one register per cycle.\n\nInstruction: ${instruction}\n\n` +
        `${blockData.registers.read_register_1.comment}:  ${blockData.registers.read_register_1.value}\n` +
        `${blockData.registers.read_register_2.comment}:  ${blockData.registers.read_register_2.value}\n\n` +

        `${blockData.registers.write_register.comment}:  ${blockData.registers.write_register.value}\n\n`
      );
    case 'IMMEDIATE GENERATOR':
      return `IMMEDIATE GENERATOR\nExtracts the instruction's immediate field and formats it for use by the datapath (including positioning the 20-bit field for upper-immediate instructions).\n\nInstruction: ${instruction}\n\n${blockData.immediate_generator?.value ?? 'This instruction does not use an immediate'}`;
    case 'ALU':
      return `ARITHMETIC LOGIC UNIT (ALU)\nPerforms arithmetic (add, subtract) and logical (and, or) operations on two 32-bit operands.\n\nInstruction: ${instruction}\n\n${blockData.alu.alu_result}`;
    case 'ADD (Branch Target)':
      return `ADDER (Branch Target)\nComputes the branch target address by adding the sign-extended immediate to the PC.\n\nInstruction: ${instruction}\n\n${blockData.branch_adder?.value ?? 'This instruction does not use a branch target'}`;
    case 'ADD (PC + 4)':
      return `ADDER (PC + 4)\nComputes the next sequential program counter value by adding 4 to the current PC.\n\nInstruction: ${instruction}\n\n${blockData.default_adder.value}`;
    case 'MUX (Next PC)':
      return `MULTIPLEXER (Next PC)\nSelects between the sequential PC (PC+4) or branch target address based on the branch condition.\n\nInstruction: ${instruction}\n\n${blockData.pc.value}`;
    case 'MUX (ALU Input)':
      return `MULTIPLEXER (ALU Input)\nSelects the second operand for the ALU: either a register value or the immediate value.\n\nInstruction: ${instruction}\n\n${
        blockData.immediate_generator?.value ?? blockData.registers.read_register_2.value
      }`;
    case 'MUX (Write Back)':
      return `MULTIPLEXER (Write Back)\nSelects which value to write back to the register file: ALU result or data from memory.\n\nInstruction: ${instruction}\n\n${blockData.registers.write_register.value}`;
    default:
      return label;
  }
}
