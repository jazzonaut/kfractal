import { inject } from "vue";
import type { InjectionKey } from "vue";
import type { Controller } from "../controller";

export const CONTROLLER_KEY: InjectionKey<Controller> = Symbol("kf-controller");

/** The Controller seam, provided at mount. The only way UI components reach app state. */
export function useController(): Controller {
  const controller = inject(CONTROLLER_KEY);
  if (!controller) throw new Error("KFractal controller was not provided.");
  return controller;
}
