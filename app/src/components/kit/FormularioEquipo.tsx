"use client";
// El formulario del equipo: su nombre y hasta cinco integrantes (nombre y correo), con una sola acción. Mientras
// se prepara la credencial de cada persona (unos segundos cada una) el botón espera y lo dice.
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { TeamFormState } from "@/app/e/[slug]/equipo/actions.ts";
import { Aviso, Boton, BotonEnlace, Campo } from "@/components/ui.tsx";
import { useT } from "@/i18n/client.tsx";

interface Props {
  action: (prev: TeamFormState, formData: FormData) => Promise<TeamFormState>;
  slug: string;
  eventName: string;
  /** Cuántas filas de integrantes mostrar. */
  rows: number;
}

function Cuerpo({ state, rows }: { state: TeamFormState; rows: number }) {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <fieldset disabled={pending} className="equipo-integrantes">
      <Campo id="equipo" name="equipo" etiqueta={t("kit.equipo.nombre")} defaultValue={state.values?.team ?? ""} maxLength={60} autoComplete="off" />
      {Array.from({ length: rows }, (_, i) => (
        <div className="equipo-integrante" key={i}>
          <h3>
            {t("kit.equipo.integrante", { n: i + 1 })}
            {i > 0 && <span className="apagado chico">{t("kit.equipo.opcional")}</span>}
          </h3>
          <div className="kit-form-par">
            <Campo
              id={`nombre${i}`}
              name={`nombre${i}`}
              etiqueta={t("kit.equipo.nombrePersona")}
              autoComplete="off"
              maxLength={80}
              defaultValue={state.values?.members[i]?.name ?? ""}
            />
            <Campo
              id={`correo${i}`}
              name={`correo${i}`}
              type="email"
              etiqueta={t("kit.equipo.correoPersona")}
              autoComplete="off"
              inputMode="email"
              defaultValue={state.values?.members[i]?.email ?? ""}
              error={state.rowError?.row === i ? state.rowError.message : undefined}
            />
          </div>
        </div>
      ))}
    </fieldset>
  );
}

function Espera() {
  const { pending } = useFormStatus();
  const t = useT();
  return <div aria-live="polite">{pending && <Aviso>{t("kit.equipo.esperando")}</Aviso>}</div>;
}

function Enviar() {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <Boton type="submit" grande disabled={pending} aria-busy={pending || undefined}>
      {pending ? t("kit.equipo.enviando") : t("kit.equipo.enviar")}
    </Boton>
  );
}

export function FormularioEquipo({ action, slug, eventName, rows }: Props) {
  const t = useT();
  const [state, formAction] = useActionState(action, {} as TeamFormState);

  if (state.done) {
    return (
      <section className="pantalla equipo">
        <header className="pantalla-cabecera">
          <h1>{t("kit.equipo.listoTitulo")}</h1>
          <p className="bajada">{t("kit.equipo.listoTexto", { n: state.done.registered, equipo: state.done.team })}</p>
        </header>
        <div className="pantalla-cuerpo">{state.done.failed > 0 && <Aviso tono="alerta">{t("kit.equipo.listoParcial", { n: state.done.failed })}</Aviso>}</div>
        <div className="pantalla-accion">
          <BotonEnlace href={`/e/${slug}`} grande>
            {t("kit.equipo.volver")}
          </BotonEnlace>
        </div>
      </section>
    );
  }

  return (
    <form action={formAction} className="pantalla equipo" noValidate>
      <header className="pantalla-cabecera">
        <h1>{t("kit.equipo.titulo")}</h1>
        <p className="bajada">
          {eventName}. {t("kit.equipo.bajada")}
        </p>
      </header>
      <div className="pantalla-cuerpo">
        <input type="hidden" name="evento" value={slug} />
        {state.error && <Aviso tono="alerta">{state.error}</Aviso>}
        <Cuerpo state={state} rows={rows} />
        <Espera />
      </div>
      <div className="pantalla-accion">
        <Enviar />
        <p className="nota">{t("cuenta.modoPrueba")}</p>
      </div>
    </form>
  );
}
