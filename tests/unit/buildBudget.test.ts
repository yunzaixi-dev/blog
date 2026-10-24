import { describe, expect, it } from 'vitest'
import { buildBudget } from '../../scripts/lib/build-budget.mjs'

describe('build resource budget', () => {
  it('uses the CPU allocation and shares available memory across concurrent lanes', () => {
    expect(buildBudget({ cpus: 32, memory: 32 * 1024 ** 3 })).toEqual({
      threads: 32,
      nodeHeapMiB: 8192,
      goMemoryBytes: 8 * 1024 ** 3,
      goPackages: 32,
    })
  })
  it('respects a container quota and memory instead of the host capacity', () => {
    expect(buildBudget({ cpus: 32, quota: 1.5, memory: 1024 ** 3 })).toEqual({
      threads: 2,
      nodeHeapMiB: 256,
      goMemoryBytes: 256 * 1024 ** 2,
      goPackages: 1,
    })
  })
  it('keeps at least one package worker without oversubscribing affinity', () => {
    expect(buildBudget({ cpus: 1, quota: 8, memory: 512 * 1024 ** 2 })).toMatchObject({
      threads: 1,
      goPackages: 1,
      nodeHeapMiB: 128,
    })
  })
})
