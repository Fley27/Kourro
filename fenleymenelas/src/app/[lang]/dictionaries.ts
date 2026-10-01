import en from "./dictionaries/en.json";
import fr from "./dictionaries/fr.json";
import es from "./dictionaries/es.json";
import type { Locale } from "@/lib/i18n";

export type Dictionary = typeof en;

const dictionaries: Record<Locale, Dictionary> = { en, fr, es };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
