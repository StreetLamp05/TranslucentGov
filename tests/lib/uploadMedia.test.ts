// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { RESIDENT_TOKEN_HEADER } from "../../lib/data/headers";
import { uploadMedia } from "../../lib/upload";

// The MinIO upload (§1.1.1): a presigned URL from /api/files, then a PUT straight to MinIO.

const PUT_URL = "https://govtok.example/govtok/key-1?X-Amz-Signature=abc";
const fetchMock = vi.fn();

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("govtok.residentToken", "device-1");
  fetchMock.mockReset().mockImplementation(async (url: string) =>
    url === "/api/files" ? Response.json({ key: "key-1", url: PUT_URL }) : new Response(null, { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

test("asks /api/files as this device's resident, PUTs the blob with the signed type, returns the key", async () => {
  const blob = new Blob(["clip"], { type: "video/mp4;codecs=avc1,mp4a.40.2" });

  expect(await uploadMedia(blob)).toBe("key-1");

  const [filesUrl, filesInit] = fetchMock.mock.calls[0];
  expect(filesUrl).toBe("/api/files");
  expect(JSON.parse(filesInit.body)).toEqual({ contentType: "video/mp4" });
  expect(filesInit.headers[RESIDENT_TOKEN_HEADER]).toBe("device-1");
  expect(fetchMock).toHaveBeenLastCalledWith(PUT_URL, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: blob });
});

test("a fixer upload says so", async () => {
  await uploadMedia(new Blob(["x"], { type: "video/webm" }), { fixerToken: "fixer-1" });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ contentType: "video/webm", as: "fixer" });
});

test("a refused URL, a failed PUT and an untyped file all throw", async () => {
  fetchMock.mockImplementationOnce(async () => Response.json({ error: "Only video and image files can be uploaded." }, { status: 400 }));
  await expect(uploadMedia(new Blob(["x"], { type: "text/html" }))).rejects.toMatchObject({
    data: "Only video and image files can be uploaded.",
  });

  fetchMock.mockImplementation(async (url: string) =>
    url === "/api/files" ? Response.json({ key: "k", url: PUT_URL }) : new Response(null, { status: 403 }),
  );
  await expect(uploadMedia(new Blob(["x"], { type: "image/jpeg" }))).rejects.toThrow("Upload failed (403)");

  fetchMock.mockClear();
  await expect(uploadMedia(new Blob(["x"]))).rejects.toThrow(/no type/);
  expect(fetchMock).not.toHaveBeenCalled();
});
