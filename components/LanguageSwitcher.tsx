import { useEffect, useState } from 'react'
import { usePathname } from '@/lib/router'
import Link from './Link'
import {
  getLocaleFromPathname,
  localeConfig,
  locales,
  localizePath,
  stripLocaleFromPathname,
  switchLocalePathForSection,
  type Locale,
} from '@/lib/i18n'

const SECTION_PATH = /^\/(?:$|categories|tags|search)(?:\/|$)/

/**
 * Section pages exist in every locale. An article exists only where it was
 * written; its page lists those locales as hreflang alternates, so a locale
 * without one sends the reader to that locale's home instead of a 404.
 */
function getLanguageHref(
  pathname: string,
  locale: Locale,
  hasAlternate?: (locale: Locale) => boolean
) {
  // Until the alternates are read, an article links to the locale's home: the
  // first render is prefetched, and a guessed translation would 404.
  if (!SECTION_PATH.test(stripLocaleFromPathname(pathname)) && !hasAlternate?.(locale)) {
    return localizePath('/', locale)
  }
  return switchLocalePathForSection(pathname, locale)
}

const LanguageSwitcher = () => {
  const pathname = usePathname()
  const currentLocale = getLocaleFromPathname(pathname)
  const otherLocale = locales.find((locale) => locale !== currentLocale) || currentLocale
  const [hasAlternate, setHasAlternate] = useState<(locale: Locale) => boolean>()

  useEffect(() => {
    const available = new Set(
      Array.from(document.head.querySelectorAll('link[rel="alternate"][hreflang]'), (link) =>
        link.getAttribute('hreflang')
      )
    )
    setHasAlternate(
      () => (locale: Locale) =>
        locale === currentLocale || available.has(localeConfig[locale].htmlLang)
    )
  }, [pathname, currentLocale])

  return (
    <>
      <Link
        href={getLanguageHref(pathname, otherLocale, hasAlternate)}
        data-language-switcher-mobile
        data-animata-language-switcher-active
        className="inline-flex min-h-11 touch-manipulation items-center justify-center rounded-[8px] border border-slate-200 bg-slate-100 px-3 text-sm font-medium text-slate-700 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 lg:hidden dark:border-white/10 dark:bg-white/[0.08] dark:text-white/80 dark:hover:border-sky-700 dark:hover:bg-sky-900/[0.24] dark:hover:text-sky-300"
      >
        {localeConfig[otherLocale].label}
      </Link>
      <div
        data-language-switcher-desktop
        className="hidden min-h-11 items-center rounded-[8px] border border-slate-200 p-0.5 text-sm font-medium lg:flex dark:border-white/10"
      >
        {locales.map((locale) => {
          const isActive = locale === currentLocale

          return (
            <Link
              key={locale}
              href={getLanguageHref(pathname, locale, hasAlternate)}
              aria-current={isActive ? 'page' : undefined}
              className={`relative isolate inline-flex min-h-11 touch-manipulation items-center justify-center overflow-hidden rounded-md px-2 transition-[color,background-color] duration-150 ease-out ${
                isActive
                  ? 'text-white dark:text-slate-900'
                  : 'text-slate-600 hover:text-sky-700 dark:text-white/80 dark:hover:text-sky-300'
              }`}
            >
              {isActive && (
                <span
                  aria-hidden="true"
                  data-animata-language-switcher-active
                  className="pointer-events-none absolute inset-0 -z-10 rounded bg-slate-900 dark:bg-slate-100"
                />
              )}
              <span className="relative">{localeConfig[locale].label}</span>
            </Link>
          )
        })}
      </div>
    </>
  )
}

export default LanguageSwitcher
