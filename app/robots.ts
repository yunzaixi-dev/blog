import { MetadataRoute } from 'next'
import siteMetadata from '@/data/siteMetadata'

export const dynamic = 'force-static'

export default function robots(): MetadataRoute.Robots {
  // Preview deployments (dev.zaixi.dev) must not compete with the real site.
  const noindex = process.env.NEXT_PUBLIC_NOINDEX === 'true'
  return {
    rules: {
      userAgent: '*',
      ...(noindex ? { disallow: '/' } : { allow: '/' }),
    },
    sitemap: `${siteMetadata.siteUrl}/sitemap.xml`,
  }
}
