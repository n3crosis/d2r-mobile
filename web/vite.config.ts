import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev injects React Refresh and CSS/HMR. Production has no inline scripts/styles
// and cannot make network connections beyond its own static script/style assets.
const productionCsp = "default-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'"
const developmentCsp = "default-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; object-src 'none'; base-uri 'none'; form-action 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
export default defineConfig(({ command }) => ({
  base: './',
  plugins: [react(), tailwindcss(), {
    name: 'local-only-csp',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace('__APP_CSP__', command === 'serve' ? developmentCsp : productionCsp),
    },
  }],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { target: 'chrome120' },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
}))
