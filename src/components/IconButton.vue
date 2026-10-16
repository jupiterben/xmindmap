<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{ icon: Component; label: string; disabled?: boolean; active?: boolean }>()
</script>

<template>
  <button type="button" class="icon-button" :class="{ active }" :title="label" :aria-label="label" :disabled="disabled">
    <component :is="icon" :size="18" :stroke-width="1.7" aria-hidden="true" />
  </button>
</template>
