import { useLocalStorage } from "@vueuse/core";
import type { Ref } from "vue";

export interface InspectorPrefs {
  /** Whole inspector collapsed to a slim edge tab. */
  collapsed: Ref<boolean>;
  /** Ids of the accordion sections currently open (persisted across reloads). */
  openSections: Ref<string[]>;
  /** Open ids belonging to one accordion group (a tier renders as its own Accordion). */
  openFor: (ids: readonly string[]) => string[];
  /** Replace one group's open ids with the accordion's emitted value. */
  setOpen: (ids: readonly string[], value: unknown) => void;
}

export function useInspectorPrefs(): InspectorPrefs {
  const collapsed = useLocalStorage("kf.inspector.collapsed", false);
  const openSections = useLocalStorage<string[]>("kf.inspector.open", ["camera", "lighting"]);

  const openFor = (ids: readonly string[]): string[] =>
    openSections.value.filter((id) => ids.includes(id));

  const setOpen = (ids: readonly string[], value: unknown): void => {
    const next = Array.isArray(value) ? value.map(String) : value == null ? [] : [String(value)];
    openSections.value = [...openSections.value.filter((id) => !ids.includes(id)), ...next];
  };

  return { collapsed, openSections, openFor, setOpen };
}
