import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // The main bundle is about 550 kB minified after splitting (1.2.10, see src/lazyLoad.ts). It is
    // read from the app bundle on device, never downloaded, so the default 500 kB web warning is noise.
    chunkSizeWarningLimit: 700,
  },
})