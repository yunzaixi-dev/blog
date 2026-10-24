import { usePathname } from '@/lib/router'
import siteMetadata from '@/data/siteMetadata'
import Link from './Link'
import { getLocaleFromPathname, localizePath } from '@/lib/i18n'

const HeaderLogo = () => {
  const pathname = usePathname()
  const locale = getLocaleFromPathname(pathname)

  return (
    <Link
      href={localizePath('/', locale)}
      aria-label={siteMetadata.headerTitle}
      className="inline-flex min-h-11 min-w-11 touch-manipulation items-center rounded-lg"
    >
      <span className="font-brand text-[1.375rem] leading-none font-medium tracking-[-0.025em] whitespace-nowrap text-slate-900 sm:text-2xl lg:text-[1.75rem] dark:text-white/90">
        {siteMetadata.headerTitle}
      </span>
    </Link>
  )
}

export default HeaderLogo
