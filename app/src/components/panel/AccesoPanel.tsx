// La puerta del panel. Con cuentas de organizador (Pollar prendido) lo primero es "Entrar como organizador": quien
// creó el evento con su cuenta nunca tuvo una clave, y si su sesión venció (o entró con otra cuenta) vuelve por
// /admin, que después de entrar lo trae de nuevo acá (?volver=). La clave del evento queda como camino secundario,
// para quien coorganiza con el enlace que le pasaron. Sin Pollar, como siempre: la clave es la única puerta.
// El formulario de la clave va a /api/admin/<evento>/entrar, que la comprueba, la guarda en una cookie y vuelve
// al panel (o a la página de la que venía, con next).
import { Boton, BotonEnlace, Campo, Pantalla } from "@/components/ui.tsx";
import type { T } from "@/i18n/index.ts";

interface AccesoPanelProps {
  slug: string;
  eventName: string;
  t: T;
  /** Si la clave que se probó no sirvió. */
  error?: boolean;
  /** A dónde seguir después de entrar: "informe", "armar", "vivo", o nada para el panel. */
  next?: string;
  /** Si se puede entrar con la cuenta de organizador (Pollar prendido). */
  conCuenta?: boolean;
}

/** Las páginas de /admin/<evento> a las que /admin puede volver después de entrar. La pantalla en vivo vuelve al panel. */
const VOLVER: Record<string, string> = { armar: "/armar", informe: "/informe", importar: "/importar", stands: "/stands" };

export function AccesoPanel({ slug, eventName, t, error, next, conCuenta }: AccesoPanelProps) {
  const formulario = (
    <form id="acceso-panel" className="acceso-form" method="post" action={`/api/admin/${slug}/entrar`}>
      <Campo
        id="k"
        name="k"
        etiqueta={t("panel.acceso.clave")}
        ayuda={conCuenta ? t("panel.acceso.ayudaCuenta") : t("panel.acceso.ayuda")}
        error={error ? t("panel.acceso.error") : undefined}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        required
      />
      {next && <input type="hidden" name="next" value={next} />}
      {conCuenta && (
        <Boton type="submit" variante="secundario">
          {t("panel.acceso.entrarConClave")}
        </Boton>
      )}
    </form>
  );

  if (!conCuenta) {
    return (
      <Pantalla
        titulo={t("panel.acceso.titulo")}
        bajada={t("panel.acceso.bajada", { evento: eventName })}
        accion={
          <Boton type="submit" form="acceso-panel">
            {t("panel.acceso.entrar")}
          </Boton>
        }
      >
        {formulario}
      </Pantalla>
    );
  }

  const volver = `/admin/${slug}${(next && VOLVER[next]) ?? ""}`;
  return (
    <Pantalla
      titulo={t("panel.acceso.tituloCuenta")}
      bajada={t("panel.acceso.bajadaCuenta", { evento: eventName })}
      accion={<BotonEnlace href={`/admin?volver=${encodeURIComponent(volver)}`}>{t("panel.cuenta.titulo")}</BotonEnlace>}
    >
      <details className="acceso-con-clave" open={error || undefined}>
        <summary>{t("panel.acceso.conClave")}</summary>
        {formulario}
      </details>
    </Pantalla>
  );
}
