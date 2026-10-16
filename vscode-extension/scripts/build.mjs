import { build } from 'esbuild'
import { copyFile } from 'node:fs/promises'

await build({
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.cjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: false,
})
await copyFile('../THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md')
