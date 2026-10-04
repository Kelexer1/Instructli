interface RiscvWasmModule {
  ccall: (name: string, returnType: string | null, argTypes: string[], args: unknown[]) => number;
  UTF8ToString: (pointer: number) => string;
  _free: (pointer: number) => void;
}

type RiscvWasmFactory = (options?: Record<string, unknown>) => Promise<RiscvWasmModule>;

declare module '*.js' {
  const createRiscv: RiscvWasmFactory;
  export default createRiscv;
  export { createRiscv };
}
