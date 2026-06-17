<script setup lang="ts">
import Button from "primevue/button";
import ParamSlider from "../ParamSlider.vue";
import { useController } from "../../composables/use-controller";

// Schema-driven (ADR-0004): a new formula param in the registry surfaces here automatically.
const controller = useController();
const state = controller.state;
</script>

<template>
  <ParamSlider
    v-for="param in state.formulaParams"
    :key="param.key"
    :label="param.label"
    :min="param.min"
    :max="param.max"
    :step="param.step"
    :model-value="param.value"
    :description="param.description"
    :testid="`param-formula-${param.key}`"
    @update:model-value="controller.setFormulaParam(param.key, $event)"
  />
  <ParamSlider
    label="Iterations"
    :min="state.iterationsMin"
    :max="state.iterationsMax"
    :step="1"
    :model-value="state.iterations"
    description="Number of fractal iterations. Higher reveals finer detail but costs performance."
    testid="param-iterations"
    @update:model-value="controller.setIterations($event)"
  />
  <!-- Hybrid formula chains (hybrid-formula-chains design): turn this atomic formula into an
       editable stack of composable transforms. The chain editor then replaces this section. -->
  <Button
    class="mt-2 w-full"
    label="Start hybrid chain"
    icon="pi pi-sitemap"
    size="small"
    severity="secondary"
    outlined
    data-testid="start-chain"
    @click="controller.startChain()"
  />
</template>
