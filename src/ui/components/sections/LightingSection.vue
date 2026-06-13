<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Button from "primevue/button";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import ToggleSwitch from "primevue/toggleswitch";
import ParamSlider from "../ParamSlider.vue";
import ColorParam from "../ColorParam.vue";
import Vec3Param from "../Vec3Param.vue";
import { useController } from "../../composables/use-controller";
import { MAX_LIGHTS } from "../../../fractal/types";
import type { LightType, SkyMode } from "../../../fractal/types";

const controller = useController();
const state = controller.state;

const DEG = Math.PI / 180;
const round2 = (v: number): number => Math.round(v * 100) / 100;

// Which light the per-light controls edit; a pure UI concern, never persisted.
const selected = ref(0);
watch(
  () => state.lights.length,
  (len) => {
    if (selected.value >= len) selected.value = Math.max(0, len - 1);
  },
);

const light = computed(() => state.lights[selected.value]);

const lightOptions = computed(() => state.lights.map((_, i) => ({ label: `${i + 1}`, value: i })));

const typeOptions: { label: string; value: LightType }[] = [
  { label: "Sun", value: "directional" },
  { label: "Point", value: "positional" },
];

const skyModes: { label: string; value: SkyMode }[] = [
  { label: "Studio", value: "studio" },
  { label: "Sky", value: "preetham" },
  { label: "Env", value: "envmap" },
];

function addLight(): void {
  const index = controller.addLight();
  if (index !== null) selected.value = index;
}

function removeLight(): void {
  controller.removeLight(selected.value);
}

// Aim controls for directional lights: azimuth/elevation views over the stored
// direction (not necessarily unit length, so the readout normalizes first), using the
// same convention as the Preetham sun (x = cosEl sinAz, y = sinEl, z = cosEl cosAz).
// Each write is user-initiated and re-derives to the same angles, so the views stay stable.
const dirAngles = computed(() => {
  const [x, y, z] = light.value?.direction ?? [0, 1, 0];
  // Stored directions are not necessarily unit length (curated looks and defaultNewLight
  // both ship non-unit vectors; the render path normalizes on upload). Divide by the norm
  // before asin so the readout is correct and an azimuth-only edit is a no-op on elevation.
  const len = Math.hypot(x, y, z);
  const ny = len > 1e-6 ? y / len : 1;
  return {
    az: round2(Math.atan2(x, z) / DEG),
    el: round2(Math.asin(Math.max(-1, Math.min(1, ny))) / DEG),
  };
});

function setDirAngles(az: number, el: number): void {
  const a = az * DEG;
  const e = el * DEG;
  controller.setLightDirection(selected.value, [
    Math.cos(e) * Math.sin(a),
    Math.sin(e),
    Math.cos(e) * Math.cos(a),
  ]);
}

// Placement controls for positional lights: spherical (around the origin, where the
// fractal lives) and raw XYZ are both views over the one stored position.
const posSpherical = computed(() => {
  const [x, y, z] = light.value?.position ?? [0, 0, 0];
  const dist = Math.hypot(x, y, z);
  if (dist < 1e-6) return { az: 0, el: 0, dist: 0 };
  return {
    az: round2(Math.atan2(x, z) / DEG),
    el: round2(Math.asin(Math.max(-1, Math.min(1, y / dist))) / DEG),
    dist: round2(dist),
  };
});

function setPosSpherical(az: number, el: number, dist: number): void {
  const a = az * DEG;
  const e = el * DEG;
  const d = Math.max(dist, 0.05);
  controller.setLightPosition(selected.value, [
    d * Math.cos(e) * Math.sin(a),
    d * Math.sin(e),
    d * Math.cos(e) * Math.cos(a),
  ]);
}
</script>

<template>
  <div class="mb-2 flex items-center justify-between gap-2">
    <span
      v-tooltip.left="
        'Up to four lights; each is a soft sun at infinity or a point light placed in the scene.'
      "
      class="cursor-help text-xs text-muted-color"
      >Lights</span
    >
    <div class="flex items-center gap-1">
      <SelectButton
        v-model="selected"
        :options="lightOptions"
        option-label="label"
        option-value="value"
        :allow-empty="false"
        size="small"
        data-testid="param-light-select"
      />
      <Button
        icon="pi pi-plus"
        text
        size="small"
        severity="secondary"
        :disabled="state.lights.length >= MAX_LIGHTS"
        aria-label="Add light"
        data-testid="param-light-add"
        @click="addLight"
      />
      <Button
        icon="pi pi-trash"
        text
        size="small"
        severity="secondary"
        :disabled="state.lights.length <= 1"
        aria-label="Remove light"
        data-testid="param-light-remove"
        @click="removeLight"
      />
    </div>
  </div>

  <template v-if="light">
    <div class="grid grid-cols-[5.5rem_1fr] items-center gap-3 py-1.5">
      <label
        v-tooltip.left="'Disabled lights keep their settings but cast nothing.'"
        class="cursor-help truncate text-xs text-muted-color"
        >Enabled</label
      >
      <div class="flex items-center justify-between gap-2">
        <ToggleSwitch
          :model-value="light.enabled"
          data-testid="param-light-enabled"
          @update:model-value="controller.setLightEnabled(selected, $event)"
        />
        <SelectButton
          :model-value="light.type"
          :options="typeOptions"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          size="small"
          data-testid="param-light-type"
          @update:model-value="controller.setLightType(selected, $event)"
        />
      </div>
    </div>
    <ParamSlider
      label="Intensity"
      :min="0"
      :max="6"
      :step="0.05"
      :model-value="light.intensity"
      description="Brightness of this light."
      testid="param-light-intensity"
      @update:model-value="controller.setLightParam(selected, 'intensity', $event)"
    />
    <ColorParam
      label="Color"
      :model-value="light.color"
      description="Colour of this light."
      testid="param-light-color"
      @update:model-value="controller.setLightColor(selected, $event)"
    />

    <template v-if="light.type === 'directional'">
      <ParamSlider
        label="Size"
        :min="0.02"
        :max="0.7"
        :step="0.01"
        :model-value="light.size"
        description="Angular size of the light. Larger softens shadows; smaller sharpens them."
        testid="param-light-size"
        @update:model-value="controller.setLightParam(selected, 'size', $event)"
      />
      <ParamSlider
        label="Azimuth"
        :min="-180"
        :max="180"
        :step="1"
        :model-value="dirAngles.az"
        description="Compass direction the light shines from, in degrees."
        testid="param-light-azimuth"
        @update:model-value="setDirAngles($event, dirAngles.el)"
      />
      <ParamSlider
        label="Elevation"
        :min="-89"
        :max="89"
        :step="0.5"
        :model-value="dirAngles.el"
        description="Height of the light above the horizon, in degrees."
        testid="param-light-elevation"
        @update:model-value="setDirAngles(dirAngles.az, $event)"
      />
    </template>

    <template v-else>
      <ParamSlider
        label="Radius"
        :min="0.005"
        :max="0.5"
        :step="0.005"
        :model-value="light.size"
        description="Radius of the light sphere. Larger softens shadows."
        testid="param-light-size"
        @update:model-value="controller.setLightParam(selected, 'size', $event)"
      />
      <ParamSlider
        label="Falloff"
        :min="0.05"
        :max="8"
        :step="0.05"
        :model-value="light.falloff"
        description="Distance at which the light has faded to half. Small keeps it local; large reaches the whole scene."
        testid="param-light-falloff"
        @update:model-value="controller.setLightParam(selected, 'falloff', $event)"
      />
      <ParamSlider
        label="Azimuth"
        :min="-180"
        :max="180"
        :step="1"
        :model-value="posSpherical.az"
        description="Compass direction of the light around the fractal, in degrees."
        testid="param-light-azimuth"
        @update:model-value="setPosSpherical($event, posSpherical.el, posSpherical.dist)"
      />
      <ParamSlider
        label="Elevation"
        :min="-89"
        :max="89"
        :step="0.5"
        :model-value="posSpherical.el"
        description="Height of the light above the fractal, in degrees."
        testid="param-light-elevation"
        @update:model-value="setPosSpherical(posSpherical.az, $event, posSpherical.dist)"
      />
      <ParamSlider
        label="Distance"
        :min="0.05"
        :max="12"
        :step="0.05"
        :model-value="posSpherical.dist"
        description="Distance from the scene origin."
        testid="param-light-distance"
        @update:model-value="setPosSpherical(posSpherical.az, posSpherical.el, $event)"
      />
      <Vec3Param
        label="Position"
        :min="-12"
        :max="12"
        :step="0.01"
        :model-value="light.position"
        description="Exact scene-space position of the light."
        testid="param-light-pos"
        @update:model-value="controller.setLightPosition(selected, $event)"
      />
      <div class="py-1.5">
        <Button
          label="Place at camera"
          icon="pi pi-video"
          size="small"
          severity="secondary"
          outlined
          class="w-full"
          data-testid="param-light-place-camera"
          @click="controller.placeLightAtCamera(selected)"
        />
      </div>
    </template>
  </template>

  <ParamSlider
    v-if="state.skyMode === 'studio'"
    label="Ambient"
    :min="0"
    :max="0.02"
    :step="0.0005"
    :model-value="state.ambient"
    description="Flat fill light added everywhere to lift shadows (studio mode only)."
    testid="param-ambient"
    @update:model-value="controller.setAmbient($event)"
  />

  <div class="mt-3 border-t border-white/10 pt-3">
    <div class="mb-2 flex items-center justify-between gap-3">
      <span
        v-tooltip.left="
          'Source of the background and image-based lighting: a neutral studio, a physically modelled sky, or an environment map.'
        "
        class="cursor-help text-xs text-muted-color"
        >Environment</span
      >
      <SelectButton
        :model-value="state.skyMode"
        :options="skyModes"
        option-label="label"
        option-value="value"
        :allow-empty="false"
        size="small"
        data-testid="param-sky-mode"
        @update:model-value="controller.setSkyMode($event)"
      />
    </div>

    <template v-if="state.skyMode === 'preetham'">
      <ParamSlider
        label="Sky intensity"
        :min="0"
        :max="3"
        :step="0.02"
        :model-value="state.envIntensity"
        description="Overall brightness of the procedural sky lighting."
        testid="param-env-intensity"
        @update:model-value="controller.setSkyParam('intensity', $event)"
      />
      <ParamSlider
        label="Sun elevation"
        :min="2"
        :max="89"
        :step="0.5"
        :model-value="state.sunElevation"
        description="Height of the sun above the horizon, in degrees. Low angles give warm, raking light."
        testid="param-sun-elevation"
        @update:model-value="controller.setSkyParam('sunElevation', $event)"
      />
      <ParamSlider
        label="Sun azimuth"
        :min="-180"
        :max="180"
        :step="1"
        :model-value="state.sunAzimuth"
        description="Compass direction of the sun, in degrees - rotates the light around the scene."
        testid="param-sun-azimuth"
        @update:model-value="controller.setSkyParam('sunAzimuth', $event)"
      />
      <ParamSlider
        label="Turbidity"
        :min="2"
        :max="10"
        :step="0.1"
        :model-value="state.turbidity"
        description="Atmospheric haze. Low is clear blue sky; high is milky and overcast."
        testid="param-turbidity"
        @update:model-value="controller.setSkyParam('turbidity', $event)"
      />
      <ParamSlider
        label="Sun size"
        :min="0.01"
        :max="0.25"
        :step="0.005"
        :model-value="state.sunSize"
        description="Angular diameter of the sun disc. Larger softens sun shadows."
        testid="param-sun-size"
        @update:model-value="controller.setSkyParam('sunSize', $event)"
      />
    </template>

    <template v-else-if="state.skyMode === 'envmap'">
      <div class="grid grid-cols-[5.5rem_1fr] items-center gap-3 py-1.5">
        <label
          v-tooltip.left="
            'Which procedural environment map lights the scene and fills the background.'
          "
          class="cursor-help truncate text-xs text-muted-color"
          >Map</label
        >
        <Select
          :model-value="state.envId"
          :options="[...state.environments]"
          option-label="name"
          option-value="id"
          size="small"
          class="w-full"
          data-testid="param-env-select"
          @update:model-value="controller.setEnvMap($event)"
        />
      </div>
      <ParamSlider
        label="Intensity"
        :min="0"
        :max="3"
        :step="0.02"
        :model-value="state.envIntensity"
        description="Brightness of the environment-map lighting."
        testid="param-env-intensity"
        @update:model-value="controller.setSkyParam('intensity', $event)"
      />
      <ParamSlider
        label="Rotation"
        :min="-180"
        :max="180"
        :step="1"
        :model-value="state.envYaw"
        description="Rotates the environment map around the scene, in degrees."
        testid="param-env-yaw"
        @update:model-value="controller.setSkyParam('yaw', $event)"
      />
    </template>
  </div>
</template>
