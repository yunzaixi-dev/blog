import os from 'node:os'
import { readFileSync } from 'node:fs'

/** @param {{cpus: number, memory: number, quota?: number}} resources */
export function buildBudget({ cpus, memory, quota = cpus }) {
  const threads = Math.max(1, Math.min(cpus, Math.ceil(quota)))
  // Two Node builds and Go may overlap. Reserve a quarter for native allocations
  // and the OS; each build lane gets a quarter of currently available memory.
  const laneBytes = Math.floor(memory / 4)
  return {
    threads,
    nodeHeapMiB: Math.max(16, Math.floor(laneBytes / 1024 ** 2)),
    goMemoryBytes: laneBytes,
    goPackages: Math.max(1, Math.min(threads, Math.floor(laneBytes / (256 * 1024 ** 2)))),
  }
}

export function buildEnvironment() {
  let quota
  try {
    const [limit, period] = readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/)
    if (limit !== 'max') quota = Number(limit) / Number(period)
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error
  }
  const budget = buildBudget({
    cpus: os.availableParallelism(),
    memory: Math.min(os.totalmem(), process.availableMemory()),
    quota,
  })
  console.log(
    `Build budget: ${budget.threads} CPUs, Node ${budget.nodeHeapMiB} MiB/lane, Go ${budget.goPackages} packages; memory shared across 3 build lanes`
  )
  return {
    ...process.env,
    NODE_OPTIONS:
      `${process.env.NODE_OPTIONS || ''} --max-old-space-size=${budget.nodeHeapMiB}`.trim(),
    UV_THREADPOOL_SIZE: String(budget.threads),
    GOMAXPROCS: String(budget.threads),
    GOMEMLIMIT: String(budget.goMemoryBytes),
    GOFLAGS: `${process.env.GOFLAGS || ''} -p=${budget.goPackages}`.trim(),
  }
}
