import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadTextFile } from "../../src/core/download";

interface FakeAnchor {
  download: string;
  href: string;
  click: ReturnType<typeof vi.fn>;
}

function harness() {
  const anchor: FakeAnchor = { download: "", href: "", click: vi.fn() };
  const created: Blob[] = [];
  const revoked: string[] = [];
  vi.stubGlobal(
    "Blob",
    class {
      constructor(
        public parts: unknown[],
        public opts: { type?: string },
      ) {}
    },
  );
  vi.stubGlobal("URL", {
    createObjectURL: (b: Blob) => {
      created.push(b);
      return "blob:mock-url";
    },
    revokeObjectURL: (u: string) => revoked.push(u),
  });
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      expect(tag).toBe("a");
      return anchor;
    },
  });
  return { anchor, created, revoked };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("downloadTextFile", () => {
  it("wires an anchor to an object URL and clicks it", () => {
    const h = harness();
    downloadTextFile("library.json", '{"a":1}');
    expect(h.anchor.download).toBe("library.json");
    expect(h.anchor.href).toBe("blob:mock-url");
    expect(h.anchor.click).toHaveBeenCalledTimes(1);
    expect(h.created).toHaveLength(1);
    expect((h.created[0] as unknown as { opts: { type: string } }).opts.type).toBe(
      "application/json",
    );
  });

  it("honours a custom mime type", () => {
    const h = harness();
    downloadTextFile("note.txt", "hello", "text/plain");
    expect((h.created[0] as unknown as { opts: { type: string } }).opts.type).toBe("text/plain");
  });

  it("defers URL revocation to a later task (not synchronous after click)", () => {
    vi.useFakeTimers();
    const h = harness();
    downloadTextFile("library.json", "{}");
    expect(h.revoked).toHaveLength(0); // still alive right after click
    vi.runAllTimers();
    expect(h.revoked).toEqual(["blob:mock-url"]);
  });
});
