<script setup lang="ts">
defineProps<{ id: string }>()
</script>

<template>
  <span class="provider-icon" aria-hidden="true">
    <svg viewBox="0 0 16 16">
      <template v-if="id === 'openai'">
        <circle cx="8" cy="3.1" r="1.25" fill="#111" />
        <circle cx="12.15" cy="5.5" r="1.25" fill="#111" />
        <circle cx="12.15" cy="10.5" r="1.25" fill="#111" />
        <circle cx="8" cy="12.9" r="1.25" fill="#111" />
        <circle cx="3.85" cy="10.5" r="1.25" fill="#111" />
        <circle cx="3.85" cy="5.5" r="1.25" fill="#111" />
        <circle cx="8" cy="8" r="1.45" fill="#111" />
      </template>
      <template v-else-if="id === 'deepseek'">
        <circle cx="8" cy="8" r="7" fill="#4D6BFE" />
        <path d="M4.6 9.2c1.5-2.6 5.3-2.6 6.8 0" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" />
        <circle cx="6.1" cy="6.5" r="0.7" fill="#fff" />
      </template>
      <template v-else-if="id === 'qwen'">
        <rect width="16" height="16" rx="4" fill="#615CED" />
        <circle cx="6.2" cy="8" r="2.1" fill="#FFB020" />
        <circle cx="10.2" cy="8" r="2.1" fill="#fff" />
      </template>
      <template v-else-if="id === 'kimi'">
        <rect width="16" height="16" rx="4" fill="#111" />
        <path fill="#fff" d="M9 2.4a5.6 5.6 0 1 0 4.7 9.4A4.6 4.6 0 1 1 9 2.4z" />
      </template>
      <template v-else-if="id === 'zhipu'">
        <rect x="0.5" y="0.5" width="15" height="15" rx="3" fill="#1C64F2" />
        <path d="M4.2 11.2 8 4.4l3.8 6.8" fill="none" stroke="#fff" stroke-width="1.4" stroke-linejoin="round" />
      </template>
      <template v-else-if="id === 'openrouter'">
        <circle cx="3.6" cy="8" r="1.55" fill="#111" />
        <circle cx="8" cy="4.4" r="1.55" fill="#6366F1" />
        <circle cx="12.4" cy="10.6" r="1.55" fill="#111" />
        <path d="M5 7.4 6.8 5.5M9.2 5.5l2 3.6" fill="none" stroke="#111" stroke-width="1.15" stroke-linecap="round" />
      </template>
      <template v-else-if="id === 'groq'">
        <rect width="16" height="16" rx="3" fill="#111" />
        <path d="M4.8 11.2V4.8h3.3a2.15 2.15 0 0 1 0 4.3H4.8" fill="none" stroke="#F55036" stroke-width="1.45" stroke-linecap="round" />
      </template>
      <template v-else-if="id === 'minimax'">
        <rect width="16" height="16" rx="4" fill="#111" />
        <path d="M3.2 11.5V4.5L8 9.1 12.8 4.5v7" fill="none" stroke="#fff" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" />
      </template>
      <template v-else-if="id === 'workbuddy'">
        <rect width="16" height="16" rx="4" fill="#0052D9" />
        <path d="M3.1 11.3 5.5 4.7 8 9.4l2.5-4.7 2.4 6.6" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
      </template>
      <template v-else-if="id === 'siliconflow'">
        <rect width="16" height="16" rx="4" fill="#0EA5E9" />
        <path d="M3 10.2c1.8-3.6 3.4-3.6 5 0s3.2 3.6 5 0" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" />
      </template>
      <template v-else>
        <rect width="16" height="16" rx="4" fill="#5B82FF" />
        <circle cx="8" cy="8" r="2.2" fill="#fff" />
      </template>
    </svg>
  </span>
</template>
