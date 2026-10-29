// gov strings (US48). Keys start with "gov.". `{name}` marks a value filled in by t(key, { name }).
// Agency names and the city's owner labels (ACTIVE_CITY) stay as they are.
export const en = {
  "gov.loading": "Loading…",
  "gov.title": "Who has what",
  "gov.intro": "Public reports in {city}, grouped by the agency responsible.",
  "gov.back": "← All agencies",
  "gov.noSuchGroup": "No such group.",
  "gov.seeAll": "See all agencies",
  "gov.count.open": "open",
  "gov.count.fixed": "fixed",
  "gov.queue.open": "Open",
  "gov.queue.openNote": "Ranked by how many neighbors flagged it",
  "gov.queue.openEmpty": "No open reports.",
  "gov.queue.fixed": "Recently fixed",
  "gov.queue.fixedEmpty": "Nothing fixed yet.",
  "gov.queue.sample": "Sample · filmed in California",
  "gov.queue.untitled": "Untitled report",
  "gov.queue.meToo": "{count} me too",
};

export const es: Record<keyof typeof en, string> = {
  "gov.loading": "Cargando…",
  "gov.title": "Quién tiene qué",
  "gov.intro": "Reportes públicos en {city}, agrupados por la agencia responsable.",
  "gov.back": "← Todas las agencias",
  "gov.noSuchGroup": "No existe ese grupo.",
  "gov.seeAll": "Ver todas las agencias",
  "gov.count.open": "abiertos",
  "gov.count.fixed": "arreglados",
  "gov.queue.open": "Abiertos",
  "gov.queue.openNote": "Ordenados por cuántos vecinos los marcaron",
  "gov.queue.openEmpty": "No hay reportes abiertos.",
  "gov.queue.fixed": "Arreglados recientemente",
  "gov.queue.fixedEmpty": "Aún no hay nada arreglado.",
  "gov.queue.sample": "Muestra · grabado en California",
  "gov.queue.untitled": "Reporte sin título",
  "gov.queue.meToo": "{count} yo también",
};
