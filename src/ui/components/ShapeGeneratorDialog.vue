<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import Select from "primevue/select";
import { useToast } from "primevue/usetoast";
import ParamSlider from "./ParamSlider.vue";
import SavePresetDialog from "./SavePresetDialog.vue";
import { useController } from "../composables/use-controller";
import { FORMULAS } from "../../fractal/registry";
import type { FractalFormulaId } from "../../fractal/types";

defineProps<{ visible: boolean }>();
const emit = defineEmits<{ (e: "update:visible", value: boolean): void }>();

const controller = useController();
const state = controller.state;
const toast = useToast();

const formulaChoice = ref<FractalFormulaId | "any">("any");
const FORMULA_OPTIONS: { label: string; value: FractalFormulaId | "any" }[] = [
  { label: "Any formula", value: "any" },
  ...FORMULAS.map((formula) => ({ label: formula.name, value: formula.id })),
];

// Lock state is dialog-local: locks hold live values across rolls, and only mean
// something against the schema they were set on (ADR-0011) - prune on formula change.
const locks = reactive<Record<string, boolean>>({});
const lockIterations = ref(false);
const strength = ref(0.25);
const saveOpen = ref(false);

watch(
  () => state.formulaId,
  () => {
    const keys = new Set(state.formulaParams.map((param) => param.key));
    for (const key of Object.keys(locks)) {
      if (!keys.has(key)) delete locks[key];
    }
  },
);

const lockOptions = () => ({
  lockedParams: Object.keys(locks).filter((key) => locks[key]),
  lockIterations: lockIterations.value,
});

function onGenerate(): void {
  controller.generateShape({ formula: formulaChoice.value, ...lockOptions() });
}

function onMutate(): void {
  controller.mutateShape(strength.value, lockOptions());
}

function onSave(name: string, description: string): void {
  const result = controller.saveUserItem("shape", name, description);
  if (result.ok) toast.add({ severity: "success", summary: "Shape saved", life: 2500 });
  else {
    toast.add({ severity: "error", summary: result.error ?? "Something went wrong.", life: 4000 });
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    :modal="false"
    :close-on-escape="true"
    position="left"
    header="Shape generator"
    class="w-[22rem]"
    data-testid="shape-generator-dialog"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="flex flex-col gap-3">
      <label class="flex flex-col gap-1 text-xs text-muted-color">
        Formula
        <Select
          v-model="formulaChoice"
          :options="FORMULA_OPTIONS"
          option-label="label"
          option-value="value"
          size="small"
          data-testid="generator-formula-select"
        />
      </label>

      <div class="flex flex-col">
        <div
          v-for="param in state.formulaParams"
          :key="param.key"
          class="grid grid-cols-[1.75rem_1fr] items-center"
        >
          <Button
            :icon="locks[param.key] ? 'pi pi-lock' : 'pi pi-lock-open'"
            size="small"
            severity="secondary"
            text
            :data-testid="`generator-lock-${param.key}`"
            @click="locks[param.key] = !locks[param.key]"
          />
          <ParamSlider
            :label="param.label"
            :min="param.min"
            :max="param.max"
            :step="param.step"
            :model-value="param.value"
            :description="param.description"
            :testid="`generator-param-${param.key}`"
            @update:model-value="controller.setFormulaParam(param.key, $event)"
          />
        </div>
        <div class="grid grid-cols-[1.75rem_1fr] items-center">
          <Button
            :icon="lockIterations ? 'pi pi-lock' : 'pi pi-lock-open'"
            size="small"
            severity="secondary"
            text
            data-testid="generator-lock-iterations"
            @click="lockIterations = !lockIterations"
          />
          <ParamSlider
            label="Iterations"
            :min="state.iterationsMin"
            :max="state.iterationsMax"
            :step="1"
            :model-value="state.iterations"
            description="Fractal iteration depth - more iterations carve finer detail."
            testid="generator-param-iterations"
            @update:model-value="controller.setIterations($event)"
          />
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <Button
          label="Generate"
          icon="pi pi-sparkles"
          size="small"
          data-testid="generator-generate-button"
          @click="onGenerate"
        />
        <p class="text-xs text-muted-color">Locks only hold while the formula stays the same.</p>
      </div>

      <div class="border-t border-white/10 pt-2">
        <ParamSlider
          label="Variation"
          :min="0"
          :max="1"
          :step="0.01"
          :model-value="strength"
          description="How far Mutate strays from the current shape's parameters."
          testid="generator-strength-slider"
          @update:model-value="strength = $event"
        />
        <Button
          label="Mutate"
          icon="pi pi-bolt"
          size="small"
          outlined
          class="w-full"
          data-testid="generator-mutate-button"
          @click="onMutate"
        />
      </div>
    </div>
    <template #footer>
      <Button
        label="Close"
        icon="pi pi-times"
        size="small"
        severity="secondary"
        text
        data-testid="generator-close-button"
        @click="emit('update:visible', false)"
      />
      <Button
        label="Save to My shapes"
        icon="pi pi-save"
        size="small"
        data-testid="generator-save-button"
        @click="saveOpen = true"
      />
    </template>
  </Dialog>

  <SavePresetDialog v-model:visible="saveOpen" mode="save" lock-kind="shape" @confirm="onSave" />
</template>
