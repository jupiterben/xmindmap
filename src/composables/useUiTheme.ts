import { ref, watch } from 'vue'

export type UiTheme = 'light' | 'dark'

const STORAGE_KEY = 'xmindmap.uiTheme'

function readInitial(): UiTheme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // localStorage unavailable; fall through to system preference.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const theme = ref<UiTheme>(readInitial())

function apply(value: UiTheme) {
  document.documentElement.setAttribute('data-ui-theme', value)
  document.documentElement.style.colorScheme = value
}

apply(theme.value)

export function useUiTheme() {
  watch(theme, (value) => {
    apply(value)
    try { localStorage.setItem(STORAGE_KEY, value) } catch {
      // Ignore persistence failures (private mode, blocked storage).
    }
  })
  function toggle() { theme.value = theme.value === 'dark' ? 'light' : 'dark' }
  function set(value: UiTheme) { theme.value = value }
  return { theme, toggle, set }
}
