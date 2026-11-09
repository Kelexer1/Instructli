export type InstructionKind =
  | 'R' | 'I' | 'load' | 'store' | 'branch' | 'jal' | 'jalr'
  | 'lui' | 'auipc' | 'system' | 'fence' | 'unknown';

export interface DecodedInstruction {
  raw: number;
  kind: InstructionKind;
  rd: number;
  rs1: number;
  rs2: number;
  imm: number;
  reads: readonly number[];
  writes: number | null;
}

const signExtend = (value: number, bits: number) => (value << (32 - bits)) >> (32 - bits);

export function decodeInstruction(word: number): DecodedInstruction {
  const raw = word >>> 0;
  const opcode = raw & 0x7f;
  const rd = (raw >>> 7) & 0x1f;
  const rs1 = (raw >>> 15) & 0x1f;
  const rs2 = (raw >>> 20) & 0x1f;
  const iImm = signExtend(raw >>> 20, 12);
  const sImm = signExtend(((raw >>> 25) << 5) | ((raw >>> 7) & 0x1f), 12);
  const bImm = signExtend(
    (((raw >>> 31) & 1) << 12) | (((raw >>> 7) & 1) << 11)
      | (((raw >>> 25) & 0x3f) << 5) | (((raw >>> 8) & 0xf) << 1),
    13,
  );
  const jImm = signExtend(
    (((raw >>> 31) & 1) << 20) | (((raw >>> 12) & 0xff) << 12)
      | (((raw >>> 20) & 1) << 11) | (((raw >>> 21) & 0x3ff) << 1),
    21,
  );

  const usesRs1 = (kind: InstructionKind) =>
    kind === 'R' || kind === 'I' || kind === 'load' || kind === 'store' || kind === 'branch' || kind === 'jalr';
  const usesRs2 = (kind: InstructionKind) => kind === 'R' || kind === 'store' || kind === 'branch';
  const make = (
    kind: InstructionKind,
    imm: number,
    sources: number[],
    writesRd: boolean,
  ): DecodedInstruction => ({
    raw,
    kind,
    rd: writesRd ? rd : 0,
    rs1: usesRs1(kind) ? rs1 : 0,
    rs2: usesRs2(kind) ? rs2 : 0,
    imm,
    reads: sources.filter((register) => register !== 0),
    writes: writesRd && rd !== 0 ? rd : null,
  });

  switch (opcode) {
    case 0x33: return make('R', 0, [rs1, rs2], true);
    case 0x13: return make('I', iImm, [rs1], true);
    case 0x03: return make('load', iImm, [rs1], true);
    case 0x23: return make('store', sImm, [rs1, rs2], false);
    case 0x63: return make('branch', bImm, [rs1, rs2], false);
    case 0x6f: return make('jal', jImm, [], true);
    case 0x67: return make('jalr', iImm, [rs1], true);
    case 0x37: return make('lui', raw & 0xfffff000, [], true);
    case 0x17: return make('auipc', raw & 0xfffff000, [], true);
    case 0x73: return make('system', 0, [], false);
    case 0x0f: return make('fence', 0, [], false);
    default: return make('unknown', 0, [], false);
  }
}

export function evaluateBranch(raw: number, first: number, second: number): boolean {
  const funct3 = (raw >>> 12) & 0x7;
  const a = first | 0;
  const b = second | 0;
  switch (funct3) {
    case 0: return first === second;
    case 1: return first !== second;
    case 4: return a < b;
    case 5: return a >= b;
    case 6: return first >>> 0 < second >>> 0;
    case 7: return first >>> 0 >= second >>> 0;
    default: return false;
  }
}
