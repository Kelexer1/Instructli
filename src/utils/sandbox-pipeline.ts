import { instructionTypeMap } from '@/src/utils/pipeline-types';
import {
  PIPELINE_STAGES,
  isBranchInstruction,
  isStoreInstruction,
} from '@/src/data/sandbox-instructions';
import { handlePipeLinePreset, simulatePipeline } from '@/src/utils/pipeline-processor';
import type { DisassemblyInstruction } from '@/src/utils/wasm-debugger';
import type { PipelineState } from '@/src/utils/pipeline-types';

function normalizeInstruction(text: string) {
  return text.replace(/,/g, ' ').trim().replace(/\s+/g, ' ');
}

function isSupportedInstruction(instruction: string) {
  return instructionTypeMap[instruction.split(' ')[0]?.toLowerCase() ?? ''] !== undefined;
}

function getSupportedInstructions(instructions: readonly DisassemblyInstruction[]) {
  return instructions
    .map((instruction) => normalizeInstruction(instruction.text))
    .filter((instruction) => instruction.length > 0)
    .filter(isSupportedInstruction);
}

function getMatchingPreset(instructions: string[]) {
  const presets = [
    ['add x28 x29 x31', 'sub x5 x28 x6'],
    ['add x28 x29 x31', 'li x29 10', 'addi x28 x5 10'],
  ];
  const match = presets.findIndex((preset) =>
    preset.length === instructions.length
    && preset.every((instruction, index) => instruction === instructions[index]),
  );
  if (match !== -1) return [0, 3][match];

  const [first, branch, third] = instructions;
  const branchOperands = branch?.split(' ');
  if (
    instructions.length === 3
    && first === 'add x30 x31 x5'
    && branchOperands?.[0] === 'beq'
    && branchOperands[1] === 'x1'
    && branchOperands[2] === 'x0'
    && third === 'addi x28 x0 10'
  ) {
    return 1;
  }

  return null;
}

export function createSandboxPipelineSnapshot(
  instructions: readonly DisassemblyInstruction[],
): PipelineState[] {
  const supportedInstructions = getSupportedInstructions(instructions);
  if (supportedInstructions.length === 0) return [];

  const preset = getMatchingPreset(supportedInstructions);
  if (preset !== null) {
    const states = handlePipeLinePreset(preset);
    if (preset !== 1) return states;

    return states.map((state) => {
      if (state.cycle === 3) {
        return {
          ...state,
          hazards: [
            'Control hazard: branch decision is not known while the sequential instruction is fetched speculatively.',
          ],
        };
      }
      if (state.cycle === 4) {
        return {
          ...state,
          hazards: [
            'Control hazard: branch is executing in EX; the younger instructions will be flushed if the branch is taken.',
          ],
        };
      }
      if (state.cycle === 5) {
        return {
          ...state,
          stages: {
            ...state.stages,
            IF: 'bubble(flush)',
          },
          hazards: [
            'Control hazard: branch taken. The speculative instructions in ID and EX are flushed.',
          ],
        };
      }
      return state;
    });
  }

  const baseline = simulatePipeline(supportedInstructions);
  const normalized = supportedInstructions;
  const fetchStarts = normalized.map((_, index) => index + 1);
  const executeStarts = normalized.map((_, index) => index + 3);
  const writers = normalized.map((instruction) => getWrittenRegister(instruction));

  for (let index = 1; index < normalized.length; index += 1) {
    const reads = getReadRegisters(normalized[index]);
    const dependencies = writers
      .slice(0, index)
      .map((register, producerIndex) => register && reads.has(register) ? producerIndex : -1)
      .filter((producerIndex) => producerIndex >= 0);
    const latestProducer = dependencies.length > 0 ? Math.max(...dependencies) : -1;
    if (latestProducer >= 0) {
      executeStarts[index] = Math.max(executeStarts[index], executeStarts[latestProducer] + 3);
    }

    fetchStarts[index] = Math.max(fetchStarts[index], fetchStarts[index - 1] + 1);
  }

  const branchIndex = normalized.findIndex((instruction) => isBranch(instruction));
  const branchOutcome = branchIndex >= 0 ? getKnownBranchOutcome(normalized[branchIndex]) : null;
  const lastVisibleInstruction = branchIndex >= 0 && branchOutcome === true
    ? branchIndex
    : normalized.length - 1;
  const endCycle = Math.max(
    ...executeStarts.slice(0, lastVisibleInstruction + 1).map((start) => start + 3),
    normalized.length + 5,
  );
  const templates = new Map<string, PipelineState>();
  for (const state of baseline) {
    for (const stage of PIPELINE_STAGES) {
      const instruction = state.stages[stage];
      if (instruction && !instruction.includes('bubble')) {
        templates.set(`${stage}:${normalizeInstruction(instruction)}`, state);
      }
    }
  }

  return Array.from({ length: endCycle }, (_, cycleIndex) => {
    const cycle = cycleIndex + 1;
    const stages: PipelineState['stages'] = {};
    const stageDetails: NonNullable<PipelineState['stageDetails']> = {};
    const component: NonNullable<PipelineState['component']> = { WB: null };
    const hazards: string[] = [];

    normalized.slice(0, lastVisibleInstruction + 1).forEach((instruction, index) => {
      const fetch = fetchStarts[index];
      const execute = executeStarts[index];
      if (branchIndex >= 0 && branchOutcome === true
        && index > branchIndex && cycle >= executeStarts[branchIndex]) return;
      const visible = (stage: 'IF' | 'ID' | 'EX' | 'MEM' | 'WB', start: number) => {
        if (cycle !== start) return;
        stages[stage] = supportedInstructions[index];
        const template = templates.get(`${stage}:${instruction}`);
        if (!template) return;
        switch (stage) {
          case 'IF':
            if (template.stageDetails?.IF) stageDetails.IF = template.stageDetails.IF;
            if (template.component?.IF !== undefined) component.IF = template.component.IF;
            break;
          case 'ID':
            if (template.stageDetails?.ID) stageDetails.ID = template.stageDetails.ID;
            if (template.component?.ID !== undefined) component.ID = template.component.ID;
            break;
          case 'EX':
            if (template.stageDetails?.EX) stageDetails.EX = template.stageDetails.EX;
            if (template.component?.EX !== undefined) component.EX = template.component.EX;
            break;
          case 'MEM':
            if (template.stageDetails?.MEM) stageDetails.MEM = template.stageDetails.MEM;
            if (template.component?.MEM !== undefined) component.MEM = template.component.MEM;
            break;
          case 'WB':
            if (template.stageDetails?.WB) stageDetails.WB = template.stageDetails.WB;
            break;
        }
      };

      visible('IF', fetch);
      if (cycle >= fetch + 1 && cycle < execute) {
        visible('ID', cycle);
      }
      visible('EX', execute);
      visible('MEM', execute + 1);
      visible('WB', execute + 2);
      if (
        cycle >= fetch + 1
        && cycle < execute
        && execute > fetch + 2
        && !stages.EX
      ) {
        stages.EX = 'bubble';
      }
    });

    const dataHazard = normalized.some((instruction, index) =>
      index > 0
      && cycle >= fetchStarts[index] + 1
      && cycle < executeStarts[index]
      && executeStarts[index] > index + 3
      && writers.slice(0, index).some((writer) => writer !== null && getReadRegisters(instruction).has(writer)),
    );
    if (dataHazard) hazards.push('Data hazard: dependent instruction is held in ID until the producer reaches WB. An EX bubble is inserted.');

    if (branchIndex >= 0 && cycle === executeStarts[branchIndex]) {
      hazards.push(branchOutcome === false
        ? `Control hazard: ${supportedInstructions[branchIndex]} is not taken. The sequential instructions continue through the pipeline.`
        : `Control hazard: ${supportedInstructions[branchIndex]} changes control flow. Younger instructions are flushed.`);
    }

    return {
      cycle,
      stages,
      hazards,
      stageDetails,
      component,
    };
  });
}

function getReadRegisters(instruction: string) {
  const [mnemonic, ...operands] = instruction.split(' ');
  const registers = operands.filter((operand) => /^x\d+$/i.test(operand));
  if (isStoreInstruction(mnemonic)) return new Set(registers);
  if (isBranch(instruction)) return new Set(registers.slice(0, 2));
  return new Set(registers.slice(1));
}

function getWrittenRegister(instruction: string) {
  const [mnemonic, destination] = instruction.split(' ');
  if (isStoreInstruction(mnemonic) || isBranchInstruction(mnemonic)) return null;
  return /^x\d+$/i.test(destination ?? '') ? destination : null;
}

function isBranch(instruction: string) {
  return isBranchInstruction(instruction.split(' ')[0] ?? '');
}

function getKnownBranchOutcome(instruction: string): boolean | null {
  const [mnemonic, rs1, rs2] = instruction.split(' ');
  if (!isBranch(instruction) || !rs1 || !rs2) return null;
  if (rs1 === rs2) return mnemonic === 'beq' || mnemonic === 'bge' || mnemonic === 'bgeu';
  if (rs1 !== 'x0' || rs2 !== 'x0') return null;
  return mnemonic === 'beq' || mnemonic === 'bge' || mnemonic === 'bgeu';
}
