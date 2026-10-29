// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import CameraCapture from "../../../components/capture/CameraCapture";
import { translateRecorderMessage } from "../../../components/capture/recorderMessage";
import { CONVERT_ERROR_MESSAGE, FILE_ERROR_MESSAGE } from "../../../lib/hooks/useClipRecorder";
import { I18nProvider, type TFunction } from "../../../lib/i18n/I18nProvider";
import { translate } from "../../../lib/i18n/dictionary";
import { resetLocaleStore, setLocale } from "../../../lib/i18n/locale";
import { describeCameraError } from "../../../lib/media/cameraError";
import { HEIC_HINT, UNREADABLE_PHOTOS } from "../../../lib/media/preparePhotos";
import { CLIP_TOO_BIG } from "../../../server/lib/postLimits";

beforeEach(() => {
  localStorage.clear();
  resetLocaleStore();
  setLocale("es");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  resetLocaleStore();
});

test("the camera reads in Spanish", () => {
  render(
    <I18nProvider>
      <CameraCapture modes={["video", "photos"]} onVideo={vi.fn()} onPhotos={vi.fn()} onClose={vi.fn()} />
    </I18nProvider>,
  );
  expect(screen.getByRole("dialog", { name: "Cámara" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cerrar" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Abrir cámara" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Foto" })).toBeTruthy();
  expect(screen.getByText("Subir")).toBeTruthy();
});

// The English sentences the lib code produces are matched against the dictionary, so a reworded
// message there would stop being translated; this keeps the two in step.
test("the recorder's own English errors are translated, and unknown ones pass through", () => {
  const t: TFunction = (key, vars) => translate("es", key, vars);
  const denied = new DOMException("x", "NotAllowedError");
  const cases = [
    FILE_ERROR_MESSAGE,
    CONVERT_ERROR_MESSAGE,
    HEIC_HINT,
    UNREADABLE_PHOTOS,
    describeCameraError(denied),
    describeCameraError(denied, { audio: true }),
    describeCameraError(new DOMException("x", "NotFoundError")),
    describeCameraError(new DOMException("x", "NotReadableError")),
  ];
  for (const message of cases) expect(translateRecorderMessage(message, t)).not.toBe(message);
  expect(translateRecorderMessage("SomethingError: boom", t)).toBe("SomethingError: boom");
  // CLIP_TOO_BIG is shown through post.clipTooBig.
  expect(translate("en", "post.clipTooBig")).toBe(CLIP_TOO_BIG);
});
