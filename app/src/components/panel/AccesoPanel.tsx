// La puerta del panel: pide la clave de organizador. El formulario va a /api/admin/<evento>/entrar,
// que la comprueba, la guarda en una cookie y vuelve al panel (o al informe, si venía para ahí).
// Si este servidor tiene cuentas de organizador (Pollar), también se ofrece entrar con la cuenta.
import Link from "next/link";
import { Boton, Campo, Pantalla } from "@/components/ui.tsx";
import type { T } from "@/i18n/index.ts";

interface AccesoPanelProps {
  slug: string;
  eventName: string;
  t: T;
  /** Si la clave que se probó no sirvió. */
  error?: boolean;
  /** A dónde seguir después de entrar: "informe", o nada para el panel. */
  next?: string;
  /** Si se puede entrar con la cuenta de organizador (Pollar prendido). */
  conCuenta?: boolean;
}

export function AccesoPanel({ slug, eventName, t, error, next, conCuenta }: AccesoPanelProps) {
  return (
    <Pantalla
      titulo={t("panel.acceso.titulo")}
      bajada={t("panel.acceso.bajada", { evento: eventName })}
      accion={
        <Boton type="submit" form="acceso-panel">
          {t("panel.acceso.entrar")}
        </Boton>
      }
      nota={
        conCuenta ? (
          <Link className="enlace" href="/admin">
            {t("panel.acceso.conCuenta")}
          </Link>
        ) : undefined
      }
    >
      <form id="acceso-panel" className="acceso-form" method="post" action={`/api/admin/${slug}/entrar`}>
        <Campo
          id="k"
          name="k"
          etiqueta={t("panel.acceso.clave")}
          ayuda={t("panel.acceso.ayuda")}
          error={error ? t("panel.acceso.error") : undefined}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
        />
        {next && <input type="hidden" name="next" value={next} />}
      </form>
    </Pantalla>
  );
}
