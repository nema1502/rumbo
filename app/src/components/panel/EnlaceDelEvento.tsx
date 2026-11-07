"use client";
// El enlace público del evento (/e/<evento>), entero y a la vista (en el celular baja de renglón en vez de cortarse,
// así se ve el final que eligió quien organiza), con "Copiar el enlace" y "Ver la página" en otra pestaña. Lo usan la
// pantalla de publicar, ya publicado, y el panel.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/client.tsx";
import { BotonCopiar } from "./BotonCopiar.tsx";

export function EnlaceDelEvento({ slug, principal = false, className }: { slug: string; /** Copiar como la acción principal de la pantalla. */ principal?: boolean; className?: string }) {
  const t = useT();
  const publico = `/e/${encodeURIComponent(slug)}`;
  const [origen, setOrigen] = useState("");
  useEffect(() => setOrigen(window.location.origin), []);
  return (
    <div className={["enlace-evento", className].filter(Boolean).join(" ")}>
      <p className="enlace-evento-titulo" id={`enlace-${slug}`}>
        {t("kit.publicando.enlace")}
      </p>
      <p className="enlace-evento-url" aria-labelledby={`enlace-${slug}`}>
        <bdi>{`${origen}${publico}`}</bdi>
      </p>
      <div className="enlace-evento-acciones">
        <BotonCopiar
          texto={() => `${window.location.origin}${publico}`}
          etiqueta={t("panel.compartir.copiar")}
          listo={t("panel.puestos.copiado")}
          chico={!principal}
          variante={principal ? "primario" : "secundario"}
          grande={principal}
        />
        <Link className="enlace" href={publico} target="_blank" rel="noopener">
          {t("kit.publicando.verPagina")}
        </Link>
      </div>
    </div>
  );
}

/** Solo el botón "Copiar el enlace" del evento, para una lista (Mis eventos): el enlace se arma con el sitio de la página. */
export function CopiarEnlaceDelEvento({ slug, nombre }: { slug: string; /** Para quien usa lector de pantalla: de qué evento es el enlace. */ nombre: string }) {
  const t = useT();
  return (
    <BotonCopiar
      texto={() => `${window.location.origin}/e/${encodeURIComponent(slug)}`}
      etiqueta={t("panel.compartir.copiar")}
      listo={t("panel.puestos.copiado")}
      chico={false}
      aria-label={t("panel.cuenta.copiarEnlaceDe", { evento: nombre })}
    />
  );
}
