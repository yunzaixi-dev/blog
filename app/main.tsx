import 'css/tailwind.css'
import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import {
  createBrowserRouter,
  RouterProvider,
  Outlet,
  ScrollRestoration,
  useRevalidator,
  useRouteError,
} from 'react-router'
import AppShell from '@/components/AppShell'
import Analytics from '@/components/Analytics'
import siteMetadata from '@/data/siteMetadata'
import { ThemeProviders } from './theme-providers'
import Page, { pageLoader } from './page'

function Root() {
  const revalidator = useRevalidator()
  useEffect(() => {
    const refresh = () => {
      void revalidator.revalidate()
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('pageshow', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pageshow', refresh)
    }
  }, [revalidator])
  return (
    <ThemeProviders>
      <Analytics config={siteMetadata.analytics} />
      <AppShell>
        <Outlet />
      </AppShell>
      <ScrollRestoration />
    </ThemeProviders>
  )
}
function ContentError() {
  const error = useRouteError()
  return (
    <section role="alert" className="blog-shell mx-auto p-8">
      <h1>内容暂不可用 / Content unavailable</h1>
      <p>{error instanceof Error ? error.message : 'Unable to load content'}</p>
      <button onClick={() => window.location.reload()}>重新加载 / Reload</button>
    </section>
  )
}
const router = createBrowserRouter([
  {
    Component: Root,
    HydrateFallback: () => (
      <p role="status" className="p-8">
        加载中 / Loading
      </p>
    ),
    children: [{ path: '*', loader: pageLoader, Component: Page, ErrorBoundary: ContentError }],
  },
])
document.querySelectorAll('[data-runtime-head]').forEach((element) => element.remove())
document.querySelector('head > title')?.remove()
createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />)
