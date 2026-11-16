import { PIPELINE_STAGES } from '@/src/data/sandbox-instructions';
import { formatHex } from '@/src/data/sandbox-messages';
import {
  branchZeroFlag, decodeInstruction, evaluateBranch, isRepresentable, type DecodedInstruction,
} from '@/src/utils/sandbox-decode';
import type {
  EXPath, IDPath, IFPath, MEMPath, PipelineState, WBPath,
} from '@/src/utils/pipeline-types';

export type PipelineStageName = typeof PIPELINE_STAGES[number];

export interface PipelineSlot {
  kind: 'inst';
  address: number;
  raw: number;
  text: string;
  decoded: DecodedInstruction;
  taken?: boolean;
  zero?: boolean;
  target?: number;
}

type Bubble = { kind: 'bubble'; reason: 'stall' | 'flush' };
type Latch = PipelineSlot | Bubble | null;

export interface FetchResult {
  raw: number;
  text: string;
}

export interface RetireResult {
  address: number;
  raw: number;
  nextPc: number;
  halted: boolean;
  blocked?: boolean;
  message?: string;
}

export class PipelineBlockedError extends Error {}

export interface PipelineEnv {
  fetch(address: number): Promise<FetchResult | null>;
  readRegisters(): Promise<readonly number[]>;
  retire(slot: PipelineSlot): Promise<RetireResult>;
}

const STALL: Bubble = { kind: 'bubble', reason: 'stall' };
const FLUSH: Bubble = { kind: 'bubble', reason: 'flush' };

function isInst(latch: Latch): latch is PipelineSlot {
  return latch !== null && latch.kind === 'inst';
}

function isRedirect(slot: PipelineSlot) {
  return slot.decoded.kind === 'branch' || slot.decoded.kind === 'jal' || slot.decoded.kind === 'jalr';
}

function findDependency(latches: Record<PipelineStageName, Latch>) {
  const consumer = latches.ID;
  if (!isInst(consumer)) return null;
  for (const stage of ['EX', 'MEM'] as const) {
    const producer = latches[stage];
    if (!isInst(producer)) continue;
    const written = producer.decoded.writes;
    if (written !== null && consumer.decoded.reads.includes(written)) {
      return { producer, consumer, stage, register: written };
    }
  }
  return null;
}

function ifPath(slot: PipelineSlot | undefined, redirected: boolean): IFPath {
  const control = slot ? slot.decoded.kind === 'branch' : false;
  return {
    branch_taken: redirected,
    mux_pc: true,
    pc_increment: !redirected,
    pc_default: !redirected,
    pc_id: control,
    pc_im: true,
    im_id: true,
  };
}

function idPath(kind: DecodedInstruction['kind']): IDPath {
  const base: IDPath = {
    id_reg1: false, id_reg2: false, id_reg_write: false, id_imm_gen: false,
    imm_ex: false, id_ex: false, reg1_ex: false, reg2_ex: false,
  };
  switch (kind) {
    case 'R': return { ...base, id_reg1: true, id_reg2: true, id_reg_write: true, reg1_ex: true, reg2_ex: true };
    case 'I':
    case 'load':
      return { ...base, id_reg1: true, id_reg_write: true, id_imm_gen: true, imm_ex: true, reg1_ex: true };
    case 'store':
      return { ...base, id_reg1: true, id_reg2: true, id_imm_gen: true, imm_ex: true, reg1_ex: true, reg2_ex: true };
    case 'branch':
      return { ...base, id_reg1: true, id_reg2: true, id_imm_gen: true, imm_ex: true, id_ex: true, reg1_ex: true, reg2_ex: true };
    default:
      return base;
  }
}

function exPath(slot: PipelineSlot): EXPath {
  const base: EXPath = {
    ex_add: false, add_mem: false, reg1_alu: false, reg2_mux: false, ex_shift: false,
    ex_mux: false, mux_alu: false, reg2_mem: false, zero_mem: false, alu_mem: false,
  };
  switch (slot.decoded.kind) {
    case 'R': return { ...base, reg1_alu: true, reg2_mux: true, mux_alu: true, alu_mem: true };
    case 'I':
    case 'load':
      return { ...base, reg1_alu: true, ex_mux: true, mux_alu: true, alu_mem: true };
    case 'store':
      return { ...base, reg1_alu: true, ex_mux: true, mux_alu: true, reg2_mem: true, alu_mem: true };
    case 'branch':
      return { ...base, ex_add: true, add_mem: true, reg1_alu: true, reg2_mux: true, ex_shift: true, mux_alu: true, zero_mem: slot.zero === true };
    default:
      return base;
  }
}

function memPath(slot: PipelineSlot): MEMPath {
  const base: MEMPath = { zero_mem2: false, alu_dm: false, reg2_dm: false, dm_wb: false, alu_wb: false };
  switch (slot.decoded.kind) {
    case 'load': return { ...base, alu_dm: true, dm_wb: true };
    case 'store': return { ...base, alu_dm: true, reg2_dm: true };
    case 'branch': return { ...base, zero_mem2: slot.zero === true };
    case 'R':
    case 'I':
      return { ...base, alu_wb: true };
    default: return base;
  }
}

function wbPath(kind: DecodedInstruction['kind']): WBPath {
  switch (kind) {
    case 'load': return { dm_mux: true, alu_mux: false, reg_write: true };
    case 'R':
    case 'I':
      return { dm_mux: false, alu_mux: true, reg_write: true };
    default: return { dm_mux: false, alu_mux: false, reg_write: false };
  }
}

export class PipelineEngine {
  readonly history: PipelineState[] = [];
  private latches: Record<PipelineStageName, Latch> = { IF: null, ID: null, EX: null, MEM: null, WB: null };
  private pc: number;
  private cycle = 0;
  private fetchBlocked = false;
  private halted = false;

  constructor(startPc: number) {
    this.pc = startPc >>> 0;
  }

  get finished() {
    return (this.halted || this.fetchBlocked) && PIPELINE_STAGES.every((stage) => !isInst(this.latches[stage]));
  }

  get current(): PipelineState | null {
    return this.history[this.history.length - 1] ?? null;
  }

  async step(env: PipelineEnv): Promise<PipelineState> {
    const prev = this.latches;
    const notes: string[] = [];
    const next: Record<PipelineStageName, Latch> = { IF: null, ID: null, EX: null, MEM: prev.EX, WB: prev.MEM };
    let fetchNeeded = false;

    if (findDependency(prev)) {
      next.EX = STALL;
      next.ID = prev.ID;
      next.IF = prev.IF;
    } else {
      next.EX = prev.ID;
      next.ID = prev.IF;
      fetchNeeded = true;
    }

    let flushed = false;
    const flushYounger = () => {
      flushed = true;
      next.IF = FLUSH;
      next.ID = FLUSH;
      next.EX = FLUSH;
      fetchNeeded = false;
    };

    if (isInst(next.WB)) {
      const retired = next.WB;
      const result = await env.retire(retired);
      if (result.blocked) throw new PipelineBlockedError(result.message ?? 'The emulator is waiting for input.');
      const expectedNext = retired.taken ? retired.target : retired.address + 4;
      if (result.address !== retired.address || result.raw !== retired.raw) {
        flushYounger();
        next.MEM = FLUSH;
        this.pc = result.nextPc >>> 0;
        this.fetchBlocked = false;
        notes.push(
          `Flush: the instruction that retired at ${formatHex(result.address)} is not the one that was fetched `
          + `(code or registers changed while it was in flight). Fetching restarts at ${formatHex(this.pc)}.`,
        );
      } else if (result.halted) {
        this.halted = true;
        flushYounger();
        next.MEM = FLUSH;
        if (result.message) notes.push(result.message);
      } else if (!result.halted && result.nextPc >>> 0 !== (expectedNext ?? 0) >>> 0) {
        flushYounger();
        next.MEM = FLUSH;
        this.pc = result.nextPc >>> 0;
        this.fetchBlocked = false;
        notes.push(`Flush: execution continued at ${formatHex(this.pc)} instead of the predicted path.`);
      }
    }

    if (isInst(next.EX) && isRedirect(next.EX) && next.EX.taken === undefined) {
      const registers = await env.readRegisters();
      const slot = next.EX;
      const { decoded } = slot;
      if (decoded.kind === 'branch') {
        slot.taken = evaluateBranch(decoded.raw, registers[decoded.rs1] ?? 0, registers[decoded.rs2] ?? 0);
        slot.zero = branchZeroFlag(decoded.raw, slot.taken);
        slot.target = (slot.address + decoded.imm) >>> 0;
      } else if (decoded.kind === 'jal') {
        slot.taken = true;
        slot.target = (slot.address + decoded.imm) >>> 0;
      } else {
        slot.taken = true;
        slot.target = (((registers[decoded.rs1] ?? 0) + decoded.imm) & ~1) >>> 0;
      }
    }

    if (isInst(next.MEM) && isRedirect(next.MEM) && next.MEM.taken && next.MEM.target !== undefined && !flushed) {
      flushYounger();
      this.pc = next.MEM.target >>> 0;
      this.fetchBlocked = false;
    }

    if (fetchNeeded && !this.halted && !this.fetchBlocked) {
      const fetched = await env.fetch(this.pc);
      if (fetched) {
        next.IF = {
          kind: 'inst',
          address: this.pc,
          raw: fetched.raw >>> 0,
          text: fetched.text,
          decoded: decodeInstruction(fetched.raw),
        };
        const slot = next.IF;
        if (slot.decoded.kind === 'branch' || slot.decoded.kind === 'jal') {
          slot.target = (slot.address + slot.decoded.imm) >>> 0;
        }
        this.pc = (this.pc + 4) >>> 0;
      } else {
        this.fetchBlocked = true;
      }
    }

    this.latches = next;
    this.cycle += 1;
    return this.record(notes);
  }

  invalidate(address: number, size: number, reason: string): PipelineState | null {
    const first = address >>> 0;
    const last = first + Math.max(size, 1) - 1;
    const order: PipelineStageName[] = ['MEM', 'EX', 'ID', 'IF'];
    let oldest: PipelineStageName | null = null;
    for (const stage of order) {
      const latch = this.latches[stage];
      if (isInst(latch) && latch.address + 3 >= first && latch.address <= last) {
        oldest = stage;
        break;
      }
    }
    if (!oldest) return null;

    const flushed = order.slice(order.indexOf(oldest));
    const restart = this.latches[oldest] as PipelineSlot;
    for (const stage of flushed) this.latches[stage] = FLUSH;
    this.pc = restart.address;
    this.fetchBlocked = false;
    this.history.pop();
    return this.record([reason]);
  }

  private record(notes: string[]): PipelineState {
    const state = this.buildState(notes);
    this.history.push(state);
    return state;
  }

  private buildState(notes: string[]): PipelineState {
    const hazards = [...notes];
    const dependency = findDependency(this.latches);
    if (dependency) {
      hazards.push(
        `Data hazard: ${dependency.consumer.text} needs x${dependency.register} from ${dependency.producer.text}, `
        + `which is in ${dependency.stage} and has not written back yet. The instruction is held in ID and a bubble enters EX.`,
      );
    }
    const resolving = this.latches.MEM;
    const redirected = isInst(resolving) && isRedirect(resolving) && resolving.taken === true && resolving.target !== undefined;
    if (redirected) {
      hazards.push(
        `Control hazard: ${resolving.text} is taken. The PC becomes ${formatHex(resolving.target ?? 0)} `
        + 'and the younger instructions in IF, ID and EX are flushed.',
      );
    }

    const stages: PipelineState['stages'] = {};
    const stageDetails: NonNullable<PipelineState['stageDetails']> = {};
    const component: NonNullable<PipelineState['component']> = { WB: null };
    const slots: NonNullable<PipelineState['slots']> = {};

    for (const stage of PIPELINE_STAGES) {
      const latch = this.latches[stage];
      if (latch === null) continue;
      if (!isInst(latch)) {
        stages[stage] = latch.reason === 'stall' ? 'bubble' : 'bubble(flush)';
        continue;
      }
      stages[stage] = latch.text;
      const { decoded } = latch;
      const representable = isRepresentable(decoded.kind);
      slots[stage] = { address: latch.address, target: latch.target, taken: latch.taken, representable };
      if (!representable) continue;
      switch (stage) {
        case 'IF':
          stageDetails.IF = ifPath(latch, false);
          component.IF = {
            pc: { value: `PC = ${formatHex(latch.address)} → ${formatHex(latch.address + 4)}`, comment: '' },
            instruction_mem: { value: latch.text, comment: '' },
            default_adder: { value: '' },
          };
          break;
        case 'ID':
          stageDetails.ID = idPath(decoded.kind);
          component.ID = {
            registers: {
              read_register_1: { value: decoded.reads.length > 0 ? `x${decoded.rs1}` : 'N/A', comment: '' },
              read_register_2: { value: decoded.kind === 'R' || decoded.kind === 'store' || decoded.kind === 'branch' ? `x${decoded.rs2}` : 'N/A', comment: '' },
              write_register: { value: decoded.writes !== null ? `x${decoded.writes}` : 'N/A', comment: '' },
            },
            ...(decoded.kind !== 'R' ? { imm_gen: { value: `Immediate: ${formatHex(decoded.imm)}` } } : {}),
          };
          break;
        case 'EX':
          stageDetails.EX = exPath(latch);
          component.EX = { alu: { alu_result: '' } };
          if (latch.target !== undefined && decoded.kind === 'branch') {
            component.EX.branch_adder = {
              value: `${formatHex(latch.address)} + ${formatHex(decoded.imm)} = ${formatHex(latch.target)}`,
            };
          }
          break;
        case 'MEM':
          stageDetails.MEM = memPath(latch);
          component.MEM = {
            data_memory: {
              read_data: decoded.kind === 'load' ? 'Data loaded from the calculated address' : 'No data read',
              write_data: decoded.kind === 'store' ? 'Data written to the calculated address' : 'No data written',
            },
          };
          break;
        case 'WB':
          stageDetails.WB = wbPath(decoded.kind);
          break;
      }
    }

    if (redirected && isInst(resolving) && resolving.decoded.kind === 'branch') {
      stageDetails.IF = ifPath(undefined, true);
      component.IF = {
        pc: { value: `PC = ${formatHex(resolving.target ?? 0)}`, comment: '' },
        instruction_mem: { value: '', comment: '' },
        default_adder: { value: '' },
      };
    }

    return { cycle: this.cycle, stages, hazards, stageDetails, component, slots };
  }
}
