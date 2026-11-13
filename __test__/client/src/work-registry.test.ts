import { it, expect, vi } from "vite-plus/test";
import { createOanClient } from "@oh-awesome-novel/client";
const fingerprint = "a".repeat(64);
it("uses structured request bodies and rejects malformed work registries and identity fields", async () => {
  const fetcher = vi.fn();
  const client = createOanClient({ backendBaseUrl: "http://127.0.0.1:3210", fetch: fetcher });
  const json = (value: unknown) =>
    new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  const edit = {
    registry: { version: 1 as const, works: [{ id: "a", title: "A" }] },
    attributions: [],
  };
  fetcher.mockResolvedValueOnce(json({ pendingActionId: "pa_1234-abcd" }));
  await client.proposeWorkRegistry({ expectedWorkspaceRoot: "/novel", fingerprint, edit });
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({
    expectedWorkspaceRoot: "/novel",
    fingerprint,
    edit,
  });
  for (const value of [
    {
      registry: {
        version: 1,
        works: [
          { id: "a", title: "A" },
          { id: "a", title: "B" },
        ],
      },
      attributions: [],
      fingerprint,
    },
    { registry: null, attributions: [{ path: "../secret", label: "bad" }], fingerprint },
    {
      registry: null,
      attributions: [{ path: "characters/a/meta.yaml", label: "A", originWorkId: "../secret" }],
      fingerprint,
    },
    { registry: null, attributions: [], fingerprint: "bad" },
  ]) {
    fetcher.mockResolvedValueOnce(json(value));
    await expect(client.getWorkRegistry()).rejects.toThrow();
  }
  const count = fetcher.mock.calls.length;
  await expect(
    client.proposeWorkRegistry({
      expectedWorkspaceRoot: "/novel",
      fingerprint,
      edit: {
        ...edit,
        attributions: [{ path: "characters/a/meta.yaml", originWorkId: "missing" }],
      },
    }),
  ).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(count);
});
