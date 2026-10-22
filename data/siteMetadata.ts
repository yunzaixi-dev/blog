export type SiteMetadata = {
  title: string
  author: string
  headerTitle: string
  description: string
  language: string
  theme: 'system' | 'dark' | 'light'
  siteUrl: string
  siteRepo: string
  socialBanner: string
  email: string
  github: string
  x: string
  telegram: string
  analytics: {
    umami: {
      websiteId?: string
    }
  }
}

const siteMetadata: SiteMetadata = {
  title: 'zaixi.dev',
  author: '蓝色大肥鱼',
  headerTitle: 'zaixi.dev',
  description: '纯粹的技术博客。写下来，才算真正想清楚。',
  language: 'zh-CN',
  theme: 'dark', // system, dark or light
  // dev builds publish to dev.zaixi.dev (see .github/workflows/deploy.yml).
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'https://zaixi.dev',
  siteRepo: 'https://github.com/yunzaixi-dev/blog',
  socialBanner: '/static/images/avatar.jpg',
  email: '',
  github: 'https://github.com/yunzaixi-dev',
  x: '',
  telegram: '',
  analytics: {
    umami: {
      websiteId: process.env.NEXT_UMAMI_ID,
    },
  },
}

export default siteMetadata
