import { useState } from "react";
import React from "react";
import type { DataPath } from "../../src/utils/return-types";
import { JsonResponse } from "../../src/utils/single-processor";
import { DATAPATH_COLORS, EMPTY_BLOCK_DATA, EMPTY_DATAPATH } from "../../src/data/sandbox-single-cycle-ui";
import { buildSandboxSingleCycleHoverText } from "../../src/data/sandbox-single-cycle-messages";
import DatapathSVG from "./SandboxDatapathSVG";

type SingleProcessorProps = {
  results: JsonResponse | null | undefined;
  suppressHover?: boolean;
};

export default function SingleProcessor({ results, suppressHover = false }: SingleProcessorProps) {
  const [activeBlock, setActiveBlock] = useState<string | null>(null);

  const dp = results?.data_path ?? EMPTY_DATAPATH;
  const bd = results?.block_data ?? EMPTY_BLOCK_DATA;
  const active = results != null;

  // getColour: red if the segment is active in results, black otherwise.
  const getColour = (key: keyof DataPath): string =>
    active && dp[key] ? DATAPATH_COLORS.active : DATAPATH_COLORS.inactive;

  const tooltipText = suppressHover ? null : buildSandboxSingleCycleHoverText(activeBlock, bd);
  const hoverContent = tooltipText
    ? React.createElement(
        "div",
        {
          xmlns: "http://www.w3.org/1999/xhtml",
          style: { fontSize: 12, whiteSpace: "pre-wrap", wordWrap: "break-word" },
        },
        tooltipText
      )
    : undefined;

  return (
    <DatapathSVG
      getColour={getColour}
      onBlockHover={setActiveBlock}
      hoverContent={hoverContent}
    />
  );
}