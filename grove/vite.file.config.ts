import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

/** One self-contained HTML you can open with file:// (vs AI / hotseat / debug train). */
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: 'dist-file',
    emptyOutDir: true,
  },
})
