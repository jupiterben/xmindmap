<script setup lang="ts">
import { ref } from 'vue'
import { X } from 'lucide-vue-next'
import IconButton from './IconButton.vue'
import { renderMarkdown } from '../domain/markdownView'
import { hostDataRequest, isVsCode, vscode } from '../platform/vscode'

const dialog = ref<HTMLDialogElement | null>(null)
const path = ref('')
const html = ref('')
const error = ref('')
const loading = ref(false)
let ticket = 0

async function open(nextPath: string) {
  const id = ++ticket
  path.value = nextPath
  html.value = ''
  error.value = ''
  loading.value = false
  dialog.value?.showModal()
  if (!isVsCode) {
    error.value = '网页版不能读取本地文件，请在 VS Code 中打开导图'
    return
  }
  loading.value = true
  try {
    const content = await hostDataRequest('file.read', { path: nextPath })
    if (id !== ticket) return
    if (typeof content !== 'string') throw new Error('文件内容无效')
    html.value = content.trim() ? renderMarkdown(content) : ''
    if (!html.value.trim()) error.value = '没有可显示的内容'
  } catch (reason) {
    if (id !== ticket) return
    error.value = reason instanceof Error ? reason.message : '读取失败'
    html.value = ''
  } finally {
    if (id === ticket) loading.value = false
  }
}

function close() {
  ticket++
  dialog.value?.close()
}

function openHref(event: MouseEvent) {
  const target = event.target
  if (!(target instanceof Element)) return
  const anchor = target.closest('a')
  if (!(anchor instanceof HTMLAnchorElement)) return
  event.preventDefault()
  const href = anchor.getAttribute('href')
  if (!href) return
  if (isVsCode) vscode?.postMessage({ type: 'openExternal', url: href })
  else window.open(href, '_blank', 'noopener,noreferrer')
}

defineExpose({ open })
</script>

<template>
  <dialog ref="dialog" class="markdown-dialog" aria-labelledby="markdown-preview-title" @click="($event.target === dialog) && close()">
    <div class="dialog-heading">
      <h2 id="markdown-preview-title">{{ path || 'Markdown' }}</h2>
      <IconButton :icon="X" label="关闭预览" @click="close" />
    </div>
    <p v-if="loading" class="markdown-status">正在读取…</p>
    <p v-else-if="error" class="field-error" role="alert">{{ error }}</p>
    <div v-else class="markdown-body" @click="openHref" v-html="html"></div>
  </dialog>
</template>
