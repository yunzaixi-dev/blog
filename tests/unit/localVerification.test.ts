import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { contentOnly, verificationCompose } from '../../scripts/lib/local-verification.mjs'

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
  it('keeps heavy tests local and publishes the smoke-tested image without rebuilding', () => {
    const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8')
    for (const command of [
      'playwright install',
      'pnpm check',
      'pnpm test:e2e',
      'pnpm perf:check',
      'pnpm test:integration',
      'docker compose',
      'test-container-publication',
    ]) {
      expect(workflow).not.toContain(command)
    }
    expect(workflow).toContain('node scripts/test-container.mjs "$IMAGE"')
    expect(workflow).toContain('docker save --output blog-image.tar "$IMAGE"')
    const publish = workflow.split('  publish:')[1].split('  pages:')[0]
    expect(publish).toContain('docker load --input blog-image.tar')
    expect(publish).toContain('docker push "$IMAGE"')
    expect(publish).not.toContain('build-push-action')
    expect(workflow).toContain('inputs.deploy_pages')
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
