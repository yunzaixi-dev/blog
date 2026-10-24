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
  siteUrl: process.env.SITE_URL || 'https://zaixi.dev',
  siteRepo: 'https://github.com/yunzaixi-dev/blog',
  socialBanner: '/static/images/avatar.webp',
  email: '',
  github: 'https://github.com/yunzaixi-dev',
  x: 'https://x.com/big_blue_fish',
  telegram: 'https://t.me/blue_big_fish',
  analytics: {
    umami: {
      websiteId: process.env.UMAMI_ID,
    },
  },
}

export default siteMetadata
