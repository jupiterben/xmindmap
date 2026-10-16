<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { SmilePlus, Trash2, X } from 'lucide-vue-next'
import IconButton from './IconButton.vue'
import { iconCatalog } from '../engine/iconCatalog'
import type { IconGroup, NodeIcon } from '../domain/icons'
import type { NodeData } from '../domain/types'

const props = defineProps<{ nodes: NodeData[] }>()
const emit = defineEmits<{ choose: [icon: NodeIcon]; clear: [] }>()
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const category = ref<HTMLSelectElement | null>(null)
const open = ref(false)
const group = ref<IconGroup>('priority')
const icons = computed(() => iconCatalog.find((item) => item.type === group.value)?.icons ?? [])
const hasIcons = computed(() => props.nodes.some((node) => node.icon?.length))
const selected = (icon: NodeIcon) => props.nodes.length > 0 && props.nodes.every((node) => node.icon?.includes(icon))

function toggle() {
  open.value = !open.value
  if (open.value) void nextTick(() => category.value?.focus())
}
function close(restoreFocus = false) {
  open.value = false
  if (restoreFocus) trigger.value?.focus()
}
function outside(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target)) close()
}
function onKeydown(event: KeyboardEvent) {
  if (open.value && event.key === 'Escape') {
    event.preventDefault()
    close(true)
  }
}
watch(() => props.nodes.map((node) => node.uid).join(','), () => close())
document.addEventListener('pointerdown', outside)
document.addEventListener('keydown', onKeydown)
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outside)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="root" class="node-icon-picker">
    <button ref="trigger" type="button" class="icon-button" :class="{ active: open || hasIcons }" title="快捷设置图标" aria-label="快捷设置图标" aria-haspopup="dialog" :aria-expanded="open" :disabled="!nodes.length" @click="toggle">
      <SmilePlus :size="18" :stroke-width="1.7" aria-hidden="true" />
    </button>
    <div v-if="open" class="node-icon-popover" role="dialog" aria-label="节点图标">
      <div class="node-icon-heading"><span>节点图标<span v-if="nodes.length > 1"> · {{ nodes.length }} 项</span></span><IconButton :icon="X" label="关闭图标面板" @click="close(true)" /></div>
      <label class="field-label">分类
        <select ref="category" v-model="group" aria-label="图标分类"><option v-for="item in iconCatalog" :key="item.type" :value="item.type">{{ item.label }}</option></select>
      </label>
      <div class="node-icon-grid">
        <button v-for="icon in icons" :key="icon.id" type="button" class="node-icon-option" :class="{ selected: selected(icon.id) }" :aria-label="`图标 ${icon.label}`" :title="icon.label" :aria-pressed="selected(icon.id)" @click="emit('choose', icon.id)">
          <img :src="icon.src" :alt="icon.label" width="24" height="24" />
        </button>
      </div>
      <button type="button" class="text-button clear-node-icons" :disabled="!hasIcons" @click="emit('clear')"><Trash2 :size="15" aria-hidden="true" />清空图标</button>
    </div>
  </div>
</template>
