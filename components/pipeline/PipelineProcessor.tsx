import { useState } from "react";
import React from "react";
import type {
  IFPath, IDPath, EXPath, MEMPath, WBPath,
  IFComponents, IDComponents, EXComponents, MEMComponents, PipelineState,
} from "../../src/utils/pipeline-types";
import type { WasmRegister } from "../../src/utils/wasm-debugger";
import PipelineDatapathSVG from "./PipelineDatapathSVG";

type PipelineProcessorProps = {
  results: PipelineState[];
  currCycle: number;
  currentPreset: { index: number; note: string } | null;
  registers?: WasmRegister[];
  instructionAddresses?: Record<string, number>;
  branchTargets?: Record<string, number>;
};

const defaultIFPath: IFPath = {
  branch_taken: false, mux_pc: false, pc_increment: false,
  pc_default: false, pc_id: false, pc_im: false, im_id: false,
};
const defaultIDPath: IDPath = {
  id_reg1: false, id_reg2: false, id_reg_write: false, id_imm_gen: false,
  imm_ex: false, id_ex: false, reg1_ex: false, reg2_ex: false,
};
const defaultEXPath: EXPath = {
  ex_add: false, add_mem: false, reg1_alu: false, reg2_mux: false,
  ex_shift: false, ex_mux: false, mux_alu: false, reg2_mem: false,
  zero_mem: false, alu_mem: false,
};
const defaultMEMPath: MEMPath = {
  zero_mem2: false, alu_dm: false, reg2_dm: false, dm_wb: false, alu_wb: false,
};
const defaultWBPath: WBPath = {
  dm_mux: false, alu_mux: false, reg_write: false,
};

const defaultIFComponents: IFComponents = {
  pc: { value: "", comment: "" },
  instruction_mem: { value: "", comment: "" },
  default_adder: { value: "" },
};
const defaultIDComponents: IDComponents = {
  registers: {
    read_register_1: { value: "", comment: "" },
    read_register_2: { value: "", comment: "" },
    write_register: { value: "", comment: "" },
  },
};
const defaultEXComponents: EXComponents = { alu: { alu_result: "" } };
const defaultMEMComponents: MEMComponents = {
  data_memory: { read_data: "", write_data: "" },
};

function instructionParts(instruction: string) {
  return instruction.replace(/,/g, " ").trim().split(/\s+/);
}

function registerOperands(instruction: string) {
  const [mnemonic, ...operands] = instructionParts(instruction);
  if (!mnemonic) return { mnemonic: "", rd: "", rs1: "", rs2: "", immediate: "" };

  const isBranch = ["beq", "bne", "blt", "bge", "bltu", "bgeu"].includes(mnemonic);
  const isUpperImmediate = ["lui", "auipc"].includes(mnemonic);
  const usesImmediate = ["addi", "andi", "ori", "xori", "slli", "srli", "srai", "slti", "sltiu", "lw", "lh", "lb", "lbu", "lhu", "sw", "sh", "sb"].includes(mnemonic);
  const memoryOperand = operands.find((operand) => /^\-?\d+\(x\d+\)$/.test(operand));
  const memoryBase = memoryOperand?.match(/\((x\d+)\)/)?.[1] ?? "";
  return {
    mnemonic,
    rd: isBranch ? "" : operands[0] ?? "",
    rs1: isBranch || isUpperImmediate ? (isBranch ? operands[0] ?? "" : "") : memoryBase || operands[1] || "",
    rs2: isBranch ? operands[1] ?? "" : usesImmediate || memoryOperand ? "" : operands[2] || "",
    immediate: memoryOperand?.split("(")[0] ?? (isUpperImmediate ? operands[1] : operands[2]) ?? "",
  };
}

function componentValue(value: string, fallback: string) {
  return value && value !== "N/A" ? value : fallback;
}

function formatImmediate(value: string) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? `0x${(numericValue >>> 0).toString(16).padStart(8, "0").toUpperCase()}`
    : value || "N/A";
}

function formatHex(value: number) {
  return `0x${(value >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
}

function formatPipelineValue(value: string) {
  return value.replace(/Val\(x0\)/g, formatHex(0)).replace(/\bx0\b/g, formatHex(0));
}

function formatRegisterValue(value: string, register: string, registers?: WasmRegister[]) {
  const registerNumber = Number(register.slice(1));
  const liveValue = registers?.find((entry) => entry.number === registerNumber)?.value;
  const normalized = liveValue === undefined
    ? formatPipelineValue(componentValue(value, "N/A"))
    : formatHex(liveValue);
  return `${register} = ${normalized}`;
}

function registerValue(register: string, registers?: WasmRegister[]) {
  return formatRegisterValue("", register, registers).split(" = ")[1];
}

function isBranchInstruction(mnemonic: string) {
  return ["beq", "bne", "blt", "bge", "bltu", "bgeu"].includes(mnemonic);
}

function branchTaken(mnemonic: string, rs1: string, rs2: string, registers?: WasmRegister[]) {
  const first = registers?.find((entry) => entry.number === Number(rs1.slice(1)))?.value;
  const second = registers?.find((entry) => entry.number === Number(rs2.slice(1)))?.value;
  if (first === undefined || second === undefined) return false;
  const signedFirst = first | 0;
  const signedSecond = second | 0;
  return mnemonic === "beq" ? first === second
    : mnemonic === "bne" ? first !== second
      : mnemonic === "blt" ? signedFirst < signedSecond
        : mnemonic === "bge" ? signedFirst >= signedSecond
          : mnemonic === "bltu" ? first < second
            : first >= second;
}

function formatMemoryValue(value: string, fallback: string) {
  const normalized = componentValue(value, fallback);
  return normalized.replace(/^(Read|Write) Data:\s*/, "");
}

function buildHoverText(
  label: string | null,
  exPath: EXPath, wbPath: WBPath,
  ifComp: IFComponents, idComp: IDComponents, exComp: EXComponents, memComp: MEMComponents,
  stageLabels: { IF?: string; ID?: string; EX?: string; MEM?: string; WB?: string },
  hazards: string[], pcValue: number | null, registers?: WasmRegister[],
  instructionAddresses?: Record<string, number>, branchTargets?: Record<string, number>,
): string | null {
  if (!label) return null;

  switch (label) {
    case "PC":
      return stageLabels.IF
        ? `PROGRAM COUNTER (PC)\nHolds the address of the current instruction being executed.\n\nInstruction: ${stageLabels.IF}\n\nPC ${formatHex(pcValue ?? 0)} → ${formatHex((pcValue ?? 0) + 4)}`
        : null;

    case "INSTRUCTION MEMORY":
      return stageLabels.IF
        ? `INSTRUCTION MEMORY\nStores all program instructions and outputs the instruction at the given address.\n\nInstruction: ${stageLabels.IF}\n\nFetched at address ${formatHex(pcValue ?? 0)}`
        : null;

    case "ADD (PC + 4)":
      return stageLabels.IF
        ? `ADDER (PC + 4)\nComputes the next sequential program counter value by adding 4 to the current PC.\n\nInstruction: ${stageLabels.IF}\n\n${pcValue === null ? formatPipelineValue(componentValue(ifComp.default_adder?.value ?? "", "PC + 4")) : `${formatHex(pcValue)} + 4 = ${formatHex(pcValue + 4)}`}`
        : null;

    case "REGISTER FILE":
      if (!stageLabels.ID) return null;
      {
        const { mnemonic, rs1, rs2, rd } = registerOperands(stageLabels.ID);
        const read1 = ["lui", "auipc"].includes(mnemonic)
          ? "N/A"
          : formatRegisterValue(idComp.registers.read_register_1.value, rs1 || "rs1", registers);
        const read2 = rs2
          ? formatRegisterValue(idComp.registers.read_register_2.value, rs2, registers)
          : "N/A";
        const writeValue = formatPipelineValue(componentValue(idComp.registers.write_register.value, rd || "N/A"));
        const write = isBranchInstruction(mnemonic)
          ? "Branches do not write a register"
          : rd && writeValue === rd ? `${rd} ← result` : writeValue;
        return `REGISTER FILE\nStores CPU registers (x0–x31). Allows simultaneous reading of two registers and writing one register per cycle.\n\nInstruction: ${stageLabels.ID}\n\n` +
          `ALU input rs1: ${read1}\n` +
          `ALU input rs2: ${read2}\n\n` +
          `${!isBranchInstruction(mnemonic) ? 'Destination register receives ALU result: ' : ''}${write}\n\n`;
      }

    case "IMMEDIATE GENERATOR":
      if (!stageLabels.ID) return null;
      {
        const { mnemonic, immediate } = registerOperands(stageLabels.ID);
        const usesImmediate = Boolean(idComp.imm_gen?.value) || ["addi", "andi", "ori", "xori", "slli", "srli", "srai", "slti", "sltiu", "lw", "lh", "lb", "lbu", "lhu", "sw", "sh", "sb", "beq", "bne", "blt", "bge", "bltu", "bgeu", "lui", "auipc"].includes(mnemonic);
        const resolvedImmediate = branchTargets?.[stageLabels.ID] !== undefined
          ? String(branchTargets[stageLabels.ID] - (instructionAddresses?.[stageLabels.ID] ?? 0))
          : immediate;
        const value = usesImmediate ? `Immediate: ${formatImmediate(resolvedImmediate)}` : "This instruction does not use an immediate";
        return `IMMEDIATE GENERATOR\nExtracts the instruction's immediate field and formats it for use by the datapath (including positioning the 20-bit field for upper-immediate instructions).\n\nInstruction: ${stageLabels.ID}\n\n${value}`;
      }

    case "ALU":
      if (!stageLabels.EX) return null;
      {
        const { mnemonic, rs1, rs2, immediate } = registerOperands(stageLabels.EX);
        const first = rs1 ? registerValue(rs1, registers) : "N/A";
        const immediateInstructions = ["addi", "andi", "ori", "xori", "slli", "srli", "srai", "slti", "sltiu", "lw", "lh", "lb", "lbu", "lhu", "sw", "sh", "sb"];
        const second = immediateInstructions.includes(mnemonic)
          ? formatImmediate(immediate)
          : rs2
            ? registerValue(rs2, registers)
            : "N/A";
        const operation = ["lui", "auipc"].includes(mnemonic)
          ? `Immediate: ${formatImmediate(immediate)}`
          : formatPipelineValue(exComp.alu.alu_result?.match(/→\s*(.*)$/)?.[1] ??
            `${mnemonic.toUpperCase()} uses ${first} and ${second}`);
        return `ARITHMETIC LOGIC UNIT (ALU)\nPerforms arithmetic (add, subtract) and logical (and, or) operations on two 32-bit operands.\n\nInstruction: ${stageLabels.EX}\n\n${operation}`;
      }

    case "ADD (Branch Target)":
      if (!stageLabels.EX) return null;
      {
        const { mnemonic, immediate } = registerOperands(stageLabels.EX);
        const instructionAddress = instructionAddresses?.[stageLabels.EX] ?? pcValue;
        const resolvedTarget = branchTargets?.[stageLabels.EX];
        const resolvedImmediate = resolvedTarget !== undefined && instructionAddress !== undefined && instructionAddress !== null
          ? String(resolvedTarget - instructionAddress)
          : immediate;
        const numericImmediate = Number(resolvedImmediate);
        const target = instructionAddress !== null && instructionAddress !== undefined && Number.isFinite(numericImmediate)
          ? `${formatHex(instructionAddress)} + ${formatImmediate(resolvedImmediate)} = ${formatHex(instructionAddress + numericImmediate)}`
          : exComp.branch_adder?.value || (isBranchInstruction(mnemonic) ? `Branch target: ${immediate}` : "This instruction does not use a branch target");
        return `ADDER (Branch Target)\nComputes the branch target address by adding the sign-extended immediate to the PC.\n\nInstruction: ${stageLabels.EX}\n\n${target}`;
      }

    case "MUX (ALU Input)":
      if (!stageLabels.EX) return null;
      {
        const { rs2, immediate } = registerOperands(stageLabels.EX);
        const resolvedImmediate = branchTargets?.[stageLabels.EX] !== undefined
          ? String(branchTargets[stageLabels.EX] - (instructionAddresses?.[stageLabels.EX] ?? 0))
          : immediate;
        const selectedValue = exPath.ex_mux
          ? `Immediate: ${formatImmediate(resolvedImmediate)}`
          : rs2
            ? `${formatRegisterValue("", rs2, registers)}`
            : "N/A";
        return `MULTIPLEXER (ALU Input)\nSelects the second operand for the ALU: either a register value or the immediate value.\n\nInstruction: ${stageLabels.EX}\n\n${selectedValue}`;
      }

    case "DATA MEMORY":
      return stageLabels.MEM
        ? `DATA MEMORY\nStores program data (loaded by lw, stored by sw). Allows reading and writing in a single cycle.\n\nInstruction: ${stageLabels.MEM}\n\n${formatMemoryValue(memComp.data_memory.read_data, "No data read")}\n${formatMemoryValue(memComp.data_memory.write_data, "No data written")}`
        : null;

    case "MUX (Next PC)":
      return stageLabels.IF
        ? `MULTIPLEXER (Next PC)\nSelects between the sequential PC (PC+4) or branch target address based on the branch condition.\n\nInstruction: ${stageLabels.IF}\n\n${pcValue === null ? formatPipelineValue(ifComp.pc.value || "N/A") : `PC ${formatHex(pcValue)} → ${formatHex(pcValue + 4)}`}`
        : null;

    case "MUX (Write Back)":
      if (!stageLabels.WB) return null;
      {
        const { rd } = registerOperands(stageLabels.WB);
        return `MULTIPLEXER (Write Back)\nSelects which value to write back to the register file: ALU result or data from memory.\n\nInstruction: ${stageLabels.WB}\n\n${rd || "N/A"} ← ${wbPath.dm_mux ? "loaded memory value" : "result"}`;
      }

    case "IF/ID":
      return `IF/ID\n\nHolds the fetched instruction and program counter while the decode stage reads the fields.\nThis lets the next cycle begin ID without waiting for IF to finish.`;

    case "ID/EX":
      return `ID/EX\n\nCarries decoded register values, control signals, and immediate values into the execute stage.\nIt separates instruction decode from execution.`;

    case "EX/MEM":
      return `EX/MEM\n\nStores the ALU result, branch decision signals, and register data for the memory stage.\nIt separates execution from memory access.`;

    case "MEM/WB":
      return `MEM/WB\n\nHolds the value from data memory or the ALU result until the write-back stage writes it into the register file.`;

    case "HAZARDS":
      return `HAZARDS:\n${hazards.length ? hazards.join("\n") : "None"}`;

    default:
      return label;
  }
}

export default function PipelineProcessor({
  results, currCycle, currentPreset, registers, instructionAddresses, branchTargets,
}: PipelineProcessorProps) {
  const [activeBlock, setActiveBlock] = useState<string | null>(null);
  const arrowColour = "#ff0000";

  const latestResult = results.length > 0 ? results[currCycle] : null;

  const ifPath = latestResult?.stageDetails?.IF ?? defaultIFPath;
  const idPath = latestResult?.stageDetails?.ID ?? defaultIDPath;
  const exPath = latestResult?.stageDetails?.EX ?? defaultEXPath;
  const memPath = latestResult?.stageDetails?.MEM ?? defaultMEMPath;
  const wbPath = latestResult?.stageDetails?.WB ?? defaultWBPath;

  const ifComp = latestResult?.component?.IF ?? defaultIFComponents;
  const idComp = latestResult?.component?.ID ?? defaultIDComponents;
  const exComp = latestResult?.component?.EX ?? defaultEXComponents;
  const memComp = latestResult?.component?.MEM ?? defaultMEMComponents;

  const stageLabels = latestResult?.stages ?? {};
  const hazards = latestResult?.hazards ?? [];
  const fetchCycle = stageLabels.IF
    ? results.findIndex((result) => result.stages.IF === stageLabels.IF)
    : -1;
  const pcValue = fetchCycle >= 0 ? fetchCycle * 4 : null;
  const branchInstruction = stageLabels.MEM;
  const branchParts = branchInstruction ? registerOperands(branchInstruction) : null;
  const branchIsTaken = branchParts && isBranchInstruction(branchParts.mnemonic)
    ? branchTaken(branchParts.mnemonic, branchParts.rs1, branchParts.rs2, registers)
    : false;
  const displayIFPath: IFPath = branchIsTaken
    ? { ...ifPath, branch_taken: true, pc_default: false, pc_increment: false }
    : ifPath;

  const getIFColour = (key: keyof IFPath) => displayIFPath[key] ? arrowColour : "#000000";
  const getIDColour = (key: keyof IDPath) => idPath[key] ? arrowColour : "#000000";
  const getEXColour = (key: keyof EXPath) => exPath[key] ? arrowColour : "#000000";
  const getMEMColour = (key: keyof MEMPath) => memPath[key] ? arrowColour : "#000000";
  const getWBColour = (key: keyof WBPath) => wbPath[key] ? arrowColour : "#000000";

  const tooltipText = buildHoverText(
    activeBlock,
    exPath, wbPath,
    ifComp, idComp, exComp, memComp,
    stageLabels, hazards, pcValue, registers, instructionAddresses, branchTargets,
  );

  const hoverContent = tooltipText
    ? React.createElement(
      "div",
      { xmlns: "http://www.w3.org/1999/xhtml", style: { fontSize: 12, whiteSpace: "pre-wrap", wordWrap: "break-word" } },
      tooltipText
    )
    : undefined;

  return (
    <PipelineDatapathSVG
      getIFColour={getIFColour}
      getIDColour={getIDColour}
      getEXColour={getEXColour}
      getMEMColour={getMEMColour}
      getWBColour={getWBColour}
      onBlockHover={setActiveBlock}
      hoverContent={hoverContent}
      stageLabels={stageLabels}
      hazards={hazards}
      active={latestResult != null}
      activeStageColor="#ff0000"
      analysisText={currentPreset ? `Analysis:\n${currentPreset.note}` : undefined}
    />
  );
}