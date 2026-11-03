"use client";
// El formulario de inscripción: nombre y correo, y una sola acción. Mientras la red confirma (unos
// segundos) el botón espera y lo dice. Los errores vuelven de la acción del servidor, ya traducidos.
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/app/e/[slug]/inscripcion/actions.ts";
import { Aviso, Boton, BotonEnlace, Campo, Tarjeta } from "@/components/ui.tsx";
import { useT } from "@/i18n/client.tsx";

export interface ResumenEntrada {
  id: string;
  name: string;
  /** Ya formateado: "Gratis" o "10 USDC de prueba". */
  price: string;
  /** "Incluye el almuerzo y la polera", o null. */
  includes: string | null;
}

interface Props {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  slug: string;
  eventName: string;
  when: string;
  ticket: ResumenEntrada;
  paid: boolean;
  /** El monto ya formateado, para "Pagar 10 USDC de prueba". */
  monto: string;
}

function Campos({ state }: { state: FormState }) {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <fieldset disabled={pending}>
      <Campo id="nombre" name="nombre" etiqueta={t("campo.nombre")} autoComplete="name" maxLength={80} defaultValue={state.values?.name ?? ""} error={state.fields?.name} />
      <Campo
        id="correo"
        name="correo"
        type="email"
        etiqueta={t("campo.correo")}
        autoComplete="email"
        inputMode="email"
        ayuda={t("evento.form.correoAyuda")}
        defaultValue={state.values?.email ?? ""}
        error={state.fields?.email}
      />
      <Campo id="dieta" name="dieta" etiqueta={t("kit.dieta.campo")} ayuda={t("kit.dieta.ayuda")} maxLength={120} autoComplete="off" />
    </fieldset>
  );
}

function Espera() {
  const { pending } = useFormStatus();
  const t = useT();
  return <div aria-live="polite">{pending && <Aviso>{t("evento.form.esperando")}</Aviso>}</div>;
}

function Enviar({ label }: { label: string }) {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <Boton type="submit" grande disabled={pending} aria-busy={pending || undefined}>
      {pending ? t("evento.form.enviando") : label}
    </Boton>
  );
}

export function FormularioInscripcion({ action, slug, eventName, when, ticket, paid, monto }: Props) {
  const t = useT();
  const [state, formAction] = useActionState(action, {} as FormState);

  if (state.existing) {
    return (
      <section className="pantalla">
        <header className="pantalla-cabecera">
          <h1>{t("evento.existente.titulo")}</h1>
          <p className="bajada">{t("evento.existente.texto", { correo: state.existing.email })}</p>
        </header>
        <div className="pantalla-cuerpo" />
        <div className="pantalla-accion">
          <BotonEnlace href={`/e/${slug}`} grande>
            {t("evento.form.volver")}
          </BotonEnlace>
        </div>
      </section>
    );
  }

  return (
    <form action={formAction} className="pantalla form-inscripcion" noValidate>
      <header className="pantalla-cabecera">
        <h1>{paid ? t("evento.form.tituloPago") : t("evento.form.tituloGratis")}</h1>
        <p className="bajada">{t("evento.form.bajada")}</p>
      </header>
      <div className="pantalla-cuerpo">
        <input type="hidden" name="evento" value={slug} />
        <input type="hidden" name="entrada" value={ticket.id} />
        <Tarjeta className="form-resumen">
          <h2>{ticket.name}</h2>
          <span className="entrada-precio">{ticket.price}</span>
          <p>
            {eventName}. {when}.
          </p>
          {ticket.includes && <p>{ticket.includes}</p>}
          {paid && <p>{t("evento.form.pagoNota")}</p>}
        </Tarjeta>
        <Campos state={state} />
        {state.error && <Aviso tono="alerta">{state.error}</Aviso>}
        <Espera />
      </div>
      <div className="pantalla-accion">
        <Enviar label={paid ? t("evento.form.confirmarPago", { monto }) : t("evento.form.confirmarGratis")} />
        <p className="nota">{t("cuenta.modoPrueba")}</p>
      </div>
    </form>
  );
}
