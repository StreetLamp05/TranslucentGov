import { afterEach, describe, expect, test, vi } from "vitest";
import { uploadProof } from "../../../components/fix/uploadProof";

const mutate = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/data/api", () => ({ mutate }));

afterEach(() => vi.unstubAllGlobals());

describe("uploadProof", () => {
  test("asks for a URL with the normalized type, PUTs the blob with that type, and returns the key", async () => {
    mutate.mockResolvedValue({ key: "k1", url: "https://govtok.test/put" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const blob = new Blob(["x"], { type: "video/webm;codecs=vp9" });

    expect(await uploadProof(blob, "fixer", "video")).toBe("k1");
    expect(mutate).toHaveBeenCalledWith("/api/fixes/upload-url", { as: "fixer", contentType: "video/webm" });
    expect(fetchMock).toHaveBeenCalledWith("https://govtok.test/put", {
      method: "PUT",
      headers: { "Content-Type": "video/webm" },
      body: blob,
    });
  });

  test("a blob with no type gets a media type for its kind", async () => {
    mutate.mockResolvedValue({ key: "k2", url: "https://govtok.test/put" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    await uploadProof(new Blob(["x"]), "resident", "image");
    expect(mutate).toHaveBeenLastCalledWith("/api/fixes/upload-url", { as: "resident", contentType: "image/jpeg" });
  });

  test("a failed PUT throws", async () => {
    mutate.mockResolvedValue({ key: "k3", url: "https://govtok.test/put" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(uploadProof(new Blob(["x"], { type: "image/jpeg" }), "fixer", "image")).rejects.toThrow(/403/);
  });
});
