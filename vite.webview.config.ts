import { defineConfig, mergeConfig } from 'vite'
import baseConfig from './vite.config.ts'

export default mergeConfig(baseConfig, defineConfig({
  base: './',
  build: {
    outDir: 'vscode-extension/webview',
    emptyOutDir: true,
    manifest: true,
    modulePreload: false,
  },
}))
