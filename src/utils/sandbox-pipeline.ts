import { instructionTypeMap } from '@/src/utils/pipeline-types';
import {
  PIPELINE_STAGES,
  isBranchInstruction,
  isStoreInstruction,
} from '@/src/data/sandbox-instructions';
import { handlePipeLinePreset, simulatePipeline } from '@/src/utils/sandbox-pipeline-processor';
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
  branchTargets: Readonly<Record<string, number>> = {},
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
  const writers = normalized.map((instruction) => getWrittenRegister(instruction));
  const fetchStarts: number[] = [];
  const idStarts: number[] = [];
  const executeStarts: number[] = [];

  for (let index = 0; index < normalized.length; index += 1) {
    const fetchStart = index === 0
      ? 1
      : Math.max(index + 1, idStarts[index - 1]);
    const idStart = Math.max(fetchStart + 1, executeStarts[index - 1] ?? 0);
    const reads = getReadRegisters(normalized[index]);
    const dependencyExecuteStart = writers
      .slice(0, index)
      .reduce((latestExecuteStart, register, producerIndex) => {
        if (!register || !reads.has(register)) return latestExecuteStart;
        return Math.max(latestExecuteStart, executeStarts[producerIndex] + 3);
      }, idStart + 1);
    const executeStart = dependencyExecuteStart;

    fetchStarts.push(fetchStart);
    idStarts.push(idStart);
    executeStarts.push(executeStart);
  }

  const branchIndex = normalized.findIndex((instruction) => isBranch(instruction));
  const branchOutcome = branchIndex >= 0 ? getKnownBranchOutcome(normalized[branchIndex]) : null;
  const instructionAddresses = new Map(
    instructions.map((instruction) => [normalizeInstruction(instruction.text), instruction.address]),
  );
  const branchTargetAddress = branchIndex >= 0
    ? branchTargets[normalized[branchIndex]]
    : undefined;
  const branchTargetIndex = branchTargetAddress === undefined
    ? -1
    : normalized.findIndex((instruction) => instructionAddresses.get(instruction) === branchTargetAddress);
  const hasResolvedTakenBranch = branchOutcome === true && branchTargetIndex > branchIndex;
  const lastVisibleInstruction = normalized.length - 1;
  const redirectFetchStarts = [...fetchStarts];
  const redirectIdStarts = [...idStarts];
  const redirectExecuteStarts = [...executeStarts];

  if (hasResolvedTakenBranch) {
    redirectFetchStarts[branchTargetIndex] = executeStarts[branchIndex] + 2;
    redirectIdStarts[branchTargetIndex] = redirectFetchStarts[branchTargetIndex] + 1;
    redirectExecuteStarts[branchTargetIndex] = redirectIdStarts[branchTargetIndex] + 1;
    for (let index = branchTargetIndex + 1; index < normalized.length; index += 1) {
      redirectFetchStarts[index] = redirectFetchStarts[index - 1] + 1;
      redirectIdStarts[index] = redirectFetchStarts[index] + 1;
      redirectExecuteStarts[index] = redirectIdStarts[index] + 1;
    }
  }

  const endCycle = Math.max(
    ...redirectExecuteStarts.slice(0, lastVisibleInstruction + 1).map((start) => start + 3),
    normalized.length + 5,
  );
  const flushCycle = hasResolvedTakenBranch ? executeStarts[branchIndex] + 1 : -1;
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
      const isRedirected = hasResolvedTakenBranch
        && index >= branchTargetIndex
        && cycle >= flushCycle + 1;
      const isSpeculative = hasResolvedTakenBranch
        && index > branchIndex
        && cycle >= flushCycle
        && !isRedirected;
      if (isSpeculative) return;
      const fetch = isRedirected ? redirectFetchStarts[index] : fetchStarts[index];
      const id = isRedirected ? redirectIdStarts[index] : idStarts[index];
      const execute = isRedirected ? redirectExecuteStarts[index] : executeStarts[index];
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

      if (cycle >= fetch && cycle < id) visible('IF', cycle);
      if (cycle >= id && cycle < execute) visible('ID', cycle);
      visible('EX', execute);
      visible('MEM', execute + 1);
      visible('WB', execute + 2);
    });

    const stalledInstructions = normalized.flatMap((instruction, index) => {
      if (index === 0 || cycle < idStarts[index] || cycle >= executeStarts[index]) {
        return [];
      }

      const reads = getReadRegisters(instruction);
      return writers.slice(0, index).flatMap((writer, producerIndex) =>
        writer !== null
        && reads.has(writer)
        && executeStarts[index] > idStarts[index] + 1
        && cycle < executeStarts[producerIndex] + 3
          ? [{ producerIndex }]
          : [],
      );
    });
    if (stalledInstructions.length > 0) {
      if (!stages.EX) stages.EX = 'bubble';
      const producerInWB = stalledInstructions.some(({ producerIndex }) =>
        cycle >= executeStarts[producerIndex] + 2,
      );
      if (producerInWB && !stages.MEM) stages.MEM = 'bubble';
    }

    if (hasResolvedTakenBranch && cycle >= flushCycle) {
      const bubbleProgressions = [
        { startStage: 'IF' as const, instruction: 'bubble(flush)' },
        { startStage: 'ID' as const, instruction: 'bubble(flush)' },
        { startStage: 'EX' as const, instruction: 'bubble(flush)' },
      ];
      bubbleProgressions.forEach(({ startStage, instruction }) => {
        const startOffset = PIPELINE_STAGES.indexOf(startStage);
        const currentStage = PIPELINE_STAGES[startOffset + cycle - flushCycle];
        if (currentStage) stages[currentStage] = instruction;
      });
    }

    const dataHazard = normalized.some((instruction, index) => {
      if (index === 0 || cycle < idStarts[index] || cycle >= executeStarts[index]) {
        return false;
      }

      const reads = getReadRegisters(instruction);
      return writers.slice(0, index).some((writer, producerIndex) =>
        writer !== null
        && reads.has(writer)
        && cycle < executeStarts[producerIndex] + 3,
      );
    });
    if (dataHazard) hazards.push('Data hazard: dependent instruction is held in ID until the producer reaches WB. An EX bubble is inserted.');

    if (branchIndex >= 0 && cycle === executeStarts[branchIndex] + 1) {
      hazards.push(branchOutcome === false
        ? `Control hazard: ${supportedInstructions[branchIndex]} is not taken. The sequential instructions continue through the pipeline.`
        : branchOutcome === true
          ? `Control hazard: ${supportedInstructions[branchIndex]} is taken in MEM. The younger instructions in ID and EX are flushed.`
          : `Control hazard: ${supportedInstructions[branchIndex]} has an unresolved outcome.`);
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
