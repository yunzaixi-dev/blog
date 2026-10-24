import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Logger } from 'babel-plugin-react-compiler'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { portNumber } from './scripts/lib/ports.mjs'

const devPort = portNumber(process.env.DEV_PORT, 45100)
const apiPort = portNumber(process.env.API_PORT, devPort + 1)
const compiled = new Set<string>()
const compilerLogger: Logger = {
  logEvent(filename, event) {
    if (filename && event.kind === 'CompileSuccess')
      compiled.add(
        `${path.relative(process.cwd(), filename)}:${event.fnName || `line-${event.fnLoc?.start.line}`}`
      )
  },
}

if (existsSync('.git')) {
  process.env.GIT_COMMIT_HASH ||= execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
  process.env.GIT_COMMIT_FULL_HASH ||= execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
}

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', { target: '19', logger: compilerLogger }]],
      },
    }),
    {
      name: 'react-compiler-evidence',
      buildStart() {
        compiled.clear()
      },
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: '.vite/react-compiler.json',
          source: JSON.stringify([...compiled].sort()),
        })
      },
    },
    {
      name: 'runtime-document',
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          const url = request.url || '/'
          if (
            url.startsWith('/api/') ||
            url.startsWith('/@') ||
            url.startsWith('/app/') ||
            url.startsWith('/node_modules/') ||
            (!request.headers.accept?.includes('text/html') &&
              path.extname(url.split('?')[0]) !== '')
          )
            return next()
          try {
            const upstream = await fetch(`http://127.0.0.1:${apiPort}${url}`, {
              redirect: 'manual',
            })
            for (const [key, value] of upstream.headers)
              if (!['content-length', 'content-encoding', 'connection'].includes(key))
                response.setHeader(key, value)
            response.statusCode = upstream.status
            let html = await upstream.text()
            if (upstream.headers.get('content-type')?.includes('text/html')) {
              html = html
                .replace(/<script[^>]*src="\/assets\/[^>]*><\/script>/g, '')
                .replace(/<link[^>]*href="\/assets\/[^>]*>/g, '')
                .replace('</body>', '<script type="module" src="/app/main.tsx"></script></body>')
              html = await server.transformIndexHtml(url, html)
            }
            response.end(html)
          } catch (error) {
            next(error)
          }
        })
      },
    },
  ],
  define: Object.fromEntries(
    ['SITE_URL', 'API_BASE_URL', 'UMAMI_ID', 'GIT_COMMIT_HASH', 'GIT_COMMIT_FULL_HASH'].map(
      (key) => [`process.env.${key}`, JSON.stringify(process.env[key] || '')]
    )
  ),
  build: {
    outDir: 'out',
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/'))
            return 'react'
          if (id.includes('/motion') || id.includes('/framer-motion/')) return 'motion'
          if (id.includes('/react-router/')) return 'router'
        },
      },
    },
  },
  resolve: { alias: { '@': path.resolve('.'), css: path.resolve('css') } },
  server: {
    host: '127.0.0.1',
    port: devPort,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
      '/static': `http://127.0.0.1:${apiPort}`,
      '/forum': `http://127.0.0.1:${apiPort}`,
    },
  },
})
