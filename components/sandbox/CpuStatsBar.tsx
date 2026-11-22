import type { ExecutionCounters } from '@/src/utils/sandbox-cpu-stats';
import type { PipelineStats } from '@/src/utils/sandbox-pipeline-engine';

interface CpuStatsBarProps {
  mode: 'single-cycle' | 'pipeline';
  counters: ExecutionCounters;
  pipeline: PipelineStats | null;
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5" title={hint}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="font-mono text-sm font-semibold text-gray-800">{value}</p>
    </div>
  );
}

export default function CpuStatsBar({ mode, counters, pipeline }: CpuStatsBarProps) {
  if (mode === 'single-cycle') {
    const { instructions, redirects } = counters;
    return (
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-slate-200 bg-slate-50 p-3">
        <Stat label="Instructions" value={String(instructions)} hint="Instructions executed since the program was loaded." />
        <Stat label="Cycles" value={String(instructions)} hint="Every instruction takes exactly one cycle." />
        <Stat label="CPI" value={instructions > 0 ? '1.00' : '–'} hint="Cycles per instruction." />
        <Stat label="Taken branches" value={String(redirects)} hint="Branches and jumps that changed the PC. Free here, but each one flushes the pipeline in the pipelined CPU." />
      </div>
    );
  }

  const stats: PipelineStats = pipeline ?? {
    cycles: 0, retired: 0, dataHazards: 0, stallCycles: 0, controlHazards: 0, flushedInstructions: 0,
  };

  return (
    <div className="grid shrink-0 grid-cols-3 gap-2 border-t border-slate-200 bg-slate-50 p-3">
      <Stat label="Cycles" value={String(stats.cycles)} hint="Clock cycles elapsed, including pipeline fill and drain." />
      <Stat label="Instructions" value={String(stats.retired)} hint="Instructions that have completed write-back." />
      <Stat label="CPI" value={stats.retired > 0 ? (stats.cycles / stats.retired).toFixed(2) : '–'} hint="Cycles per completed instruction. 1.00 would be a perfect pipeline." />
      <Stat label="Data hazards" value={String(stats.dataHazards)} hint="Instructions that had to wait for an earlier instruction to write a register." />
      <Stat label="Stall cycles" value={String(stats.stallCycles)} hint="Cycles lost to data hazards (bubbles inserted into EX)." />
      <Stat label="Control hazards" value={String(stats.controlHazards)} hint="Taken branches and jumps that redirected fetch." />
      <Stat label="Flushed instrs" value={String(stats.flushedInstructions)} hint="Wrong-path instructions discarded after a control hazard." />
    </div>
  );
}
