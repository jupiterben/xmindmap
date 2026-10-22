import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'

/** True when the page runs inside the Tauri desktop shell. */
export const isDesktop = typeof window !== 'undefined' && isTauri()

const filtersByExtension: Record<string, { name: string; extensions: string[] }[]> = {
  json: [{ name: 'JSON 导图', extensions: ['json'] }],
  xmm: [{ name: 'XMindmap 导图', extensions: ['xmm'] }],
  smm: [{ name: '思维导图文件', extensions: ['smm'] }],
  md: [{ name: 'Markdown 文档', extensions: ['md', 'markdown'] }],
  png: [{ name: 'PNG 图片', extensions: ['png'] }],
  svg: [{ name: 'SVG 矢量图', extensions: ['svg'] }],
}

const documentFilters = [{ name: '思维导图文件', extensions: ['xmm', 'smm', 'json'] }]
const importFilters = [{ name: '思维导图文件', extensions: ['json', 'xmm', 'smm', 'mm', 'md', 'markdown'] }]

export type DesktopPickedFile = { path: string; name: string; content: string }

export function fileBaseName(path: string): string {
  return path.split(/[\\/]/).pop() || '未命名文件'
}

/** Case-insensitive path comparison, matching Windows file system semantics. */
export function sameDesktopPath(a: string, b: string): boolean {
  return a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase()
}

function safeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
}

function filterFor(filename: string) {
  const extension = filename.split('.').pop()?.toLowerCase() ?? ''
  return filtersByExtension[extension]
}

/** Shows the native save dialog and returns the chosen path, or null when cancelled. */
export async function pickDesktopSavePath(filename: string): Promise<string | null> {
  if (!isDesktop) return null
  return await saveDialog({ defaultPath: safeFilename(filename), filters: filterFor(filename) })
}

/** Saves UTF-8 text through the native save dialog. Returns false when the user cancels. */
export async function saveDesktopText(content: string, filename: string): Promise<boolean> {
  const path = await pickDesktopSavePath(filename)
  if (!path) return false
  await writeDesktopTextFile(path, content)
  return true
}

/** Writes UTF-8 text to an existing path without showing any dialog. */
export async function writeDesktopTextFile(path: string, content: string): Promise<void> {
  await invoke('write_text', { path, text: content })
}

/** Saves a `data:` URL (PNG/SVG export) as binary through the native save dialog. */
export async function saveDesktopDataUrl(dataUrl: string, filename: string): Promise<boolean> {
  const path = await pickDesktopSavePath(filename)
  if (!path) return false
  await invoke('write_data_url', { path, dataUrl })
  return true
}

async function pickDesktopFile(filters: { name: string; extensions: string[] }[]): Promise<DesktopPickedFile | null> {
  if (!isDesktop) return null
  const selected = await openDialog({ multiple: false, directory: false, filters })
  const path = typeof selected === 'string' ? selected : null
  if (!path) return null
  const content = await readDesktopTextFile(path)
  return { path, name: fileBaseName(path), content }
}

/** Opens the native picker for mind-map documents (`.xmm`, `.smm`, `.json`). */
export async function openDesktopDocument(): Promise<DesktopPickedFile | null> {
  return await pickDesktopFile(documentFilters)
}

/** Opens the native picker for any importable file. */
export async function openDesktopImportFile(): Promise<DesktopPickedFile | null> {
  return await pickDesktopFile(importFilters)
}

/** Reads a UTF-8 text file. */
export async function readDesktopTextFile(path: string): Promise<string> {
  return await invoke<string>('read_text_file', { path })
}

/** Paths passed on the command line or by a second instance (file association). */
export async function takePendingOpenFiles(): Promise<string[]> {
  if (!isDesktop) return []
  try { return await invoke<string[]>('take_pending_files') } catch { return [] }
}

/** Subscribes to open-file requests forwarded by the single-instance plugin. */
export async function listenOpenFiles(handler: () => void): Promise<() => void> {
  if (!isDesktop) return () => {}
  return await listen('open-file', () => handler())
}

/** Opens an external link in the system browser instead of inside the app window. */
export function openExternalUrl(url: string): void {
  if (isDesktop) {
    void openUrl(url).catch(() => { /* A blocked link should not interrupt editing. */ })
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
