import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { contentOnly, verificationCompose } from '../../scripts/lib/local-verification.mjs'
import { assertReleaseCandidate } from '../../scripts/lib/local-release.mjs'

const source = () => ({
  name: 'blog-dev',
  services: {
    app: {
      ports: ['45100:45100'],
      environment: { MEDIA_BASE_URL: 'http://localhost:45104' },
      sysctls: { 'net.ipv4.ip_local_reserved_ports': '45100-45142' },
    },
    postgres: { ports: ['45102:5432'] },
    typesense: { ports: ['45103:8108'] },
    minio: { ports: ['45104:9000', '45105:9001'] },
  },
  volumes: { database: { name: 'blog-dev-database' } },
  networks: { default: { name: 'blog-dev_default' } },
})

describe('local verification isolation', () => {
  it('keeps builds, tests and full-image transfers out of cloud CI', () => {
    const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8')
    for (const command of [
      'playwright install',
      'pnpm check',
      'pnpm test:e2e',
      'pnpm perf:check',
      'pnpm test:integration',
      'docker compose',
      'test-container-publication',
      'setup-buildx-action',
      'build-push-action',
      'docker save',
      'docker load',
      'download-artifact',
      'pnpm install',
    ]) {
      expect(workflow).not.toContain(command)
    }
    expect(workflow).toContain('git diff --check HEAD^ HEAD')
    expect(workflow).toContain('fetch-depth: 2')
    expect(workflow).toContain('https://harbor.agentwego.com/v2/zaixi/blog/manifests/$DIGEST')
    expect(workflow).not.toContain('packages: write')
    const release = readFileSync('scripts/release-local.mjs', 'utf8')
    expect(release).toContain("['push', tag]")
    expect(release).not.toContain("['build'")
  })
  it('rejects dirty, stale or incomplete local release evidence', () => {
    const report = {
      source: 'a'.repeat(40),
      workingTreeChanges: '',
      imageID: `sha256:${'1'.repeat(64)}`,
      pagesDirectory: '/verified/pages',
    }
    expect(() => assertReleaseCandidate(report, report.source, '')).not.toThrow()
    expect(() => assertReleaseCandidate(report, 'b'.repeat(40), '')).toThrow(
      'verified clean source'
    )
    expect(() => assertReleaseCandidate(report, report.source, 'M app/main.tsx')).toThrow(
      'verified clean source'
    )
    expect(() =>
      assertReleaseCandidate({ ...report, workingTreeChanges: 'M x' }, report.source, '')
    ).toThrow('verified clean source')
    expect(() =>
      assertReleaseCandidate({ ...report, pagesDirectory: undefined }, report.source, '')
    ).toThrow('lacks')
    expect(() =>
      assertReleaseCandidate({ ...report, imageID: 'tag:latest' }, report.source, '')
    ).toThrow('lacks')
  })
  it('only exempts independent content updates, never application or mixed changes', () => {
    expect(contentOnly(['content/blog/zh/a.md', 'public/static/images/a.webp'])).toBe(true)
    expect(contentOnly(['public/forum/a.md'])).toBe(true)
    expect(contentOnly(['content/blog/zh/a.md', 'scripts/build.mjs'])).toBe(false)
    expect(contentOnly(['public/_redirects'])).toBe(false)
    expect(contentOnly([])).toBe(false)
  })
  it('isolates volumes, networks and host ports without changing development configuration', () => {
    const original = source()
    const config = verificationCompose(original, 'blog-verify-abc123')
    expect(config.name).toBe('blog-verify-abc123')
    expect(config.volumes?.database).toEqual({})
    expect(config.networks?.default).toEqual({})
    expect(config.services.app.ports).toEqual([])
    expect(config.services.app.sysctls).toEqual({
      'net.ipv4.ip_local_reserved_ports': '45100-45142',
    })
    expect(config.services.app.environment.MEDIA_BASE_URL).toBe('http://minio:9000/blog-test-media')
    for (const service of ['postgres', 'typesense', 'minio']) {
      expect(config.services[service].ports).toHaveLength(1)
      expect(config.services[service].ports[0]).toMatchObject({
        published: '0',
        host_ip: '127.0.0.1',
        protocol: 'tcp',
      })
    }
    expect(original).toEqual(source())
  })

  it('refuses a development project name or external resources before startup', () => {
    expect(() => verificationCompose(source(), 'blog-dev')).toThrow('unique verification project')
    for (const key of ['volumes', 'networks'] as const) {
      const config = { ...source(), [key]: { shared: { name: 'user-data', external: true } } }
      expect(() => verificationCompose(config, 'blog-verify-abc123')).toThrow('external resources')
    }
  })
})
