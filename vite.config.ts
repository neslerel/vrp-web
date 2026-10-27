import { defineConfig } from 'vitest/config'

// base relativa: la app funciona igual en la raíz de un dominio o en /nombre-del-repo/ (GitHub Pages)
export default defineConfig({
  base: './',
  test: { include: ['src/**/*.test.ts'] },
})
