const base = (process.env.API_BASE_URL || '').replace(/\/$/, '')

export const backendUrl = (path: string) => `${base}${path}`

// Page routes remain on Pages; only mutable backend-owned resources move origin.
export function backendResourceUrl(value: string): string {
  if (!base) return value
  const relative = value.startsWith('https://zaixi.dev/')
    ? value.slice('https://zaixi.dev'.length)
    : value
  return /^\/(?:static|forum|export)\//.test(relative) ||
    ['/feed.xml', '/robots.txt', '/sitemap.xml'].includes(relative)
    ? backendUrl(relative)
    : value
}

export function resolveBackendResources<T>(value: T): T {
  if (Array.isArray(value)) return value.map(resolveBackendResources) as T
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        const resource = [
          'image',
          'images',
          'src',
          'href',
          'poster',
          'avatar',
          'sourceUrl',
          'export',
        ].includes(key)
        if (resource && typeof item === 'string') return [key, backendResourceUrl(item)]
        if (resource && Array.isArray(item))
          return [
            key,
            item.map((entry) =>
              typeof entry === 'string' ? backendResourceUrl(entry) : resolveBackendResources(entry)
            ),
          ]
        return [key, resolveBackendResources(item)]
      })
    ) as T
  return value
}
