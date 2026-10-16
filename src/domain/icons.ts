// IDs match the built-in catalog in simple-mind-map 0.14.0-fix.3.
// Keep this metadata free of browser imports: the VS Code host uses it too.
export const iconGroups = [
  { type: 'priority', label: '优先级', count: 10 },
  { type: 'progress', label: '进度', count: 8 },
  { type: 'expression', label: '表情', count: 20 },
  { type: 'sign', label: '标记', count: 23 },
] as const

export type IconGroup = (typeof iconGroups)[number]['type']
export type NodeIcon = `${IconGroup}_${number}`

const allowedIcons = new Set<string>(iconGroups.flatMap((group) =>
  Array.from({ length: group.count }, (_, index) => `${group.type}_${index + 1}`),
))

export function isNodeIcon(value: unknown): value is NodeIcon {
  return typeof value === 'string' && allowedIcons.has(value)
}

export function normalizeIcons(value: unknown): NodeIcon[] {
  return Array.isArray(value) ? [...new Set(value.filter(isNodeIcon))] : []
}

export function replaceIcon(icons: readonly NodeIcon[], icon: NodeIcon, remove = false): NodeIcon[] {
  const group = icon.split('_')[0]
  const remaining = icons.filter((item) => item.split('_')[0] !== group)
  return remove ? remaining : [...remaining, icon]
}
