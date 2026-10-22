<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Bold, Italic, ImagePlus, Trash2 } from 'lucide-vue-next'
import IconButton from './IconButton.vue'
import { safeLink } from '../domain/documents'
import { normalizeRelativeMarkdownPath } from '../domain/links'
import { nodeStyleTemplates } from '../domain/nodeStyles'
import type { NodeStyleTemplate, NodeStyleValues, SelectedNodeData } from '../domain/nodeStyles'
import type { MapTheme } from '../domain/themes'
import type { NodeData, NodeShape } from '../domain/types'

const props = defineProps<{ nodes: SelectedNodeData[]; theme: MapTheme }>()
const emit = defineEmits<{
  style: [key: keyof NodeData, value: NodeData[keyof NodeData]]
  styleTemplate: [styles: NodeStyleValues]
  properties: [values: { text: string; note: string; hyperlink: string; tags: string[] }]
  image: [file: File]
  removeImage: []
  preview: [path: string]
}>()
const text = ref('')
const note = ref('')
const hyperlink = ref('')
const tags = ref('')
const error = ref('')
const selectedUid = ref('')
// Set while the user is typing in the form, so canvas re-renders (which replace
// the selection array on every render) cannot reset the fields mid-edit.
const dirty = ref(false)
const imageInput = ref<HTMLInputElement | null>(null)
const markdownPath = computed(() => {
  try { return normalizeRelativeMarkdownPath(hyperlink.value) } catch { return '' }
})
const colors = ['#365edc', '#257763', '#a9456c', '#d0a333', '#3e4653', '#ffffff']
const templates = computed(() => nodeStyleTemplates(props.theme))

function isTemplateActive(template: NodeStyleTemplate) {
  if (!props.nodes.length) return false
  return props.nodes.every((node) => {
    const overrides = node.styleOverrides ?? {}
    if (template.reset) return Object.keys(overrides).length === 0
    return Object.entries(template.style).every(([key, value]) => (overrides as Record<string, unknown>)[key] === value)
  })
}
function sampleStyle(template: NodeStyleTemplate) {
  const { preview } = template
  return {
    backgroundColor: template.reset ? 'transparent' : preview.fillColor,
    color: preview.color,
    // The reset template is an action, not a look: a hollow dashed box says
    // "inherit" better than the light theme colour it would otherwise match.
    border: template.reset ? `1px dashed ${preview.borderColor}` : `1px solid ${preview.borderWidth > 0 ? preview.borderColor : 'transparent'}`,
    borderRadius: preview.shape === 'ellipse' ? '999px' : preview.shape === 'rectangle' ? '2px' : '5px',
    fontWeight: preview.fontWeight === 'bold' ? '700' : '500',
    fontStyle: preview.fontStyle,
  }
}
watch(() => props.nodes, (nodes) => {
  const node = nodes[0]
  const uid = node?.uid ?? ''
  if (uid !== selectedUid.value) {
    selectedUid.value = uid
    dirty.value = false
  }
  error.value = ''
  if (dirty.value && uid) return
  text.value = node?.text ?? ''
  note.value = node?.note ?? ''
  hyperlink.value = node?.hyperlink ?? ''
  tags.value = node?.tag?.join(', ') ?? ''
}, { immediate: true })
function apply() {
  try {
    if (!text.value.trim()) throw new Error('节点名称不能为空')
    const link = safeLink(hyperlink.value)
    emit('properties', { text: text.value, note: note.value, hyperlink: link, tags: tags.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 20) })
    error.value = ''
    dirty.value = false
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
      <div class="section-label">样式模板 <span>{{ nodes.length > 1 ? `应用到 ${nodes.length} 项` : '一键套用' }}</span></div>
      <div class="style-template-grid" role="group" aria-label="节点样式模板">
        <button v-for="template in templates" :key="template.id" type="button" class="style-template" :class="{ chosen: isTemplateActive(template) }" :aria-pressed="isTemplateActive(template)" :aria-label="`应用样式模板 ${template.label}`" :title="template.label" @click="emit('styleTemplate', template.style)">
          <span class="style-template-sample" :style="sampleStyle(template)"><span>Aa</span></span>
          <span class="style-template-label">{{ template.label }}</span>
        </button>
      </div>
    </div>
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
      <label class="field-label">名称<textarea v-model="text" aria-label="节点名称" rows="2" maxlength="20000" @input="dirty = true"></textarea></label>
      <label class="field-label">备注<textarea v-model="note" aria-label="节点备注" rows="3" maxlength="20000" @input="dirty = true"></textarea></label>
      <label class="field-label">链接<input v-model="hyperlink" aria-label="节点链接" type="text" placeholder="https:// 或 docs/note.md" @input="dirty = true" /></label>
      <button v-if="markdownPath" type="button" class="text-button" @click="emit('preview', markdownPath)">预览 Markdown</button>
      <label class="field-label">标签<input v-model="tags" aria-label="节点标签" type="text" placeholder="设计, 待办" @input="dirty = true" /></label>
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
