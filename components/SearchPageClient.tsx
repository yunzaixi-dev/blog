import { useCallback, useEffect, useRef, useState } from 'react'
import { backendUrl, resolveBackendResources } from '@/lib/backend'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import Link from '@/components/Link'
import Icon from '@/components/Icon'
import { Skeleton } from '@/components/animata/Skeleton'
import { cardClass, mutedText } from '@/components/ui/styles'
import { type Locale, ui } from '@/lib/i18n'
import { animataEase, animataQuickDuration } from '@/components/animata/motion'

type SearchResult = {
  url: string
  excerpt: string
  meta: { title: string; image?: string }
}

type SearchState =
  | { phase: 'idle' }
  | { phase: 'loading'; query: string }
  | { phase: 'results'; query: string; results: SearchResult[] }
  | { phase: 'empty'; query: string }
  | { phase: 'error'; query: string }

const RESULT_LIMIT = 10

export default function SearchPageClient({ locale }: { locale: Locale }) {
  const labels = ui[locale]
  const [query, setQuery] = useState('')
  const [state, setState] = useState<SearchState>({ phase: 'idle' })
  const shouldReduceMotion = useReducedMotion()
  const controllerRef = useRef<AbortController | null>(null)
  const activeSearchRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const headingId = 'search-page-heading'
  const statusId = 'search-status'

  useEffect(() => {
    inputRef.current?.focus()
    return () => controllerRef.current?.abort()
  }, [])

  const performSearch = useCallback(
    async (searchQuery: string) => {
      const trimmedQuery = searchQuery.trim()
      const searchId = activeSearchRef.current + 1
      activeSearchRef.current = searchId
      controllerRef.current?.abort()

      if (!trimmedQuery) {
        setState({ phase: 'idle' })
        return
      }

      const controller = new AbortController()
      controllerRef.current = controller
      setState({ phase: 'loading', query: trimmedQuery })

      try {
        const response = await fetch(
          backendUrl(
            `/api/search?${new URLSearchParams({ q: trimmedQuery, locale, limit: String(RESULT_LIMIT) })}`
          ),
          { signal: controller.signal }
        )
        if (!response.ok) throw new Error(`Search request failed: ${response.status}`)
        const { results } = resolveBackendResources(
          (await response.json()) as { results: SearchResult[] }
        )
        if (!Array.isArray(results)) throw new Error('Invalid search response')

        if (activeSearchRef.current !== searchId) return

        if (results.length === 0) {
          setState({ phase: 'empty', query: trimmedQuery })
        } else {
          setState({ phase: 'results', query: trimmedQuery, results })
        }
      } catch {
        if (!controller.signal.aborted && activeSearchRef.current === searchId) {
          setState({ phase: 'error', query: trimmedQuery })
        }
      }
    },
    [locale]
  )

  const onInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setQuery(value)
      void performSearch(value)
    },
    [performSearch]
  )

  const itemTransition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: animataQuickDuration, ease: animataEase }
  let statusMessage: string = labels.searchHint

  if (state.phase === 'loading') {
    statusMessage = labels.searchLoading(state.query)
  } else if (state.phase === 'results') {
    statusMessage = labels.searchResultCount(state.results.length, state.query)
  } else if (state.phase === 'empty') {
    statusMessage = labels.searchNoResults(state.query)
  } else if (state.phase === 'error') {
    statusMessage = labels.searchUnavailable(state.query)
  }

  return (
    <div className="blog-shell mx-auto w-full px-4 pt-6 pb-12 sm:px-0 sm:pt-10">
      <h1
        id={headingId}
        className="mb-4 text-2xl leading-tight font-semibold tracking-tight text-slate-900 sm:mb-6 sm:text-4xl dark:text-white/90"
      >
        {labels.search}
      </h1>

      <section role="search" aria-labelledby={headingId}>
        <div
          className={`relative mb-3 ${cardClass} flex min-h-11 items-center gap-3 px-4 py-2.5 focus-within:ring-2 focus-within:ring-sky-500/30 motion-safe:transition-[box-shadow] motion-safe:duration-200 sm:mb-5 sm:px-5 sm:py-3`}
        >
          <Icon
            name="Search"
            className="h-5 w-5 shrink-0 text-slate-400 dark:text-white/40"
            inlineSpacing={false}
            decorative
          />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={onInput}
            aria-label={labels.search}
            className="w-full bg-transparent text-base text-slate-900 outline-none dark:text-white/90"
          />
        </div>
      </section>

      <div id={statusId} role="status" className="sr-only">
        {statusMessage}
      </div>

      <div
        data-search-results
        data-search-state={state.phase}
        aria-busy={state.phase === 'loading'}
        aria-describedby={statusId}
      >
        {state.phase === 'idle' && (
          <p className={`px-1 text-sm leading-6 ${mutedText}`}>{labels.searchHint}</p>
        )}

        {state.phase === 'loading' && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`${cardClass} px-4 py-3 sm:px-5 sm:py-4`}>
                <Skeleton className="mb-2 h-5 w-2/3" />
                <Skeleton className="h-4 w-full" />
              </div>
            ))}
          </div>
        )}

        {state.phase === 'empty' && (
          <p className={`px-1 text-sm leading-6 ${mutedText}`}>
            {labels.searchNoResults(state.query)}
          </p>
        )}

        {state.phase === 'error' && (
          <p className={`px-1 text-sm leading-6 ${mutedText}`}>
            {labels.searchUnavailable(state.query)}
          </p>
        )}

        {state.phase === 'results' && (
          <div className="space-y-3">
            <p className={`mb-2 px-1 text-sm ${mutedText}`}>
              {labels.searchResultCount(state.results.length, state.query)}
            </p>
            <AnimatePresence mode="popLayout">
              {state.results.map((result) => (
                <motion.div
                  key={result.url}
                  layout
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                  whileHover={shouldReduceMotion ? undefined : { y: -2 }}
                  transition={itemTransition}
                >
                  <Link
                    href={result.url}
                    data-blog-post-link
                    data-search-result-card
                    className={`${cardClass} block px-4 py-3 hover:ring-sky-300 motion-safe:transition-[box-shadow,color,background-color] motion-safe:duration-200 sm:px-5 sm:py-4 dark:hover:ring-sky-700`}
                  >
                    <h2 className="mb-1.5 text-base leading-6 font-medium [overflow-wrap:anywhere] text-slate-900 sm:text-lg dark:text-white/90">
                      {result.meta?.title || result.url}
                    </h2>
                    {result.excerpt && (
                      <p className="text-sm leading-6 text-slate-600 dark:text-white/70 [&_mark]:rounded [&_mark]:bg-sky-100 [&_mark]:px-0.5 [&_mark]:text-sky-700 dark:[&_mark]:bg-sky-900/40 dark:[&_mark]:text-sky-300">
                        {result.excerpt}
                      </p>
                    )}
                  </Link>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}
