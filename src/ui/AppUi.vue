<script setup lang="ts">
import Toast from "primevue/toast";
import ControlsHint from "./components/ControlsHint.vue";
import InspectorPanel from "./components/InspectorPanel.vue";
import StatusBar from "./components/StatusBar.vue";
</script>

<template>
  <ControlsHint />
  <InspectorPanel />
  <StatusBar />
  <!-- Bottom-left: the status strip's controls occupy the bottom-right corner. -->
  <Toast position="bottom-left" :pt="{ root: { 'data-testid': 'toast' } }" />
</template>
