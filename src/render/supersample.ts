/**
 * Export supersampling (SSAA): the requested factor, clamped so the internal render buffer
 * never exceeds the GPU's max 2D texture dimension. Pure so both the engine (authoritative,
 * with the live device limit) and the export dialog (the "renders at …" hint) compute the
 * same effective factor from one place — no drift between the hint and what actually happens.
 */
export function effectiveSupersample(
  width: number,
  height: number,
  requested: number,
  maxDim: number,
): number {
  const req = Math.max(1, Math.floor(requested));
  const longSide = Math.max(width, height, 1);
  const fit = Math.floor(Math.max(maxDim, 1) / longSide);
  return Math.max(1, Math.min(req, fit));
}
