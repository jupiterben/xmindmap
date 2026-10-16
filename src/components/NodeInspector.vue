<script setup lang="ts">
import { ref, watch } from 'vue'
import { Bold, Italic, ImagePlus, Trash2 } from 'lucide-vue-next'
import IconButton from './IconButton.vue'
import { safeLink } from '../domain/documents'
import type { NodeData, NodeShape } from '../domain/types'

const props = defineProps<{ nodes: NodeData[] }>()
const emit = defineEmits<{
  style: [key: keyof NodeData, value: NodeData[keyof NodeData]]
  properties: [values: { text: string; note: string; hyperlink: string; tags: string[] }]
  image: [file: File]
  removeImage: []
}>()
const text = ref('')
const note = ref('')
const hyperlink = ref('')
const tags = ref('')
const error = ref('')
const imageInput = ref<HTMLInputElement | null>(null)
const colors = ['#365edc', '#257763', '#a9456c', '#d0a333', '#3e4653', '#ffffff']
watch(() => props.nodes, (nodes) => {
  const node = nodes[0]
  text.value = node?.text ?? ''
  note.value = node?.note ?? ''
  hyperlink.value = node?.hyperlink ?? ''
  tags.value = node?.tag?.join(', ') ?? ''
  error.value = ''
}, { immediate: true })
function apply() {
  try {
    if (!text.value.trim()) throw new Error('节点名称不能为空')
    const link = safeLink(hyperlink.value)
    emit('properties', { text: text.value, note: note.value, hyperlink: link, tags: tags.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 20) })
    error.value = ''
  } catch (reason) { error.value = reason instanceof Error ? reason.message : '保存失败' }
}
function chooseImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) emit('image', file)
  input.value = ''
}
</script>

<template>
  <div v-if="!nodes.length" class="empty-state">未选中节点</div>
  <template v-else>
    <div class="inspector-section">
      <div class="section-label">节点样式 <span>{{ nodes.length > 1 ? `已选 ${nodes.length} 项` : '当前节点' }}</span></div>
      <div class="format-row">
        <label class="font-size-label">字号
          <select aria-label="字号" :value="nodes[0]?.fontSize ?? 16" @change="emit('style', 'fontSize', Number(($event.target as HTMLSelectElement).value))">
            <option v-for="size in [12, 14, 16, 18, 20, 24, 28, 32]" :key="size" :value="size">{{ size }}</option>
          </select>
        </label>
        <IconButton :icon="Bold" label="加粗" :active="nodes[0]?.fontWeight === 'bold'" @click="emit('style', 'fontWeight', nodes[0]?.fontWeight === 'bold' ? 'normal' : 'bold')" />
        <IconButton :icon="Italic" label="斜体" :active="nodes[0]?.fontStyle === 'italic'" @click="emit('style', 'fontStyle', nodes[0]?.fontStyle === 'italic' ? 'normal' : 'italic')" />
      </div>
      <label class="field-label">节点形状
        <select aria-label="节点形状" :value="nodes[0]?.shape ?? 'roundedRectangle'" @change="emit('style', 'shape', ($event.target as HTMLSelectElement).value as NodeShape)">
          <option value="roundedRectangle">圆角矩形</option><option value="rectangle">矩形</option><option value="ellipse">椭圆</option><option value="diamond">菱形</option>
        </select>
      </label>
      <div class="field-label">填充颜色</div>
      <div class="swatch-row">
        <button v-for="color in colors" :key="color" class="color-swatch" :class="{ chosen: nodes[0]?.fillColor === color }" :style="{ backgroundColor: color }" :aria-label="`填充 ${color}`" :title="color" @click="emit('style', 'fillColor', color)"></button>
        <input type="color" class="custom-color" aria-label="自定义填充色" :value="nodes[0]?.fillColor?.startsWith('#') ? nodes[0].fillColor : '#ffffff'" @input="emit('style', 'fillColor', ($event.target as HTMLInputElement).value)" />
      </div>
      <label class="color-field">文字颜色<input type="color" aria-label="文字颜色" :value="nodes[0]?.color?.startsWith('#') ? nodes[0].color : '#40434b'" @input="emit('style', 'color', ($event.target as HTMLInputElement).value)" /></label>
    </div>
    <form v-if="nodes.length === 1" class="inspector-section" @submit.prevent="apply">
      <div class="section-label">节点内容</div>
      <label class="field-label">名称<textarea v-model="text" aria-label="节点名称" rows="2" maxlength="20000"></textarea></label>
      <label class="field-label">备注<textarea v-model="note" aria-label="节点备注" rows="3" maxlength="20000"></textarea></label>
      <label class="field-label">链接<input v-model="hyperlink" aria-label="节点链接" type="text" placeholder="https://" /></label>
      <label class="field-label">标签<input v-model="tags" aria-label="节点标签" type="text" placeholder="设计, 待办" /></label>
      <p v-if="error" role="alert" class="field-error">{{ error }}</p>
      <button class="button apply-button" type="submit">应用修改</button>
      <div class="image-actions">
        <button type="button" class="text-button" @click="imageInput?.click()"><ImagePlus :size="16" />{{ nodes[0]?.image ? '更换图片' : '添加图片' }}</button>
        <IconButton v-if="nodes[0]?.image" :icon="Trash2" label="移除图片" @click="emit('removeImage')" />
      </div>
      <input ref="imageInput" class="hidden-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="节点图片文件" @change="chooseImage" />
    </form>
  </template>
</template>
