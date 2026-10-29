// confirm strings (US48). Keys start with "confirm.". `{name}` marks a value filled in by t(key, { name }).
// The capture and verdict screens under this page are FixCapture's (fix.* keys).
export const en = {
  "confirm.loading": "Loading…",
  "confirm.notFound": "This report doesn't exist.",
  "confirm.alreadyFixed": "This report is already fixed.",
  "confirm.cityOnly": "Only a city crew can mark this report fixed.",
  "confirm.back": "← Back to the feed",
  "confirm.title": "Is it fixed?",
  "confirm.intro": "Stand where the original was filmed and record a short clip. We compare it with the original.",
  "confirm.originalAlt": "The original report",
  "confirm.untitled": "Untitled report",
};

export const es: Record<keyof typeof en, string> = {
  "confirm.loading": "Cargando…",
  "confirm.notFound": "Este reporte no existe.",
  "confirm.alreadyFixed": "Este reporte ya está arreglado.",
  "confirm.cityOnly": "Solo una cuadrilla de la ciudad puede marcar este reporte como arreglado.",
  "confirm.back": "← Volver al inicio",
  "confirm.title": "¿Ya está arreglado?",
  "confirm.intro": "Párate donde se grabó el original y graba un clip corto. Lo comparamos con el original.",
  "confirm.originalAlt": "El reporte original",
  "confirm.untitled": "Reporte sin título",
};
