import type { DataPath, Block_Data } from '@/src/utils/return-types';

export const DATAPATH_COLORS = {
  active: '#ff0000',
  inactive: '#000000',
  transparent: 'transparent',
  block: '#000000',
} as const;

export const EMPTY_DATAPATH: DataPath = {
  branch_taken: false, mux_pc: false, pc_increment: false, pc_default: false,
  pc_add: false, im_reg1: false, im_reg2: false, im_reg_write: false,
  im_imm_gen: false, imm_gen_shift: false, imm_gen_mux: false, reg1_mux: false,
  reg2_mux: false, mux_alu: false, zero: false, alu_res_mem: false,
  alu_res_mux: false, reg2_dm: false, dm_mux: false, reg_write: false,
  alu_src: false, memto_reg: false, reg_write_control: false, mem_read: false,
  mem_write: false, branch: false, alu_op_0: false, alu_op_1: false,
};

export const EMPTY_BLOCK_DATA: Block_Data = {
  pc: { value: '', comment: '' },
  instruction_mem: { value: '', comment: '' },
  default_adder: { value: '' },
  registers: {
    read_register_1: { value: '', comment: '' },
    read_register_2: { value: '', comment: '' },
    write_register: { value: '', comment: '' },
  },
  alu: { alu_result: '' },
  data_memory: { read_data: '', write_data: '' },
};
