import type { Metadata, Viewport } from "next";
import { Suspense, type ReactNode } from "react";
import "./globals.css";
import { Marca } from "@/components/Marca.tsx";
import { SelectorIdioma } from "@/components/SelectorIdioma.tsx";
import { BotonTema } from "@/components/Tema.tsx";
import { I18nProvider } from "@/i18n/client.tsx";
import { dictionaries, makeT } from "@/i18n/index.ts";
import { getLang } from "@/i18n/server.ts";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f2e8" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1626" },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  const t = makeT(await getLang());
  return {
    title: { default: "Rumbo", template: "%s | Rumbo" },
    description: t("marca.lema"),
    applicationName: "Rumbo",
  };
}

// Aplica el tema recordado antes de pintar, para que la página no parpadee al cargar.
const THEME_SCRIPT = `try{var t=localStorage.getItem("rumbo.theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = await getLang();
  const t = makeT(lang);
  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <I18nProvider lang={lang} messages={dictionaries[lang]}>
          <header className="cabecera">
            <div className="contenedor">
              <Marca etiqueta={t("nav.inicio")} />
              <div className="acciones">
                <Suspense fallback={null}>
                  <SelectorIdioma />
                </Suspense>
                <BotonTema />
              </div>
            </div>
          </header>
          <main className="contenedor principal">{children}</main>
          <footer className="pie">
            <div className="contenedor">
              <span>{t("pie.hecho")}</span>
              <a className="enlace" href="https://github.com/nema1502/rumbo" rel="noopener">
                {t("pie.codigo")}
              </a>
            </div>
          </footer>
        </I18nProvider>
      </body>
    </html>
  );
}
