export type CacheType = 'direct-mapped' | 'set-associative' | 'fully-associative';
export type ReplacementPolicy = 'random' | 'fifo' | 'lru';

export interface CacheConfig {
  type: CacheType;
  numBlocks: number;
  blockSizeWords: number;
  numWays: number;
  policy: ReplacementPolicy;
}

export const BLOCK_COUNT_OPTIONS = [1, 2, 4, 8, 16, 32, 64, 128, 256];
export const BLOCK_SIZE_OPTIONS = [1, 2, 4, 8, 16];
export const POLICY_OPTIONS: readonly ReplacementPolicy[] = ['random', 'fifo', 'lru'];
export const POLICY_LABELS: Record<ReplacementPolicy, string> = {
  random: 'Random',
  fifo: 'FIFO',
  lru: 'LRU',
};

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  type: 'direct-mapped',
  numBlocks: 4,
  blockSizeWords: 1,
  numWays: 1,
  policy: 'lru',
};

const BYTE_OFFSET_BITS = 2;
const RANDOM_SEED = 0x5eed1234;

export function normalizeCacheConfig(config: CacheConfig): CacheConfig {
  if (config.type === 'direct-mapped') return { ...config, numWays: 1 };
  if (config.type === 'fully-associative') return { ...config, numWays: config.numBlocks };
  const numBlocks = Math.max(2, config.numBlocks);
  return { ...config, numBlocks, numWays: Math.min(Math.max(2, config.numWays), numBlocks) };
}

export function wayOptions(numBlocks: number): number[] {
  return BLOCK_COUNT_OPTIONS.filter((ways) => ways >= 2 && ways <= numBlocks);
}

export function cacheSets(config: CacheConfig): number {
  return config.numBlocks / config.numWays;
}

export function usesReplacement(config: CacheConfig): boolean {
  return config.numWays > 1;
}

export interface AddressBreakdown {
  address: number;
  tag: number;
  index: number;
  blockOffset: number;
  byteOffset: number;
  blockNumber: number;
  blockBase: number;
  tagBits: number;
  indexBits: number;
  blockOffsetBits: number;
  byteOffsetBits: number;
}

export function breakdownAddress(address: number, config: CacheConfig): AddressBreakdown {
  const unsigned = address >>> 0;
  const sets = cacheSets(config);
  const blockOffsetBits = Math.log2(config.blockSizeWords);
  const indexBits = Math.log2(sets);
  const wordNumber = Math.floor(unsigned / 4);
  const blockNumber = Math.floor(wordNumber / config.blockSizeWords);
  return {
    address: unsigned,
    tag: Math.floor(blockNumber / sets),
    index: blockNumber % sets,
    blockOffset: wordNumber % config.blockSizeWords,
    byteOffset: unsigned % 4,
    blockNumber,
    blockBase: blockNumber * config.blockSizeWords * 4,
    tagBits: 32 - BYTE_OFFSET_BITS - blockOffsetBits - indexBits,
    indexBits,
    blockOffsetBits,
    byteOffsetBits: BYTE_OFFSET_BITS,
  };
}

export function blockBaseFor(tag: number, index: number, config: CacheConfig): number {
  return (tag * cacheSets(config) + index) * config.blockSizeWords * 4;
}

export interface CacheSlot {
  valid: boolean;
  tag: number;
  stamp: number;
}

export type MissKind = 'compulsory' | 'conflict' | 'capacity';

export const MISS_KIND_LABELS: Record<MissKind, string> = {
  compulsory: 'Compulsory',
  conflict: 'Conflict',
  capacity: 'Capacity',
};

export interface CacheStats {
  accesses: number;
  hits: number;
  misses: number;
  evictions: number;
  compulsory: number;
  conflict: number;
  capacity: number;
}

export interface AccessResult {
  breakdown: AddressBreakdown;
  hit: boolean;
  way: number;
  evictedTag: number | null;
  missKind: MissKind | null;
}

export interface LastAccess {
  pc: number;
  result: AccessResult;
}

export interface CacheSnapshot {
  config: CacheConfig;
  sets: CacheSlot[][];
  stats: CacheStats;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function emptyStats(): CacheStats {
  return { accesses: 0, hits: 0, misses: 0, evictions: 0, compulsory: 0, conflict: 0, capacity: 0 };
}

function emptySets(config: CacheConfig): CacheSlot[][] {
  return Array.from({ length: cacheSets(config) }, () =>
    Array.from({ length: config.numWays }, () => ({ valid: false, tag: 0, stamp: 0 })),
  );
}

function nextStamp(set: CacheSlot[]): number {
  return set.reduce((max, slot) => (slot.valid ? Math.max(max, slot.stamp) : max), 0) + 1;
}

export class CacheSimulator {
  readonly config: CacheConfig;
  lastAccess: LastAccess | null = null;
  private sets: CacheSlot[][];
  private counts: CacheStats = emptyStats();
  private random = mulberry32(RANDOM_SEED);
  private seenBlocks = new Set<number>();
  private filledBlocks = 0;

  constructor(config: CacheConfig) {
    this.config = normalizeCacheConfig(config);
    this.sets = emptySets(this.config);
  }

  get accessCount(): number {
    return this.counts.accesses;
  }

  reset() {
    this.sets = emptySets(this.config);
    this.counts = emptyStats();
    this.random = mulberry32(RANDOM_SEED);
    this.seenBlocks = new Set();
    this.filledBlocks = 0;
    this.lastAccess = null;
  }

  access(address: number, pc: number): AccessResult {
    const breakdown = breakdownAddress(address, this.config);
    const set = this.sets[breakdown.index];
    const { policy } = this.config;
    const hitWay = set.findIndex((slot) => slot.valid && slot.tag === breakdown.tag);
    this.counts.accesses += 1;

    let result: AccessResult;
    if (hitWay !== -1) {
      this.counts.hits += 1;
      if (policy === 'lru') set[hitWay].stamp = nextStamp(set);
      result = { breakdown, hit: true, way: hitWay, evictedTag: null, missKind: null };
    } else {
      this.counts.misses += 1;
      const missKind: MissKind = !this.seenBlocks.has(breakdown.blockNumber)
        ? 'compulsory'
        : this.filledBlocks === this.config.numBlocks
          ? 'capacity'
          : 'conflict';
      this.counts[missKind] += 1;
      const emptyWay = set.findIndex((slot) => !slot.valid);
      const way = emptyWay !== -1 ? emptyWay : this.pickVictim(set);
      const evictedTag = set[way].valid ? set[way].tag : null;
      if (evictedTag !== null) this.counts.evictions += 1;
      else this.filledBlocks += 1;
      set[way] = {
        valid: true,
        tag: breakdown.tag,
        stamp: policy === 'random' ? 0 : nextStamp(set),
      };
      result = { breakdown, hit: false, way, evictedTag, missKind };
    }

    this.seenBlocks.add(breakdown.blockNumber);
    this.lastAccess = { pc, result };
    return result;
  }

  snapshot(): CacheSnapshot {
    return {
      config: this.config,
      sets: this.sets.map((set) => set.map((slot) => ({ ...slot }))),
      stats: { ...this.counts },
    };
  }

  private pickVictim(set: CacheSlot[]): number {
    if (this.config.policy === 'random') return Math.floor(this.random() * set.length);
    return set.reduce((oldest, slot, way) => (slot.stamp < set[oldest].stamp ? way : oldest), 0);
  }
}

function hex(value: number): string {
  return `0x${(value >>> 0).toString(16).padStart(8, '0')}`;
}

export function describeMissKind(result: AccessResult, config: CacheConfig): string {
  const { blockNumber, index } = result.breakdown;
  const where = config.type === 'direct-mapped' ? `index ${index}` : `set ${index}`;
  switch (result.missKind) {
    case 'compulsory':
      return `Compulsory miss: block ${blockNumber} has never been accessed before, so no cache could have held it.`;
    case 'capacity':
      return `Capacity miss: block ${blockNumber} was cached earlier but evicted, and every block in the cache is in use - the cache is too small for the working set.`;
    case 'conflict':
      return `Conflict miss: block ${blockNumber} was cached earlier but evicted because ${where} is full, even though other blocks in the cache are still empty.`;
    default:
      return '';
  }
}

export function describeAccess(result: AccessResult, config: CacheConfig): string {
  const { breakdown, hit, way, evictedTag } = result;
  const { tag, index, address, blockNumber } = breakdown;
  const sets = cacheSets(config);
  const policy = POLICY_LABELS[config.policy];

  if (hit) {
    const location = config.type === 'fully-associative'
      ? `tag ${tag}`
      : config.type === 'direct-mapped'
        ? `index ${index} (tag ${tag})`
        : `set ${index} (tag ${tag})`;
    const wayText = config.numWays > 1 ? ` in way ${way}` : '';
    const bookkeeping = config.numWays === 1
      ? '.'
      : config.policy === 'lru'
        ? ' - LRU counter updated.'
        : config.policy === 'fifo'
          ? ' - FIFO order is unchanged by a hit.'
          : ' - no recency bookkeeping needed under random replacement.';
    return `Address ${hex(address)} maps to ${location}. The cache holds tag ${tag}${wayText}${bookkeeping}`;
  }

  const installText = evictedTag !== null
    ? `Tag ${evictedTag}${config.numWays > 1 ? ` (way ${way})` : ''} was evicted${config.numWays > 1 ? ` (${policy})` : ''}. Tag ${tag} added.`
    : `Empty slot found${config.numWays > 1 ? ` (way ${way})` : ''}. Tag ${tag} added.`;

  if (config.type === 'direct-mapped') {
    return `Address ${hex(address)} → block ${blockNumber}, index ${index} (block % ${sets}), tag ${tag}. ${installText}`;
  }
  if (config.type === 'fully-associative') {
    return `Address ${hex(address)} → block ${blockNumber}, tag ${tag} (no index bits - all ${config.numBlocks} ways searched). ${installText}`;
  }
  return `Address ${hex(address)} → block ${blockNumber}, set ${index} (block % ${sets}), tag ${tag}. ${config.numWays} ways searched. ${installText}`;
}
