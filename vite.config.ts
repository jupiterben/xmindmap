import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('simple-mind-map') || id.includes('@svgdotjs')) return 'mind-map'
        },
      },
    },
  },
})
