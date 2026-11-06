// /admin/invitacion/<ficha>: la invitación a coorganizar un evento (coorganizar.ts). Sin sesión, la puerta de entrar
// como organizador, que después de entrar vuelve acá; con sesión, el nombre del evento y "Sumarme al equipo de este
// evento" (POST /api/organizador/invitacion). Usada, vencida o anulada, lo dice y lleva a Mis eventos. Abrirla no la
// gasta: solo el botón.
import type { Metadata } from "next";
import "@/components/evento/evento.css";
import { EntrarOrganizador } from "@/components/panel/EntrarOrganizador.tsx";
import { Aviso, Boton, BotonEnlace, Pantalla } from "@/components/ui.tsx";
import { getT } from "@/i18n/server.ts";
import { pollarPublishableKey } from "@/server/accounts.ts";
import { eventRole, invitePath, lookupInvite } from "@/server/coorganizar.ts";
import { organizerFromCookies } from "@/server/organizador.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

type Params = Promise<{ token: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("panel.invitacion.titulo"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

const ERRORES: Record<string, string> = {
  used: "panel.invitacion.usada",
  expired: "panel.invitacion.vencida",
  revoked: "panel.invitacion.anulada",
  missing: "panel.invitacion.noExiste",
  owner: "panel.invitacion.esTuyo",
  demasiados: "panel.cuenta.error.demasiados",
};

export default async function InvitePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const t = await getT();
  const repo = getRepo();
  const found = await lookupInvite(token);
  const event = found.eventId ? await repo.getEventById(found.eventId) : null;

  const organizer = await organizerFromCookies(repo);
  // Quien ya está en el equipo (o es la dueña) va derecho a su panel, aunque la invitación ya se haya usado.
  const role = organizer && event ? await eventRole(organizer, event) : null;
  if (event && role) {
    const panel = `/admin/${encodeURIComponent(event.slug)}${event.published ? "" : "/armar"}`;
    return (
      <Pantalla
        titulo={event.name}
        bajada={role === "owner" ? t("panel.invitacion.esTuyo") : t("panel.invitacion.yaEstas")}
        accion={<BotonEnlace href={panel}>{t("panel.invitacion.irPanel")}</BotonEnlace>}
      />
    );
  }

  if (found.state !== "open" || !event) {
    const key = ERRORES[found.state] ?? "panel.invitacion.noExiste";
    return (
      <Pantalla titulo={t("panel.invitacion.noSirve")} bajada={t(key)} accion={<BotonEnlace href="/admin">{t("panel.cuenta.misEventos")}</BotonEnlace>}>
        <p>{t("panel.invitacion.pedirOtra")}</p>
      </Pantalla>
    );
  }

  if (!organizer) {
    const pollarKey = pollarPublishableKey();
    if (!pollarKey) {
      return (
        <Pantalla titulo={t("panel.invitacion.titulo")} bajada={t("panel.invitacion.sinCuentas")} accion={<BotonEnlace href="/">{t("noEncontrado.volver")}</BotonEnlace>} />
      );
    }
    return <EntrarOrganizador pollarKey={pollarKey} volver={invitePath(token)} bajada={t("panel.invitacion.entrarPrimero", { evento: event.name })} />;
  }


  const error = typeof query.error === "string" ? ERRORES[query.error] : undefined;
  return (
    <Pantalla
      titulo={t("panel.invitacion.titulo")}
      bajada={t("panel.invitacion.bajada", { evento: event.name })}
      accion={
        <Boton type="submit" form="aceptar-invitacion" grande>
          {t("panel.invitacion.sumarme")}
        </Boton>
      }
      nota={t("panel.invitacion.nota")}
    >
      {error && <Aviso tono="alerta">{t(error)}</Aviso>}
      <p className="invitacion-evento">
        <strong>{event.name}</strong>
      </p>
      <p>{t("panel.invitacion.queHace")}</p>
      <p className="chico apagado">{organizer.name ? t("panel.cuenta.quien", { nombre: organizer.name }) : t("panel.cuenta.quienSinNombre")}</p>
      <form id="aceptar-invitacion" method="post" action="/api/organizador/invitacion">
        <input type="hidden" name="token" value={token} />
      </form>
    </Pantalla>
  );
}
