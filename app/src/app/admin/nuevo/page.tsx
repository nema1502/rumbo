// Armar un evento desde una plantilla, en dos pasos: elegir la plantilla (una sola acción: "Seguir") y contar lo
// básico del evento (otra sola acción: "Crear el borrador"). Lo demás se edita en /admin/<evento>/armar.
// Con la sesión de organizador (/admin) no hace falta la clave de la casa, y con el tope de la cuenta (o de la IP)
// alcanzado no hay formulario: se dice cuándo se libera. Sin sesión y con Pollar prendido, lo primero que se ofrece
// es entrar como organizador; la clave de la casa queda como camino secundario. Con Pollar apagado, como siempre.
import type { Metadata } from "next";
import { headers } from "next/headers";
import { Aviso, Boton, BotonEnlace, Campo, Chip, Pantalla, Tarjeta } from "@/components/ui.tsx";
import type { T } from "@/i18n/index.ts";
import { getLang, getT } from "@/i18n/server.ts";
import { pollarEnabled } from "@/server/accounts.ts";
import { createGate } from "@/server/kit/acceso.ts";
import { TEMPLATES, TEMPLATE_IDS, isTemplateId, suggestedStart, templateStations } from "@/server/kit/plantillas.ts";
import { clientKey } from "@/server/limites.ts";
import { createQuota, organizerFromCookies, type CreateQuota } from "@/server/organizador.ts";
import { getRepo } from "@/server/repo.ts";
import { crearBorrador } from "./actions.ts";

export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("kit.nuevo.titulo"), robots: { index: false, follow: false } };
}

const ERRORS: Record<string, string> = {
  name: "kit.datos.errorNombre",
  place: "kit.datos.errorCiudad",
  organizer: "kit.datos.errorOrganiza",
  date: "kit.datos.errorFecha",
  capacity: "kit.datos.errorCupo",
  clave: "kit.datos.errorClave",
  frenado: "kit.datos.errorFrenado",
  ocupado: "panel.cuenta.ocupado",
};

/** A dónde va "Entrar como organizador" desde acá: /admin, y después de entrar, de vuelta a crear. */
const ENTRAR_Y_VOLVER = "/admin?volver=/admin/nuevo";

/** El tope alcanzado, en palabras: cuántos (o desde esta conexión) y en cuánto se libera. */
function topeTexto(t: T, quota: Extract<CreateQuota, { ok: false }>): string {
  const cuantos = quota.reason === "ip" ? t("panel.cuenta.topeIp") : quota.limit === 1 ? t("panel.cuenta.topeUno") : t("panel.cuenta.tope", { n: quota.limit });
  const horas = Math.ceil(quota.freesInMs / 3600_000);
  const libera = horas <= 1 ? t("panel.cuenta.liberaUna") : t("panel.cuenta.libera", { horas });
  return `${cuantos} ${libera}`;
}

export default async function NewEventPage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const one = (name: string): string => {
    const value = query[name];
    return typeof value === "string" ? value : "";
  };
  const t = await getT();
  const lang = await getLang();
  const gate = createGate();
  const organizer = await organizerFromCookies();
  const conCuenta = pollarEnabled();

  // Con el tope alcanzado no hay formulario que llenar: el aviso, cuándo se libera y la vuelta a Mis eventos.
  if (organizer) {
    const quota = await createQuota(getRepo(), organizer, clientKey(await headers()));
    if (!quota.ok) {
      return (
        <Pantalla titulo={t("kit.nuevo.titulo")} accion={<BotonEnlace href="/admin">{t("panel.cuenta.volverMisEventos")}</BotonEnlace>}>
          <Aviso tono="alerta">{topeTexto(t, quota)}</Aviso>
        </Pantalla>
      );
    }
  }

  // Cerrado (producción sin RUMBO_CREATE_KEY) y sin cuenta de organizador. Con Pollar, la salida es entrar con la
  // cuenta; sin Pollar, se dice quién tiene la clave y la salida es volver al inicio.
  if (!gate.open && !organizer && conCuenta) {
    return (
      <Pantalla titulo={t("kit.nuevo.titulo")} bajada={t("panel.cuenta.nuevoEntrar")} accion={<BotonEnlace href={ENTRAR_Y_VOLVER}>{t("panel.cuenta.titulo")}</BotonEnlace>} />
    );
  }
  if (!gate.open && !organizer) {
    return (
      <Pantalla titulo={t("kit.nuevo.titulo")} accion={<BotonEnlace href="/">{t("noEncontrado.volver")}</BotonEnlace>}>
        <Aviso>{t("kit.datos.cerrado")}</Aviso>
        <p className="apagado chico">{t("kit.datos.cerradoAyuda")}</p>
      </Pantalla>
    );
  }

  const chosen = one("plantilla");
  if (!isTemplateId(chosen)) {
    return (
      <form className="pantalla" method="get" action="/admin/nuevo">
        <header className="pantalla-cabecera">
          <h1>{t("kit.nuevo.titulo")}</h1>
          <p className="bajada">{t("kit.nuevo.bajada")}</p>
        </header>
        <div className="pantalla-cuerpo">
          {!organizer && conCuenta && <EntrarPrimero t={t} />}
          <fieldset className="plantillas">
            <legend className="oculto-visual">{t("kit.nuevo.elegir")}</legend>
            {TEMPLATE_IDS.map((id, index) => {
              const spec = TEMPLATES[id];
              const stations = templateStations(spec, lang);
              const kinds = Object.values(spec.slots).filter((slot) => slot.included).length;
              return (
                <label className="plantilla" key={id}>
                  <input type="radio" name="plantilla" value={id} defaultChecked={index === 0} />
                  <div className="plantilla-marca">
                    <h2>{t(spec.nameKey)}</h2>
                    <Chip estado="listo">{t("pago.gratis")}</Chip>
                  </div>
                  <p>{t(spec.descriptionKey)}</p>
                  <p className="plantilla-trae">{t("kit.nuevo.trae", { tipos: kinds, canjes: stations.length - 1, puestos: stations.length })}</p>
                </label>
              );
            })}
          </fieldset>
        </div>
        <div className="pantalla-accion">
          <Boton type="submit" grande>
            {t("kit.nuevo.seguir")}
          </Boton>
          <p className="nota">{t("kit.nuevo.nota")}</p>
        </div>
      </form>
    );
  }

  const spec = TEMPLATES[chosen];
  const errorKey = ERRORS[one("error")];
  const error = errorKey ? t(errorKey) : null;
  const stations = templateStations(spec, lang);
  const kinds = Object.keys(spec.slots).filter((slot) => spec.slots[slot as keyof typeof spec.slots].included);
  return (
    <form className="pantalla" action={crearBorrador}>
      <header className="pantalla-cabecera">
        <h1>{t("kit.datos.titulo")}</h1>
        <p className="bajada">{t("kit.datos.bajada", { plantilla: t(spec.nameKey) })}</p>
      </header>
      <div className="pantalla-cuerpo">
        <input type="hidden" name="plantilla" value={chosen} />
        {error && <Aviso tono="alerta">{error}</Aviso>}
        <div className="kit-form">
          <Campo id="nombre" name="nombre" etiqueta={t("kit.datos.nombre")} defaultValue={one("nombre") || t(spec.nameKey)} maxLength={80} autoComplete="off" />
          <Campo id="cuando" name="cuando" type="datetime-local" etiqueta={t("kit.datos.cuando")} defaultValue={one("cuando") || suggestedStart()} required />
          <div className="kit-form-par">
            <Campo id="ciudad" name="ciudad" etiqueta={t("kit.datos.ciudad")} defaultValue={one("ciudad")} maxLength={80} autoComplete="address-level2" required />
            <Campo id="lugar" name="lugar" etiqueta={t("kit.datos.lugar")} defaultValue={one("lugar")} maxLength={80} autoComplete="off" />
          </div>
          <Campo id="organiza" name="organiza" etiqueta={t("kit.datos.organiza")} ayuda={t("kit.datos.organizaAyuda")} defaultValue={one("organiza")} maxLength={80} autoComplete="organization" required />
          <Campo
            id="cupo"
            name="cupo"
            type="number"
            inputMode="numeric"
            min={1}
            max={1000}
            etiqueta={t("kit.datos.cupo")}
            ayuda={t("kit.datos.cupoAyuda")}
            defaultValue={one("cupo") || String(spec.capacity)}
          />
          {gate.needsKey && !organizer && conCuenta && <EntrarPrimero t={t} />}
          {gate.needsKey && !organizer && <Campo id="clave" name="clave" type="password" etiqueta={t("kit.datos.clave")} ayuda={t("kit.datos.claveAyuda")} autoComplete="off" required />}
        </div>
        <Tarjeta className="kit-resumen">
          <h2>{t(spec.nameKey)}</h2>
          <div className="fila">
            {kinds.map((slot) => (
              <Chip key={slot} estado="neutro">
                {t(spec.slots[slot as keyof typeof spec.slots].nameKey ?? `kit.tipo.${slot}`)}
              </Chip>
            ))}
          </div>
          <p className="chico">{t("kit.nuevo.trae", { tipos: kinds.length, canjes: stations.length - 1, puestos: stations.length })}</p>
        </Tarjeta>
      </div>
      <div className="pantalla-accion">
        <Boton type="submit" grande>
          {t("kit.datos.crear")}
        </Boton>
        <p className="nota">
          {organizer && <>{t("panel.cuenta.nuevoNota")} </>}
          <a className="enlace" href="/admin/nuevo">
            {t("kit.datos.cambiar")}
          </a>
        </p>
      </div>
    </form>
  );
}

/** Sin sesión y con Pollar: entrar como organizador va primero, y la clave de la casa queda para quien la tiene. */
function EntrarPrimero({ t }: { t: T }) {
  return (
    <div className="kit-entrar-primero">
      <p>{t("panel.cuenta.nuevoEntrar")}</p>
      <BotonEnlace href={ENTRAR_Y_VOLVER} variante="secundario">
        {t("panel.cuenta.titulo")}
      </BotonEnlace>
    </div>
  );
}
