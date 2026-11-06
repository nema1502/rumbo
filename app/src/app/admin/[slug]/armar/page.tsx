// El borrador de un evento que salió de una plantilla: qué credenciales hay, qué trae cada una, cómo se llama
// cada canje, dónde se canjea y cuántos hay. Una sola acción principal: "Publicar el evento". Es un formulario
// común, sin JavaScript en el navegador: las casillas apagan y encienden cada credencial.
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AccesoPanel } from "@/components/panel/AccesoPanel.tsx";
import { CompartirPanel } from "@/components/panel/CompartirPanel.tsx";
import { TuEquipo } from "@/components/panel/TuEquipo.tsx";
import { Aviso, Boton, Campo, Chip, Tarjeta } from "@/components/ui.tsx";
import type { T } from "@/i18n/index.ts";
import { getLang, getT } from "@/i18n/server.ts";
import { kindLabelKey } from "@/lib/credential-kinds.ts";
import { pollarEnabled } from "@/server/accounts.ts";
import { listTeam } from "@/server/coorganizar.ts";
import { readDraft, type DraftSlotView } from "@/server/kit/borrador.ts";
import { SLUG_MAX, SLUG_MIN } from "@/server/kit/direccion.ts";
import { templateStations } from "@/server/kit/plantillas.ts";
import { PANEL_KEY_QUERY, panelAccess } from "@/server/panel-sesion.ts";
import { getRepo } from "@/server/repo.ts";
import { guardarBorrador } from "./actions.ts";

export const dynamic = "force-dynamic";
// La acción de publicar despliega un contrato por tipo de credencial en la red de prueba: tarda. Con Fluid en Vercel el tope por omisión alcanza; se declara igual.
export const maxDuration = 300;

type Params = Promise<{ slug: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("kit.armar.titulo"), robots: { index: false, follow: false } };
}

const ERRORS: Record<string, string> = {
  price: "kit.armar.errorPrecio",
  stock: "kit.armar.errorStock",
  cupo: "kit.armar.errorCupo",
  publicar: "kit.armar.errorPublicar",
  publicando: "kit.armar.errorPublicando",
  general: "kit.armar.errorGeneral",
  name: "kit.armar.errorGeneral",
  "direccion-formato": "kit.armar.direccionFormato",
  "direccion-reservada": "kit.armar.direccionReservada",
  "direccion-ocupada": "kit.armar.direccionOcupada",
  "direccion-publicado": "kit.armar.direccionPublicado",
};

/** El comienzo de la dirección pública, como la va a ver quien la reciba: el origen de este pedido y /e/. */
async function publicPrefix(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return "/e/";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127.0.0.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}/e/`;
}

export default async function DraftPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const repo = getRepo();
  const event = await repo.getEventBySlug(slug);
  if (!event) notFound();

  const key = query[PANEL_KEY_QUERY];
  if (typeof key === "string" && key) redirect(`/api/admin/${encodeURIComponent(slug)}/entrar?k=${encodeURIComponent(key)}&next=armar`);

  const t = await getT();
  const access = await panelAccess(event);
  if (!access) {
    return <AccesoPanel slug={slug} eventName={event.name} t={t} error={query.error === "clave"} next="armar" conCuenta={pollarEnabled()} />;
  }
  // Ya publicado, o armado a mano: no hay borrador que editar.
  if (event.published || !event.template) redirect(`/admin/${encodeURIComponent(slug)}`);

  const lang = await getLang();
  const draft = await readDraft(repo, event, lang);
  if (!draft) redirect(`/admin/${encodeURIComponent(slug)}`);

  const benefitName = (benefitKey: string) => draft.benefits.find((b) => b.key === benefitKey)?.name ?? benefitKey;
  const used = new Set(draft.slots.filter((s) => s.included).flatMap((s) => s.benefits));
  const stations = templateStations(draft.template, lang);
  const errorKey = typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const slugError = typeof query.error === "string" && query.error.startsWith("direccion-") ? errorKey : undefined;
  const prefix = await publicPrefix();

  return (
    <form className="pantalla armar" action={guardarBorrador}>
      <header className="pantalla-cabecera">
        {access.via === "organizer" && (
          <Link className="enlace panel-mis-eventos" href="/admin">
            {t("panel.cuenta.misEventos")}
          </Link>
        )}
        <p className="panel-sobre">
          <Chip estado="pendiente">{t("kit.armar.borrador")}</Chip>
          <span>{t(draft.template.nameKey)}</span>
        </p>
        <h1>{event.name}</h1>
        <p className="bajada">{t("kit.armar.bajada")}</p>
      </header>
      <div className="pantalla-cuerpo">
        <input type="hidden" name="evento" value={slug} />
        {query.guardado === "1" && <Aviso tono="listo">{t("kit.armar.guardado")}</Aviso>}
        {errorKey && !slugError && <Aviso tono="alerta">{t(errorKey)}</Aviso>}

        <section className="armar-seccion" aria-labelledby="armar-direccion">
          <h2 id="armar-direccion">{t("kit.armar.direccion")}</h2>
          <div className={slugError ? "campo con-error" : "campo"}>
            <label className="campo-etiqueta" htmlFor="direccion">
              {t("kit.armar.direccionEtiqueta")}
            </label>
            <div className="direccion-campo">
              <span className="direccion-prefijo" aria-hidden="true">
                <bdi>{prefix}</bdi>
              </span>
              <input
                id="direccion"
                name="direccion"
                defaultValue={slug}
                required
                minLength={SLUG_MIN}
                maxLength={SLUG_MAX}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                aria-describedby={slugError ? "direccion-ayuda direccion-error" : "direccion-ayuda"}
                aria-invalid={slugError ? true : undefined}
              />
            </div>
            <p className="campo-ayuda" id="direccion-ayuda">
              {t("kit.armar.direccionAyuda", { min: SLUG_MIN, max: SLUG_MAX })}
            </p>
            {slugError && (
              <p className="campo-error" id="direccion-error" role="alert">
                {t(slugError)}
              </p>
            )}
          </div>
          <div className="armar-vista">
            <Boton type="submit" name="accion" value="vista" variante="secundario" formTarget="_blank" className="boton-chico">
              {t("kit.armar.verComoQueda")}
            </Boton>
            <span className="chico apagado">{t("kit.armar.verComoQuedaAyuda")}</span>
          </div>
        </section>

        <section className="armar-seccion" aria-labelledby="armar-credenciales">
          <h2 id="armar-credenciales">{t("kit.armar.credenciales")}</h2>
          <p>{t("kit.armar.credencialesAyuda")}</p>
          {draft.slots.map((slot) => (
            <CredencialCard key={slot.slot} slot={slot} template={draft.template} benefitName={benefitName} t={t} />
          ))}
        </section>

        <section className="armar-seccion" aria-labelledby="armar-canjes">
          <h2 id="armar-canjes">{t("kit.armar.canjes")}</h2>
          <p>
            {t("kit.armar.canjesAyuda")} {stations.map((s) => s.name).join(", ")}.
          </p>
          {draft.benefits
            .filter((b) => used.has(b.key) || !b.perCredential)
            .map((b) => (
              <div className="armar-canje" key={b.key}>
                <div className="armar-canje-campos">
                  <Campo id={`bnombre-${b.key}`} name={`bnombre.${b.key}`} etiqueta={t("kit.armar.benNombre")} defaultValue={b.name} maxLength={60} />
                  <Campo id={`blugar-${b.key}`} name={`blugar.${b.key}`} etiqueta={t("kit.armar.benPuesto")} defaultValue={b.place} maxLength={60} />
                  <Campo
                    id={`bstock-${b.key}`}
                    name={`bstock.${b.key}`}
                    etiqueta={t("kit.armar.benStock")}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    defaultValue={b.stock ?? ""}
                    placeholder={t("kit.panel.sinTope")}
                  />
                </div>
                {!b.perCredential && <p className="armar-canje-nota">{t("kit.armar.premioNota")}</p>}
              </div>
            ))}
          <p className="chico apagado">{t("kit.armar.benStockAyuda")}</p>
        </section>

        <section className="armar-seccion">
          <label className="kit-casilla">
            <input type="checkbox" name="equipos" defaultChecked={draft.teamSignup} />
            <span>
              <strong>{t("kit.armar.equipos")}</strong>
              <span className="apagado chico"> {t("kit.armar.equiposAyuda")}</span>
            </span>
          </label>
        </section>

        {/* La dueña suma a su equipo desde acá también: con un enlace de invitación, autorizando una cuenta, o con el enlace de la clave para quien no tiene cuenta. */}
        {access.role === "owner" && <TuEquipo slug={slug} initial={await listTeam(event)} />}
        {access.role === "owner" && <CompartirPanel slug={slug} />}
      </div>
      <div className="pantalla-accion">
        <div className="armar-acciones">
          <Boton type="submit" name="accion" value="publicar" grande>
            {t("kit.armar.publicar")}
          </Boton>
          <Boton type="submit" name="accion" value="guardar" variante="secundario">
            {t("kit.armar.guardar")}
          </Boton>
        </div>
        <p className="nota">{t("kit.armar.nota")}</p>
      </div>
    </form>
  );
}

function CredencialCard({
  slot,
  template,
  benefitName,
  t,
}: {
  slot: DraftSlotView;
  template: { benefitOrder: string[] };
  benefitName: (key: string) => string;
  t: T;
}) {
  const paid = slot.slot === "attendeePaid";
  const id = `tipo-${slot.slot}`;
  return (
    <Tarjeta className="armar-tipo">
      <div className="armar-incluir">
        {slot.locked ? (
          <>
            <input type="hidden" name={`tipo.${slot.slot}`} value="on" />
            <strong>{slot.name}</strong>
            <Chip estado="listo">{t("kit.armar.siempre")}</Chip>
          </>
        ) : (
          <label className="armar-incluir">
            <input type="checkbox" name={`tipo.${slot.slot}`} defaultChecked={slot.included} aria-label={`${t("kit.armar.incluir")}: ${slot.name}`} />
            <strong>{slot.name}</strong>
          </label>
        )}
        {slot.name.trim().toLowerCase() !== t(kindLabelKey(slot.kind)).toLowerCase() && <Chip estado="neutro">{t(kindLabelKey(slot.kind))}</Chip>}
        <Chip estado={paid ? "ganado" : "listo"}>{paid ? `${slot.price} USDC` : t("kit.armar.gratis")}</Chip>
      </div>
      <p className="armar-trae-resumen">
        {slot.benefits.length === 0 ? t("kit.armar.sinCanjes") : `${t("kit.armar.trae")}: ${slot.benefits.map(benefitName).join(", ")}`}
      </p>
      <details>
        <summary>{paid ? t("kit.armar.editarPago") : t("kit.armar.editar")}</summary>
        <div className="armar-campos">
          <Campo id={`${id}-nombre`} name={`nombre.${slot.slot}`} etiqueta={t("kit.armar.nombre")} defaultValue={slot.name} maxLength={60} />
          {paid && (
            <Campo
              id={`${id}-precio`}
              name={`precio.${slot.slot}`}
              etiqueta={t("kit.armar.precio")}
              ayuda={t("kit.armar.precioAyuda")}
              type="number"
              inputMode="decimal"
              min={1}
              max={1000}
              step="0.01"
              defaultValue={slot.price}
            />
          )}
          <fieldset className="armar-trae">
            <legend>{t("kit.armar.trae")}</legend>
            {template.benefitOrder
              .filter((key) => key !== "prize")
              .map((key) => (
                <label key={key}>
                  <input type="checkbox" name={`trae.${slot.slot}.${key}`} defaultChecked={slot.benefits.includes(key)} />
                  <span>{benefitName(key)}</span>
                </label>
              ))}
          </fieldset>
        </div>
      </details>
    </Tarjeta>
  );
}
