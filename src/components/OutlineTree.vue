<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-vue-next'
import { flattenTree } from '../domain/documents'
import type { MindNode } from '../domain/types'

const props = defineProps<{ root: MindNode; selectedUid?: string; query: string }>()
const emit = defineEmits<{ select: [uid: string]; toggle: [uid: string]; rename: [uid: string, text: string]; remove: [uid: string] }>()
const editing = ref('')
const text = ref('')
const entries = computed(() => {
  const query = props.query.trim().toLowerCase()
  return flattenTree(props.root, !query).filter(({ node }) => !query || node.data.text.toLowerCase().includes(query))
})
function edit(node: MindNode) { editing.value = node.data.uid; text.value = node.data.text }
function finish() {
  if (!editing.value) return
  emit('rename', editing.value, text.value)
  editing.value = ''
}
</script>

<template>
  <div class="outline-tree" aria-label="导图大纲">
    <div v-for="{ node, depth } in entries" :key="node.data.uid" class="outline-row" :class="{ selected: selectedUid === node.data.uid }" :style="{ paddingLeft: `${12 + Math.min(depth, 8) * 15}px` }">
      <button v-if="node.children.length" class="outline-toggle" :aria-label="`${node.data.expand === false ? '展开' : '收起'} ${node.data.text}`" :disabled="depth === 0" @click="emit('toggle', node.data.uid)">
        <component :is="node.data.expand === false ? ChevronRight : ChevronDown" :size="13" />
      </button>
      <span v-else class="outline-dot" aria-hidden="true"></span>
      <input v-if="editing === node.data.uid" :ref="(el) => (el as HTMLInputElement | null)?.focus()" v-model="text" aria-label="大纲节点名称" @keydown.enter="finish" @keydown.esc="editing = ''" @blur="finish" />
      <button v-else class="outline-label" :title="node.data.text" @click="emit('select', node.data.uid)" @dblclick="edit(node)">{{ node.data.text }}</button>
      <span v-if="node.children.length" class="outline-count">{{ node.children.length }}</span>
      <span class="outline-actions">
        <button v-if="selectedUid === node.data.uid && depth > 0" type="button" class="outline-delete" :aria-label="`删除大纲节点 ${node.data.text}`" title="删除节点及其子节点" @click.stop="emit('remove', node.data.uid)" @dblclick.stop>
          <Trash2 :size="14" :stroke-width="1.7" aria-hidden="true" />
        </button>
      </span>
    </div>
    <p v-if="!entries.length" class="empty-state">没有匹配的节点</p>
  </div>
</template>
