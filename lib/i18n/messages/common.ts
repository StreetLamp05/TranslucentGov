// Strings shared across screens (US48). Keys start with "common.". `{name}` marks a value filled
// in by t(key, { name }).
export const en = {
  "common.language": "Language",
  "common.demoBanner": "Demo mode: location simulated",
  "common.tab.feed": "Feed",
  "common.tab.map": "Map",
  "common.tab.me": "Me",
  "common.tab.post": "Post a problem",
  "common.tab.nav": "Main",
  "common.dayOne": "1 day",
  "common.dayOther": "{count} days",
};

export const es: Record<keyof typeof en, string> = {
  "common.language": "Idioma",
  "common.demoBanner": "Modo de demostración: ubicación simulada",
  "common.tab.feed": "Inicio",
  "common.tab.map": "Mapa",
  "common.tab.me": "Yo",
  "common.tab.post": "Publicar un problema",
  "common.tab.nav": "Principal",
  "common.dayOne": "1 día",
  "common.dayOther": "{count} días",
};
