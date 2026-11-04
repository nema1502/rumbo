"use client";
// El formulario de inscripción: nombre y correo, y una sola acción. Mientras la red confirma (unos
// segundos) el botón espera y lo dice. Los errores vuelven de la acción del servidor, ya traducidos.
// Con Pollar prendido (llega su clave publicable), es FormularioConCuenta: primero se entra con Google o con el
// correo, y la credencial queda en la cuenta propia de la persona.
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/app/e/[slug]/inscripcion/actions.ts";
import { Aviso, Boton, Campo, Tarjeta } from "@/components/ui.tsx";
import { useT } from "@/i18n/client.tsx";
import { FormularioConCuenta, YaTenias } from "./FormularioConCuenta.tsx";

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
  /** Quien organiza, para la casilla opcional de contacto. */
  comunidad: string;
  /** La clave publicable de Pollar, si está prendido: entonces se entra con Google o con el correo. */
  pollarKey?: string | null;
}

function Campos({ state, comunidad }: { state: FormState; comunidad: string }) {
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
      {/* Opcional y desmarcada: solo quien la marca entra en la lista de contactos de la comunidad. */}
      <label className="casilla" htmlFor="contacto">
        <input id="contacto" name="contacto" type="checkbox" value="si" defaultChecked={state.values?.contact === true} />
        <span>
          {t("evento.form.contacto", { comunidad })}
          <span className="casilla-ayuda">{t("evento.form.contactoAyuda")}</span>
        </span>
      </label>
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

export function FormularioInscripcion(props: Props) {
  if (props.pollarKey) return <FormularioConCuenta {...props} pollarKey={props.pollarKey} />;
  return <FormularioDePrueba {...props} />;
}

/** El modo de prueba: la cuenta la crea y la guarda el servidor. */
function FormularioDePrueba({ action, slug, eventName, when, ticket, paid, monto, comunidad }: Props) {
  const t = useT();
  const [state, formAction] = useActionState(action, {} as FormState);

  if (state.existing) return <YaTenias slug={slug} correo={state.existing.email} />;

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
        <Campos state={state} comunidad={comunidad} />
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
