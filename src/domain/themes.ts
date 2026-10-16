import type { MapDocument, ThemeConfig, ThemeId } from './types'

export interface MapTheme {
  id: ThemeId
  label: string
  colors: [string, string, string]
  config: ThemeConfig
}

function theme(id: ThemeId, label: string, accent: string, light: string, line: string): MapTheme {
  return {
    id, label, colors: [accent, light, line],
    config: {
      backgroundColor: '#fbfcfd',
      lineColor: line,
      lineWidth: 2,
      lineStyle: 'curve',
      paddingX: 18,
      paddingY: 10,
      root: {
        shape: 'roundedRectangle', fillColor: accent, color: '#ffffff',
        fontSize: 23, fontWeight: 'bold', borderWidth: 0, borderRadius: 8,
        paddingX: 28, paddingY: 18,
      },
      second: {
        shape: 'roundedRectangle', fillColor: light, color: accent,
        fontSize: 16, fontWeight: 'bold', borderColor: line, borderWidth: 1,
        borderRadius: 6, marginX: 70, marginY: 28,
      },
      node: {
        shape: 'roundedRectangle', fillColor: '#ffffff', color: '#40434b',
        fontSize: 14, borderColor: '#e0e4e9', borderWidth: 1,
        borderRadius: 5, marginX: 48, marginY: 12,
      },
    },
  }
}

export const themes: MapTheme[] = [
  theme('studio', '晴空', '#365edc', '#edf2ff', '#9fb6ed'),
  theme('forest', '青林', '#257763', '#edf8f2', '#9bcbb9'),
  theme('rose', '蔷薇', '#a9456c', '#fbedf2', '#dfadc0'),
  theme('mono', '石墨', '#3e4653', '#f0f1f3', '#afb5bf'),
]

export function getTheme(id: ThemeId): MapTheme {
  return themes.find((item) => item.id === id) ?? themes[0]!
}

export function getDocumentTheme(doc: Pick<MapDocument, 'themeId' | 'lineStyle'>): ThemeConfig {
  return {
    ...getTheme(doc.themeId).config,
    lineStyle: doc.lineStyle,
    lineRadius: doc.lineStyle === 'straight' ? 0 : 5,
  }
}
