/**
 * Only a fresh, uniquely named Compose project may own verification resources.
 * @param {{name?: string, services: Record<string, any>, volumes?: Record<string, any>, networks?: Record<string, any>}} source
 * @param {string} project
 */
export function verificationCompose(source, project) {
  if (!/^blog-verify-[a-z0-9]+$/.test(project))
    throw new Error('Expected a unique verification project')
  const config = structuredClone(source)
  config.name = project
  for (const resources of [config.volumes, config.networks]) {
    for (const resource of Object.values(resources || {})) {
      if (resource.external) throw new Error('Verification cannot use external resources')
      delete resource.name
    }
  }
  config.services.app.ports = []
  config.services.app.environment.MEDIA_BASE_URL = 'http://minio:9000/blog-test-media'
  config.services.app.environment.CI = '1'
  for (const [service, target] of [
    ['postgres', 5432],
    ['typesense', 8108],
    ['minio', 9000],
  ]) {
    config.services[service].ports = [
      { target, published: '0', host_ip: '127.0.0.1', protocol: 'tcp' },
    ]
  }
  return config
}

/** @param {string[]} files */
export function contentOnly(files) {
  return (
    files.length > 0 &&
    files.every((file) =>
      ['content/', 'public/static/images/', 'public/forum/'].some((prefix) =>
        file.startsWith(prefix)
      )
    )
  )
}
