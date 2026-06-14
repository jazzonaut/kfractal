/** Default sample cap for the progressive render (noise floor vs. wait time). */
export const SAMPLE_CAP = 128;

/** Sample-cap choices offered in the status strip. */
export const SAMPLE_CAP_CHOICES = [64, 128, 256, 512, 1024, 2048, 4096] as const;

/** Seconds between FPS readout refreshes. */
export const FPS_INTERVAL = 0.25;

/**
 * Camera control sensitivity: one multiplier applied to every gesture (orbit, pan, roll,
 * zoom) across both mouse and touch. 1 is the tuned baseline; the slider scales from a slow
 * crawl to ~3x. Persisted across reloads under CONTROL_SENSITIVITY_KEY.
 */
export const CONTROL_SENSITIVITY_DEFAULT = 1;
export const CONTROL_SENSITIVITY_MIN = 0.2;
export const CONTROL_SENSITIVITY_MAX = 3;
export const CONTROL_SENSITIVITY_STEP = 0.05;
export const CONTROL_SENSITIVITY_KEY = "kf.controls.sensitivity";

/** A named export resolution for the still-export dialog. */
export interface ResolutionPreset {
  readonly id: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

/**
 * Standard landscape export resolutions. The camera re-frames to fit any aspect
 * (vertical FOV is preserved), so wider entries simply reveal more horizontally.
 * Portrait is offered in the dialog by swapping width/height.
 */
export const RESOLUTION_PRESETS: readonly ResolutionPreset[] = [
  { id: "hd", label: "HD · 1280×720", width: 1280, height: 720 },
  { id: "fhd", label: "Full HD · 1920×1080", width: 1920, height: 1080 },
  { id: "qhd", label: "QHD 1440p · 2560×1440", width: 2560, height: 1440 },
  { id: "wfhd", label: "WFHD ultrawide · 2560×1080", width: 2560, height: 1080 },
  { id: "wqhd", label: "WQHD ultrawide · 3440×1440", width: 3440, height: 1440 },
  { id: "uhd4k", label: "4K UHD · 3840×2160", width: 3840, height: 2160 },
  { id: "uhd8k", label: "8K UHD · 7680×4320", width: 7680, height: 4320 },
];

/** Default export resolution preset id. */
export const DEFAULT_RESOLUTION_PRESET_ID = "fhd";

/** Sample-cap choices for the export render (higher than the live floor for a clean still). */
export const EXPORT_SAMPLE_CAP_CHOICES = [128, 256, 512, 1024, 2048, 4096] as const;

/** Default export sample cap. */
export const DEFAULT_EXPORT_SAMPLE_CAP = 512;

/** Default JPEG quality (0..1) when exporting a lossy still. */
export const DEFAULT_JPEG_QUALITY = 0.92;
