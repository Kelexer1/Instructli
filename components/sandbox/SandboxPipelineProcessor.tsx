import { useState } from "react";
import React from "react";
import type {
  IFPath, IDPath, EXPath, MEMPath, WBPath,
  IFComponents, IDComponents, EXComponents, MEMComponents, PipelineState,
} from "../../src/utils/pipeline-types";
import type { SandboxCpuData } from "../../src/utils/sandbox-cpu-data";
import {
  BRANCH_INSTRUCTIONS,
  IMMEDIATE_INSTRUCTIONS,
  PIPELINE_STAGES,
  isConditionalBranch,
  isStoreInstruction,
  isUpperImmediateInstruction,
  usesImmediateInstruction,
} from "../../src/data/sandbox-instructions";
import {
  formatHex,
  formatImmediate,
  formatMemoryRead,
  formatMemoryWrite,
  formatUpperImmediate,
  formatPipelineValue,
} from "../../src/data/sandbox-messages";
import { buildSandboxHoverMessage } from "../../src/data/sandbox-hover-messages";
import { buildRegisterWriteDetails } from "../../src/data/sandbox-hover-messages";
import PipelineDatapathSVG from "./SandboxPipelineDatapathSVG";

type PipelineProcessorProps = {
  results: PipelineState[];
  currCycle: number;
  currentPreset: { index: number; note: string } | null;
  cpuData?: SandboxCpuData;
};

type StageSlots = NonNullable<PipelineState["slots"]>;

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

function instructionKey(instruction: string) {
  return instruction.replace(/,/g, " ").trim().replace(/\s+/g, " ");
}

function instructionParts(instruction: string) {
  return instructionKey(instruction).split(" ");
}

function registerOperands(instruction: string) {
  const [mnemonic, ...operands] = instructionParts(instruction);
  if (!mnemonic) return { mnemonic: "", rd: "", rs1: "", rs2: "", immediate: "" };

  const isBranch = BRANCH_INSTRUCTIONS.includes(mnemonic as typeof BRANCH_INSTRUCTIONS[number]);
  const isUpperImmediate = isUpperImmediateInstruction(mnemonic);
  const usesImmediate = IMMEDIATE_INSTRUCTIONS.includes(mnemonic as typeof IMMEDIATE_INSTRUCTIONS[number]);
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

function formatRegisterValue(value: string, register: string, registers?: readonly number[]) {
  const registerNumber = Number(register.slice(1));
  const liveValue = registers?.[registerNumber];
  const normalized = liveValue === undefined
    ? formatPipelineValue(componentValue(value, "N/A"))
    : formatHex(liveValue);
  return `${register} = ${normalized}`;
}

function registerValue(register: string, registers?: readonly number[]) {
  return formatRegisterValue("", register, registers).split(" = ")[1];
}

function branchTaken(mnemonic: string, rs1: string, rs2: string, registers?: readonly number[]) {
  const first = registers?.[Number(rs1.slice(1))];
  const second = registers?.[Number(rs2.slice(1))];
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

function formatMemoryDetails(
  instruction: string,
  readData: string,
  writeData: string,
  registers?: readonly number[],
) {
  const match = instructionParts(instruction).join(" ").match(/^(lw|sw) x(\d+) (-?\d+)\(x(\d+)\)$/i);
  if (!match || !registers) return { readData, writeData };

  const [, mnemonic, dataRegister, offsetText, baseRegister] = match;
  const baseValue = registers[Number(baseRegister)];
  if (baseValue === undefined) return { readData, writeData };

  const address = (baseValue + Number(offsetText)) >>> 0;
  return mnemonic.toLowerCase() === "lw"
    ? { readData: formatMemoryRead(address), writeData: "No data written" }
    : {
      readData: "No data read",
      writeData: formatMemoryWrite(registers[Number(dataRegister)] ?? 0, address),
    };
}

function buildHoverText(
  label: string | null,
  exPath: EXPath,
  ifComp: IFComponents, idComp: IDComponents, exComp: EXComponents, memComp: MEMComponents,
  stageLabels: { IF?: string; ID?: string; EX?: string; MEM?: string; WB?: string },
  hazards: string[], pcValue: number | null, registers?: readonly number[],
  slots?: StageSlots,
): string | null {
  const instruction = stageLabels.IF || stageLabels.ID || stageLabels.EX || stageLabels.MEM || stageLabels.WB;
  const idInstruction = stageLabels.ID;
  const exInstruction = stageLabels.EX;
  const memInstruction = stageLabels.MEM;
  const wbInstruction = stageLabels.WB;
  const branchStage = (["EX", "MEM"] as const).find((stage) => {
    const candidate = stageLabels[stage];
    return candidate && isConditionalBranch(registerOperands(candidate).mnemonic);
  });
  const branchInstruction = branchStage ? stageLabels[branchStage] : undefined;
  const branchSlot = branchStage ? slots?.[branchStage] : undefined;
  const branchParts = branchInstruction ? registerOperands(branchInstruction) : null;
  const idParts = idInstruction ? registerOperands(idInstruction) : null;
  const exParts = exInstruction ? registerOperands(exInstruction) : null;
  const wbParts = wbInstruction ? registerOperands(wbInstruction) : null;
  const resolvedImmediate = branchParts
    ? branchSlot?.target !== undefined
      ? String(branchSlot.target - branchSlot.address)
      : branchParts.immediate
    : '';
  const firstStage = PIPELINE_STAGES.find((stage) => stageLabels[stage]);
  const instructionAddress = instruction
    ? (firstStage ? slots?.[firstStage]?.address : undefined) ?? pcValue
    : null;
  const branchInstructionAddress = branchInstruction
    ? branchSlot?.address ?? pcValue
    : null;
  const branchValue = branchParts && branchInstructionAddress !== null
    && branchInstructionAddress !== undefined && Number.isFinite(Number(resolvedImmediate))
    ? `${formatHex(branchInstructionAddress)} + ${formatImmediate(resolvedImmediate)} = ${formatHex(branchInstructionAddress + Number(resolvedImmediate))}`
    : exComp.branch_adder?.value;
  const branchWasTaken = branchParts && branchInstructionAddress !== null
    ? branchSlot?.taken ?? branchTaken(branchParts.mnemonic, branchParts.rs1, branchParts.rs2, registers)
    : false;
  const pcInstruction = stageLabels.IF || branchInstruction || instruction;
  const pcAddress = stageLabels.IF
    ? pcValue
    : branchInstructionAddress;
  const nextPc = branchWasTaken && branchInstructionAddress !== null && Number.isFinite(Number(resolvedImmediate))
    ? branchInstructionAddress + Number(resolvedImmediate)
    : pcAddress === null || pcAddress === undefined
      ? undefined
      : pcAddress + 4;
  const memoryDetails = memInstruction && memComp.data_memory
    ? formatMemoryDetails(
      memInstruction,
      memComp.data_memory.read_data,
      memComp.data_memory.write_data,
      registers,
    )
    : undefined;

  return buildSandboxHoverMessage(label, {
    instruction,
    pc: pcInstruction ? pcAddress : undefined,
    pcNext: nextPc,
    instructionAddress,
    pcAdder: pcInstruction
      ? pcAddress === null || pcAddress === undefined
        ? formatPipelineValue(componentValue(ifComp.default_adder?.value ?? "", "PC + 4"))
        : `${formatHex(pcAddress)} + 4 = ${formatHex(pcAddress + 4)}`
      : undefined,
    registerFile: idParts && idInstruction ? {
      rs1: idParts.rs1,
      rs2: idParts.rs2,
      rd: idParts.rd,
      read1: isUpperImmediateInstruction(idParts.mnemonic)
        ? "N/A"
        : registerValue(idParts.rs1 || "rs1", registers),
      read2: idParts.rs2 ? registerValue(idParts.rs2, registers) : "N/A",
      writeDetails: buildRegisterWriteDetails({
        rd: idParts.rd,
        mnemonic: idParts.mnemonic,
        isLoad: idParts.mnemonic === "lw",
        isStore: idParts.mnemonic === "sw",
        isBranch: isConditionalBranch(idParts.mnemonic),
        isUpperImmediate: isUpperImmediateInstruction(idParts.mnemonic),
      }),
      conditionalBranch: isConditionalBranch(idParts.mnemonic),
    } : undefined,
    immediateGenerator: idParts ? {
      value: idComp.imm_gen?.value
        || (usesImmediateInstruction(idParts.mnemonic)
          ? `Immediate: ${formatImmediate(idParts.immediate)}`
          : undefined),
      usesImmediate: Boolean(idComp.imm_gen?.value) || usesImmediateInstruction(idParts.mnemonic),
    } : undefined,
    alu: exParts
      ? isUpperImmediateInstruction(exParts.mnemonic)
        ? `Immediate: ${formatUpperImmediate(exParts.immediate)}`
        : formatPipelineValue(exComp.alu.alu_result?.match(/→\s*(.*)$/)?.[1]
          ?? `${exParts.mnemonic.toUpperCase()} uses ${exParts.rs1 ? registerValue(exParts.rs1, registers) : "N/A"} and ${IMMEDIATE_INSTRUCTIONS.includes(exParts.mnemonic as typeof IMMEDIATE_INSTRUCTIONS[number])
            ? formatImmediate(exParts.immediate)
            : exParts.rs2 ? registerValue(exParts.rs2, registers) : "N/A"
          }`)
      : undefined,
    branchAdder: branchParts ? {
      value: branchValue,
      usesBranch: true,
    } : undefined,
    aluInputMux: exParts
      ? exPath.ex_mux
        ? `Immediate: ${formatImmediate(resolvedImmediate)}`
        : exParts.rs2 ? `${exParts.rs2} = ${registerValue(exParts.rs2, registers)}` : "N/A"
      : undefined,
    dataMemory: memInstruction ? {
      readData: memoryDetails?.readData ?? memComp.data_memory.read_data,
      writeData: memoryDetails?.writeData ?? memComp.data_memory.write_data,
    } : undefined,
    nextPcMux: pcInstruction
      ? pcAddress === null || pcAddress === undefined
        ? formatPipelineValue(ifComp.pc.value || "N/A")
        : `PC ${formatHex(pcAddress)} → ${formatHex(nextPc ?? pcAddress + 4)}`
      : undefined,
    writeBackMux: wbInstruction
      ? wbParts && isStoreInstruction(wbParts.mnemonic)
        ? "N/A"
        : wbParts?.rd ? `${wbParts.rd} ← result` : "N/A"
      : undefined,
    hazards,
  });
}

export default function PipelineProcessor({
  results, currCycle, currentPreset, cpuData,
}: PipelineProcessorProps) {
  const [activeBlock, setActiveBlock] = useState<string | null>(null);
  const arrowColour = "#ff0000";
  const registers = cpuData
    ? Array.from({ length: 32 }, (_, number) => cpuData.readRegister(number))
    : undefined;

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
  const hoverLabels = Object.fromEntries(
    Object.entries(stageLabels).filter(([, label]) => label && !label.startsWith("bubble")),
  ) as typeof stageLabels;
  const hazards = latestResult?.hazards ?? [];
  const slots = latestResult?.slots;
  const pcValue = slots?.IF?.address ?? null;

  const getIFColour = (key: keyof IFPath) => ifPath[key] ? arrowColour : "#000000";
  const getIDColour = (key: keyof IDPath) => idPath[key] ? arrowColour : "#000000";
  const getEXColour = (key: keyof EXPath) => exPath[key] ? arrowColour : "#000000";
  const getMEMColour = (key: keyof MEMPath) => memPath[key] ? arrowColour : "#000000";
  const getWBColour = (key: keyof WBPath) => wbPath[key] ? arrowColour : "#000000";

  const tooltipText = buildHoverText(
    activeBlock,
    exPath,
    ifComp, idComp, exComp, memComp,
    hoverLabels, hazards, pcValue, registers, slots,
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