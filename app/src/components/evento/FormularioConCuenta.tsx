"use client";
// La inscripción con la cuenta propia: entrar con Google o con el correo (Pollar crea la cuenta de Stellar y
// custodia la llave), y después el nombre y el correo ya escritos, y una sola acción. Al confirmar:
//   1. la cuenta prueba que es de quien entró: firma el desafío del servidor (SEP-53);
//   2. el servidor prepara la inscripción; para la entrada paga, la cuenta primero acepta el USDC de prueba;
//   3. la cuenta autoriza lo que el evento le pide (signAuthEntry), y el servidor lo manda pagando la comisión.
// Cada paso se dice en palabras simples mientras pasa. Nada de esto le pide plata a la persona por la comisión.
import { useEffect, useState, type FormEvent } from "react";
import type { PollarClient } from "@pollar/core";
import {
  walletChallengeAction,
  walletRegisterAction,
  walletSignAction,
  type WalletFormState,
  type WalletRegistrationInput,
} from "@/app/e/[slug]/inscripcion/actions.ts";
import { Aviso, Boton, BotonEnlace, Campo, Tarjeta } from "@/components/ui.tsx";
import { useT } from "@/i18n/client.tsx";
import type { ResumenEntrada } from "./FormularioInscripcion.tsx";
import { AccionesIngreso, FormulariosCorreo, useIngresoPollar } from "./IngresoPollar.tsx";
import { usePollar } from "./usePollar.ts";

type Paso = "prueba" | "preparando" | "usdc" | "autorizando" | "anotando";

interface Props {
  pollarKey: string;
  slug: string;
  eventName: string;
  when: string;
  ticket: ResumenEntrada;
  paid: boolean;
  monto: string;
  comunidad: string;
}

const esperar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Cuánto se espera a que Pollar cree la cuenta antes de dejar que la cree el servidor. */
const ESPERA_CUENTA_MS = 90_000;
/** Cuántas veces se mira si la cuenta ya acepta el USDC de prueba, una cada tres segundos. */
const INTENTOS_USDC = 8;

/** El redirect de una acción del servidor no es un error: es la navegación a la confirmación. */
function esNavegacion(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

export function YaTenias({ slug, correo }: { slug: string; correo: string }) {
  const t = useT();
  return (
    <section className="pantalla">
      <header className="pantalla-cabecera">
        <h1>{t("evento.existente.titulo")}</h1>
        <p className="bajada">{t("evento.existente.texto", { correo })}</p>
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

export function FormularioConCuenta({ pollarKey, slug, eventName, when, ticket, paid, monto, comunidad }: Props) {
  const t = useT();
  const pollar = usePollar(pollarKey);
  const { client, wallet, provisioning, profile } = pollar;
  // Entrar (Google, o el correo y su código) es lo mismo que para la cuenta de organizador: IngresoPollar.tsx.
  const ingreso = useIngresoPollar(pollar);
  const [paso, setPaso] = useState<Paso | null>(null);
  const [estado, setEstado] = useState<WalletFormState>({});
  const [esperaVencida, setEsperaVencida] = useState(false);

  // Si Pollar tarda demasiado en crear la cuenta, se sigue igual: el servidor la crea.
  useEffect(() => {
    if (provisioning !== "CREATING") return;
    const id = setTimeout(() => setEsperaVencida(true), ESPERA_CUENTA_MS);
    return () => clearTimeout(id);
  }, [provisioning]);

  if (estado.existing) return <YaTenias slug={slug} correo={estado.existing.email} />;

  const ocupado = paso !== null;
  const creandoCuenta = wallet !== null && provisioning === "CREATING" && !esperaVencida;

  /** El desafío, la prueba (SEP-53) y la inscripción con esa prueba. Cada vuelta pide un desafío nuevo. */
  async function probarEInscribir(c: PollarClient, address: string, datos: Omit<WalletRegistrationInput, "wallet">): Promise<WalletFormState | undefined> {
    setPaso("prueba");
    const desafio = await walletChallengeAction(address);
    if ("error" in desafio) return { error: desafio.error };
    const prueba = await c.stellar.sep53.signMessage(desafio.message);
    if (prueba.status !== "signed" || prueba.signerAddress !== address) {
      console.warn("[pollar] La cuenta no firmó el desafío", prueba.status === "error" ? (prueba.details ?? prueba.code) : "otra cuenta");
      return { error: t("evento.cuenta.error.prueba") };
    }
    setPaso("preparando");
    return walletRegisterAction({ ...datos, wallet: { publicKey: address, challengeId: desafio.challengeId, signature: prueba.signature } });
  }

  async function inscribirme(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || !wallet || ocupado) return;
    const form = new FormData(event.currentTarget);
    const datos = {
      slug,
      ticketTypeId: ticket.id,
      name: String(form.get("nombre") ?? ""),
      email: String(form.get("correo") ?? ""),
      contact: form.get("contacto") === "si",
      diet: String(form.get("dieta") ?? ""),
    };
    const values = { name: datos.name, email: datos.email, contact: datos.contact };
    setEstado({ values });
    let navegando = false;
    try {
      let r = await probarEInscribir(client, wallet.address, datos);
      // La entrada paga: la cuenta tiene que aceptar el USDC de prueba. Pollar la agrega; se espera a que llegue.
      for (let intento = 0; r?.needsTrustline && intento < INTENTOS_USDC; intento++) {
        setPaso("usdc");
        if (intento === 0) {
          const linea = await client.setTrustline({ code: r.needsTrustline.code, issuer: r.needsTrustline.issuer });
          if (linea.status === "error") {
            console.warn("[pollar] No se pudo agregar la línea de confianza", linea.details);
            setEstado({ error: t("evento.cuenta.error.usdc"), values });
            return;
          }
        } else {
          await esperar(3000);
        }
        r = await probarEInscribir(client, wallet.address, datos);
      }
      if (r?.needsTrustline) {
        setEstado({ error: t("evento.cuenta.error.usdc"), values });
        return;
      }
      if (r?.needsSignature) {
        setPaso("autorizando");
        const firmada = await client.signAuthEntry(r.needsSignature.authEntry, { validUntilLedger: r.needsSignature.validUntilLedger });
        if (firmada.status !== "signed") {
          console.warn("[pollar] La cuenta no autorizó la inscripción", firmada.details ?? firmada.code);
          setEstado({ error: t("evento.cuenta.error.autorizar"), values });
          return;
        }
        setPaso("anotando");
        r = await walletSignAction({ slug, requestId: r.needsSignature.requestId, signedAuthEntry: firmada.signedAuthEntry });
      }
      // Sin respuesta: la acción llevó a la confirmación.
      if (!r) {
        navegando = true;
        return;
      }
      setEstado({ ...r, values: r.values ?? values });
    } catch (error) {
      if (esNavegacion(error)) {
        navegando = true;
        throw error;
      }
      console.warn("[pollar] La inscripción se cortó", error);
      setEstado({ error: t("evento.error.red"), values });
    } finally {
      if (!navegando) setPaso(null);
    }
  }

  async function salir() {
    if (!client) return;
    setEstado({});
    ingreso.reiniciar();
    await client.logout().catch(() => undefined);
  }

  const cabecera = (
    <header className="pantalla-cabecera">
      <h1>{paid ? t("evento.form.tituloPago") : t("evento.form.tituloGratis")}</h1>
      <p className="bajada">{wallet ? t("evento.form.bajada") : paid ? t("evento.cuenta.bajadaPago") : t("evento.cuenta.bajadaGratis")}</p>
    </header>
  );
  const resumen = (
    <Tarjeta className="form-resumen">
      <h2>{ticket.name}</h2>
      <span className="entrada-precio">{ticket.price}</span>
      <p>
        {eventName}. {when}.
      </p>
      {ticket.includes && <p>{ticket.includes}</p>}
      {paid && <p>{t("evento.cuenta.pagoNota")}</p>}
    </Tarjeta>
  );

  // Todavía no entró: Google, o el correo con un código.
  if (!wallet) {
    return (
      <section className="pantalla form-inscripcion">
        {cabecera}
        <div className="pantalla-cuerpo">
          {resumen}
          <FormulariosCorreo ingreso={ingreso} pollar={pollar} />
        </div>
        <div className="pantalla-accion">
          <AccionesIngreso ingreso={ingreso} pollar={pollar} />
          <p className="nota">{t("evento.cuenta.custodia")}</p>
        </div>
      </section>
    );
  }

  // Ya entró: el nombre y el correo vienen de su cuenta, y una sola acción.
  const quien = profile?.email || "";
  return (
    <form onSubmit={inscribirme} className="pantalla form-inscripcion" noValidate>
      {cabecera}
      <div className="pantalla-cuerpo">
        {resumen}
        <Aviso tono="listo" className="cuenta-entro">
          <span>{quien ? t("evento.cuenta.entraste", { correo: quien }) : t("evento.cuenta.entrasteSinCorreo")}</span>
          <button type="button" className="enlace" onClick={salir} disabled={ocupado}>
            {t("evento.cuenta.salir")}
          </button>
        </Aviso>
        {/* La clave remonta los campos cuando llega el perfil, para que aparezcan escritos. */}
        <fieldset disabled={ocupado} key={quien || "sin-perfil"}>
          <Campo
            id="nombre"
            name="nombre"
            etiqueta={t("campo.nombre")}
            autoComplete="name"
            maxLength={80}
            defaultValue={estado.values?.name ?? profile?.name ?? ""}
            error={estado.fields?.name}
          />
          <Campo
            id="correo"
            name="correo"
            type="email"
            etiqueta={t("campo.correo")}
            autoComplete="email"
            inputMode="email"
            ayuda={t("evento.form.correoAyuda")}
            defaultValue={estado.values?.email ?? quien}
            error={estado.fields?.email}
          />
          <Campo id="dieta" name="dieta" etiqueta={t("kit.dieta.campo")} ayuda={t("kit.dieta.ayuda")} maxLength={120} autoComplete="off" />
          <label className="casilla" htmlFor="contacto">
            <input id="contacto" name="contacto" type="checkbox" value="si" defaultChecked={estado.values?.contact === true} />
            <span>
              {t("evento.form.contacto", { comunidad })}
              <span className="casilla-ayuda">{t("evento.form.contactoAyuda")}</span>
            </span>
          </label>
        </fieldset>
      </div>
      <div className="pantalla-accion">
        {/* Cada paso, junto al botón: siempre a la vista, también en el celular. */}
        <div aria-live="polite" className="cuenta-estado">
          {paso ? (
            <Aviso>{t(`evento.cuenta.paso.${paso}`)}</Aviso>
          ) : estado.error ? (
            <Aviso tono="alerta">{estado.error}</Aviso>
          ) : creandoCuenta ? (
            <Aviso>{t("evento.cuenta.creandoCuenta")}</Aviso>
          ) : null}
        </div>
        <Boton type="submit" grande disabled={ocupado || creandoCuenta} aria-busy={ocupado || undefined}>
          {ocupado ? t("evento.form.enviando") : paid ? t("evento.form.confirmarPago", { monto }) : t("evento.form.confirmarGratis")}
        </Boton>
        <p className="nota">{t("evento.cuenta.custodia")}</p>
      </div>
    </form>
  );
}
