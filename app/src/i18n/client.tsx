"use client";
// El idioma y los textos en el cliente. El layout envuelve la app con I18nProvider;
// los componentes de cliente usan useT() y useLang().
import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_LANG, type Lang, type Messages } from "./types.ts";
import { dictionaries, fill, type T, type Vars } from "./index.ts";

interface I18nValue {
  lang: Lang;
  messages: Messages;
}

const I18nContext = createContext<I18nValue>({ lang: DEFAULT_LANG, messages: dictionaries[DEFAULT_LANG] });

export function I18nProvider({ lang, messages, children }: { lang: Lang; messages: Messages; children: ReactNode }) {
  return <I18nContext.Provider value={{ lang, messages }}>{children}</I18nContext.Provider>;
}

export function useLang(): Lang {
  return useContext(I18nContext).lang;
}

export function useT(): T {
  const { messages } = useContext(I18nContext);
  return (key: string, vars?: Vars) => fill(messages[key] ?? dictionaries[DEFAULT_LANG][key] ?? key, vars);
}
