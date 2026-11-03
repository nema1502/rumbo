// El borrador de un evento que salió de una plantilla: qué credenciales hay, qué trae cada una, cómo se llama
// cada canje, dónde se canjea y cuántos hay. Una sola acción principal: "Publicar el evento". Es un formulario
// común, sin JavaScript en el navegador: las casillas apagan y encienden cada credencial.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AccesoPanel } from "@/components/panel/AccesoPanel.tsx";
import { Aviso, Boton, Campo, Chip, Tarjeta } from "@/components/ui.tsx";
import type { T } from "@/i18n/index.ts";
import { getLang, getT } from "@/i18n/server.ts";
import { kindLabelKey } from "@/lib/credential-kinds.ts";
import { readDraft, type DraftSlotView } from "@/server/kit/borrador.ts";
import { templateStations } from "@/server/kit/plantillas.ts";
import { verifyOrganizerKey } from "@/server/panel.ts";
import { PANEL_KEY_QUERY, panelKeyFromCookies } from "@/server/panel-sesion.ts";
import { getRepo } from "@/server/repo.ts";
import { guardarBorrador } from "./actions.ts";

export const dynamic = "force-dynamic";

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
  general: "kit.armar.errorGeneral",
};

export default async function DraftPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const repo = getRepo();
  const event = await repo.getEventBySlug(slug);
  if (!event) notFound();

  const key = query[PANEL_KEY_QUERY];
  if (typeof key === "string" && key) redirect(`/api/admin/${encodeURIComponent(slug)}/entrar?k=${encodeURIComponent(key)}&next=armar`);

  const t = await getT();
  if (!(await verifyOrganizerKey(event.id, await panelKeyFromCookies(slug)))) {
    return <AccesoPanel slug={slug} eventName={event.name} t={t} error={query.error === "clave"} next="armar" />;
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

  return (
    <form className="pantalla armar" action={guardarBorrador}>
      <header className="pantalla-cabecera">
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
        {errorKey && <Aviso tono="alerta">{t(errorKey)}</Aviso>}

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
