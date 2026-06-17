<script setup lang="ts">
import { computed, ref } from "vue";
import Button from "primevue/button";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import ParamSlider from "../ParamSlider.vue";
import { useController } from "../../composables/use-controller";
import { TRANSFORM_LIST } from "../../../fractal/transforms";
import type { TransformId } from "../../../fractal/transforms";
import type { ChainDeForm } from "../../../fractal/types";

// Hybrid formula chain editor (hybrid-formula-chains design, Phase 2). Stage param edits are
// value edits (uniform-only); add/remove/reorder/transform and the addC/bailout/DE-form toggles
// are structural and recompile the chain pipeline once (then it caches).
const controller = useController();
const state = controller.state;

// Two+ bulb stages compound within one iteration ((p^8)^8…) and overflow before the bailout
// fires, so the DE degrades to "far" everywhere and the fractal renders empty. The generator
// caps bulbs at one; the editor allows experimentation but warns rather than silently blanking.
const multiBulb = computed(
  () => state.chainStages.filter((s) => s.transform === "bulbPow").length > 1,
);

const transformOptions = TRANSFORM_LIST.map((t) => ({ label: t.name, value: t.id }));
const deFormOptions: { label: string; value: ChainDeForm }[] = [
  { label: "Linear", value: "linear" },
  { label: "Log", value: "log" },
];
const addCOptions = [
  { label: "Escape-time (+c)", value: true },
  { label: "Pure IFS", value: false },
];

// Local selection for the "add stage" picker; appends and resets on add.
const stageToAdd = ref<TransformId>(transformOptions[0]!.value);
function addStage(): void {
  controller.addChainStage(stageToAdd.value);
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Degenerate-config warning: a multi-bulb chain overflows to an empty render. -->
    <p
      v-if="multiBulb"
      class="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200"
      data-testid="chain-multibulb-warning"
    >
      Two or more Bulb power stages overflow the distance estimate and render empty. Keep at most
      one bulb stage.
    </p>

    <!-- Chain-level structure controls. -->
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-muted-color">Reinjection</span>
        <SelectButton
          v-tooltip.left="
            'Escape-time re-adds the original point each iteration (bulb/box); pure IFS does not (Sierpinski-like).'
          "
          :model-value="state.chainAddC"
          :options="addCOptions"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          size="small"
          data-testid="chain-addc"
          @update:model-value="controller.setChainAddC($event)"
        />
      </div>
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-muted-color">Distance form</span>
        <SelectButton
          v-tooltip.left="
            'Linear DE suits box/IFS chains; the sharper log DE suits pure-bulb chains.'
          "
          :model-value="state.chainDeForm"
          :options="deFormOptions"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          size="small"
          data-testid="chain-deform"
          @update:model-value="controller.setChainDeForm($event)"
        />
      </div>
    </div>
    <ParamSlider
      label="Iterations"
      :min="state.iterationsMin"
      :max="state.iterationsMax"
      :step="1"
      :model-value="state.iterations"
      description="Chain iterations. Hybrids carry a much higher cap than atomic formulas; deep counts cost performance."
      testid="param-chain-iterations"
      @update:model-value="controller.setIterations($event)"
    />
    <ParamSlider
      label="Bailout"
      :min="0"
      :max="64"
      :step="0.5"
      :model-value="state.chainBailout"
      description="Escape radius for escape-time chains. Zero = no bailout (pure fold/IFS chains run the full iteration count)."
      testid="param-chain-bailout"
      @update:model-value="controller.setChainBailout($event)"
    />

    <!-- Per-stage editor. -->
    <div
      v-for="(stage, index) in state.chainStages"
      :key="index"
      class="rounded-md border border-white/10 p-2"
      :data-testid="`chain-stage-${index}`"
    >
      <div class="mb-2 flex items-center gap-1">
        <span class="mr-auto text-[10px] font-semibold uppercase tracking-widest text-muted-color">
          Stage {{ index + 1 }}
        </span>
        <Button
          icon="pi pi-arrow-up"
          size="small"
          severity="secondary"
          text
          :disabled="index === 0"
          :data-testid="`chain-stage-${index}-up`"
          @click="controller.moveChainStage(index, -1)"
        />
        <Button
          icon="pi pi-arrow-down"
          size="small"
          severity="secondary"
          text
          :disabled="index === state.chainStages.length - 1"
          :data-testid="`chain-stage-${index}-down`"
          @click="controller.moveChainStage(index, 1)"
        />
        <Button
          icon="pi pi-trash"
          size="small"
          severity="danger"
          text
          :disabled="state.chainStages.length <= 1"
          :data-testid="`chain-stage-${index}-remove`"
          @click="controller.removeChainStage(index)"
        />
      </div>
      <Select
        class="mb-2 w-full"
        :model-value="stage.transform"
        :options="transformOptions"
        option-label="label"
        option-value="value"
        size="small"
        :data-testid="`chain-stage-${index}-transform`"
        @update:model-value="controller.setChainStageTransform(index, $event)"
      />
      <ParamSlider
        v-for="param in stage.params"
        :key="param.key"
        :label="param.label"
        :min="param.min"
        :max="param.max"
        :step="param.step"
        :model-value="param.value"
        :description="param.description"
        :testid="`param-chain-${index}-${param.key}`"
        @update:model-value="controller.setChainStageParam(index, param.key, $event)"
      />
    </div>

    <!-- Add a stage. -->
    <div class="flex items-center gap-2">
      <Select
        class="flex-1"
        v-model="stageToAdd"
        :options="transformOptions"
        option-label="label"
        option-value="value"
        size="small"
        data-testid="chain-add-select"
      />
      <Button
        label="Add stage"
        icon="pi pi-plus"
        size="small"
        severity="secondary"
        :disabled="state.chainStages.length >= 8"
        data-testid="chain-add-stage"
        @click="addStage"
      />
    </div>

    <Button
      label="Remove chain"
      icon="pi pi-times"
      size="small"
      severity="secondary"
      text
      data-testid="chain-remove"
      @click="controller.removeChain()"
    />
  </div>
</template>
