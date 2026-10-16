import { nodeIconList } from 'simple-mind-map/src/svg/icons.js'
import { iconGroups, isNodeIcon } from '../domain/icons'
import type { NodeIcon } from '../domain/icons'

export const iconCatalog = iconGroups.map((group) => ({
  ...group,
  icons: (nodeIconList.find((entry) => entry.type === group.type)?.list ?? []).flatMap((entry) => {
    const id = `${group.type}_${entry.name}`
    if (!isNodeIcon(id)) return []
    return [{
      id: id as NodeIcon,
      label: `${group.label} ${entry.name}`,
      // Only trusted, bundled SVGs are converted to images; never imported SVG markup.
      src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(entry.icon)}`,
    }]
  }),
}))
