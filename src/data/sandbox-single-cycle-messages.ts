import type { Block_Data } from '@/src/utils/return-types';
import { buildSandboxHoverMessage } from '@/src/data/sandbox-hover-messages';

export function buildSandboxSingleCycleHoverText(
  label: string | null,
  blockData: Block_Data,
): string | null {
  if (!label) return null;

  const instruction = blockData.instruction_mem.value || 'No instruction is currently being modeled.';
  const mnemonic = instruction.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return buildSandboxHoverMessage(label, {
    instruction,
    pc: Number(blockData.pc.value.match(/PC (0x[0-9A-F]+) →/)?.[1] ?? 0),
    instructionAddress: Number.parseInt(blockData.instruction_mem.comment.match(/0x[0-9A-F]+/)?.[0] ?? '0', 16),
    pcAdder: blockData.default_adder.value,
    registerFile: {
      read1: blockData.registers.read_register_1.value,
      read2: blockData.registers.read_register_2.value,
      write: blockData.registers.write_register.value,
      writeDetails: blockData.registers.write_register,
      upperImmediate: blockData.registers.read_register_1.value === 'N/A',
      conditionalBranch: mnemonic.startsWith('b'),
    },
    immediateGenerator: {
      value: blockData.immediate_generator?.value,
      usesImmediate: Boolean(blockData.immediate_generator),
    },
    alu: blockData.alu.alu_result,
    branchAdder: {
      value: blockData.branch_adder?.value,
      usesBranch: Boolean(blockData.branch_adder),
    },
    aluInputMux: blockData.immediate_generator?.value ?? blockData.registers.read_register_2.value,
    dataMemory: {
      readData: blockData.data_memory.read_data,
      writeData: blockData.data_memory.write_data,
    },
    nextPcMux: blockData.pc.value,
    writeBackMux: blockData.registers.write_register.value,
  });
}
