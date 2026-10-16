import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

await build({
  entryPoints: ['tests/host.test.ts'], outfile: 'dist/test.cjs',
  bundle: true, platform: 'node', target: 'node20', format: 'cjs', external: ['vscode'],
})
const executable = process.env.VSCODE_EXECUTABLE_PATH ??
  (process.platform === 'win32' ? join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe') : 'code')
const profile = await mkdtemp(join(tmpdir(), 'xmindmap-vscode-test-'))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.XMINDMAP_TEST_ROOT = join(profile, 'documents')
await mkdir(env.XMINDMAP_TEST_ROOT)
try {
  const exit = await new Promise((resolveExit, reject) => {
    const child = spawn(executable, [
      `--extensionDevelopmentPath=${resolve('.')}`,
      `--extensionTestsPath=${resolve('dist/test.cjs')}`,
      `--user-data-dir=${join(profile, 'user')}`,
      `--extensions-dir=${join(profile, 'extensions')}`,
      '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
    ], { env, stdio: 'inherit', windowsHide: true })
    child.on('error', reject)
    child.on('exit', (code) => resolveExit(code ?? 1))
  })
  process.exitCode = exit
} finally {
  // Only remove the dedicated directory returned by mkdtemp, never a user profile.
  if (dirname(resolve(profile)) !== resolve(tmpdir()) || !basename(profile).startsWith('xmindmap-vscode-test-')) throw new Error('Unsafe test profile path')
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 })
}
