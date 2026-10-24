import { defineConfig } from 'vite'
import path from 'node:path'

export default defineConfig({
  resolve: { alias: { '@': path.resolve('.') } },
  ssr: { external: true },
  build: {
    ssr: 'server/content-worker.ts',
    outDir: 'dist/worker',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'content-worker.mjs',
        banner:
          "import { createRequire as createNodeRequire } from 'node:module'; const require = createNodeRequire(import.meta.url);",
      },
    },
  },
})
