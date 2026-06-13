<template>
  <!-- Click-through: the hint must never steal pointer input from the canvas. -->
  <p
    class="pointer-events-none fixed left-3 top-3 flex items-baseline gap-3 text-xs text-muted-color"
    data-testid="controls-hint"
  >
    <span class="text-sm font-semibold tracking-wide text-surface-100">KFractal</span>
    <span>
      <span class="font-semibold">Drag</span> orbit ·
      <span class="font-semibold">Right drag</span> pan ·
      <span class="font-semibold">Middle drag</span> roll ·
      <span class="font-semibold">Wheel</span> zoom
    </span>
  </p>
</template>
