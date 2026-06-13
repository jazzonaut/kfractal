/** Trigger a browser download of `text` as `filename` via a temporary object URL. */
export function downloadTextFile(filename: string, text: string, mime = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const anchor = document.createElement("a");
  anchor.download = filename;
  anchor.href = url;
  anchor.click();
  // Defer revoke to a later task: the spec doesn't guarantee the download fetch has
  // dereferenced the blob by the time a synchronous revoke runs.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
