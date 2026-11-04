"use client";
// Entrar con Pollar, en el navegador: "Entrar con Google" o "Entrar con mi correo" (el correo, y después el código
// de un solo uso). Lo comparten la inscripción con cuenta propia (FormularioConCuenta.tsx) y la cuenta de
// organizador (panel/EntrarOrganizador.tsx): el mismo estado, los mismos formularios y los mismos botones, así
// entrar se ve y se dice igual en los dos lugares. Qué pasa después de entrar lo decide cada pantalla.
import { useEffect, useState } from "react";
import { Aviso, Boton, Campo } from "@/components/ui.tsx";
import { useT } from "@/i18n/client.tsx";
import type { PollarState } from "./usePollar.ts";

export interface Ingreso {
  /** La persona eligió entrar con el correo (o Pollar ya está pidiendo el código). */
  conElCorreo: boolean;
  /** Pollar ya mandó el código y espera que la persona lo escriba (o el que escribió no sirvió). */
  pidiendoCodigo: boolean;
  /** El código que escribió no es o venció. */
  codigoMal: boolean;
  /** Un error de Pollar que no es del código. */
  errorCode: string | null;
  /** El correo al que fue el código. */
  correoCodigo: string;
  /** Pollar está en medio de algo (abriendo Google, mandando o revisando el código). */
  enCurso: boolean;
  /** El cliente cargó y se puede entrar. */
  listo: boolean;
  /** La clave del texto de lo que está pasando, o null si nada. */
  esperaKey: string | null;
  correoIngreso: string;
  setCorreoIngreso: (value: string) => void;
  codigo: string;
  setCodigo: (value: string) => void;
  google: () => void;
  abrirCorreo: () => void;
  mandarCodigo: () => void;
  otroCodigo: () => void;
  verificar: () => void;
  volver: () => void;
  /** Deja el ingreso como al principio (al salir de la cuenta). */
  reiniciar: () => void;
}

/** El estado del ingreso con Pollar y lo que hace cada botón. */
export function useIngresoPollar(pollar: PollarState): Ingreso {
  const { client, auth } = pollar;
  const [conCorreo, setConCorreo] = useState(false);
  const [correoIngreso, setCorreoIngreso] = useState("");
  const [codigo, setCodigo] = useState("");
  // El correo al que Pollar mandó el código: el estado de error ya no lo trae.
  const [correoDelCodigo, setCorreoDelCodigo] = useState("");
  const correoEnCurso = "email" in auth ? auth.email : undefined;
  useEffect(() => {
    if (correoEnCurso) setCorreoDelCodigo(correoEnCurso);
  }, [correoEnCurso]);

  const errorCode = auth.step === "error" ? auth.errorCode : null;
  const codigoMal = errorCode === "EMAIL_CODE_INVALID" || errorCode === "EMAIL_CODE_EXPIRED";
  const pidiendoCodigo = auth.step === "entering_code" || auth.step === "verifying_email_code" || codigoMal;
  const correoCodigo = correoEnCurso ?? (correoDelCodigo || correoIngreso.trim());
  const enCurso = auth.step === "creating_session" || auth.step === "sending_email" || auth.step === "opening_oauth" || auth.step === "authenticating" || auth.step === "verifying_email_code";
  const listo = pollar.ready && client !== null;
  let esperaKey: string | null = null;
  if (!pollar.ready && !pollar.loadFailed) esperaKey = "evento.cuenta.cargando";
  else if (auth.step === "opening_oauth") esperaKey = "evento.cuenta.abriendoGoogle";
  else if (auth.step === "creating_session" || auth.step === "sending_email") esperaKey = "evento.cuenta.mandando";
  else if (auth.step === "verifying_email_code") esperaKey = "evento.cuenta.verificando";
  else if (auth.step === "authenticating" || auth.step === "authenticated") esperaKey = "evento.cuenta.entrando";

  return {
    conElCorreo: conCorreo || pidiendoCodigo,
    pidiendoCodigo,
    codigoMal,
    errorCode,
    correoCodigo,
    enCurso,
    listo,
    esperaKey,
    correoIngreso,
    setCorreoIngreso,
    codigo,
    setCodigo,
    google: () => client?.login({ provider: "google" }),
    abrirCorreo: () => setConCorreo(true),
    mandarCodigo: () => {
      if (client && correoIngreso.trim()) client.login({ provider: "email", email: correoIngreso.trim() });
    },
    otroCodigo: () => client?.login({ provider: "email", email: correoCodigo }),
    verificar: () => {
      if (client && codigo.trim()) client.verifyEmailCode(codigo.trim());
    },
    volver: () => {
      client?.cancelLogin();
      setConCorreo(false);
      setCodigo("");
    },
    reiniciar: () => {
      setConCorreo(false);
      setCodigo("");
    },
  };
}

/** Los formularios del correo: el correo al que mandar el código, y después el código. Nada si se va por Google. */
export function FormulariosCorreo({ ingreso, pollar }: { ingreso: Ingreso; pollar: PollarState }) {
  const t = useT();
  return (
    <>
      {ingreso.conElCorreo && !ingreso.pidiendoCodigo && (
        <form
          className="cuenta-correo"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            ingreso.mandarCodigo();
          }}
        >
          <Campo
            id="correo-ingreso"
            type="email"
            etiqueta={t("campo.correo")}
            autoComplete="email"
            inputMode="email"
            value={ingreso.correoIngreso}
            onChange={(e) => ingreso.setCorreoIngreso(e.target.value)}
            disabled={ingreso.enCurso}
          />
          <Boton type="submit" disabled={!ingreso.listo || ingreso.enCurso || !ingreso.correoIngreso.trim()}>
            {t("evento.cuenta.mandarCodigo")}
          </Boton>
        </form>
      )}
      {ingreso.pidiendoCodigo && (
        <form
          className="cuenta-correo"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            ingreso.verificar();
          }}
        >
          <Campo
            id="codigo"
            etiqueta={t("evento.cuenta.codigoCampo")}
            ayuda={t("evento.cuenta.codigoAyuda", { correo: ingreso.correoCodigo })}
            error={ingreso.codigoMal ? t("evento.cuenta.error.codigo") : undefined}
            autoComplete="one-time-code"
            inputMode="numeric"
            value={ingreso.codigo}
            onChange={(e) => ingreso.setCodigo(e.target.value)}
            disabled={pollar.auth.step === "verifying_email_code"}
          />
          <div className="fila">
            <Boton type="submit" disabled={!ingreso.codigo.trim() || pollar.auth.step === "verifying_email_code"}>
              {t("evento.cuenta.entrar")}
            </Boton>
            <button type="button" className="enlace" onClick={ingreso.otroCodigo}>
              {t("evento.cuenta.otroCodigo")}
            </button>
          </div>
        </form>
      )}
    </>
  );
}

/**
 * Lo que va en la zona de la acción mientras no se entró: lo que está pasando (siempre a la vista, también en el
 * celular), "Entrar con Google" y "Entrar con mi correo" (o "Volver", con el correo abierto). Con el correo abierto
 * la acción principal es la del correo y Google queda como la otra opción.
 */
export function AccionesIngreso({ ingreso, pollar }: { ingreso: Ingreso; pollar: PollarState }) {
  const t = useT();
  return (
    <>
      <div aria-live="polite" className="cuenta-estado">
        {ingreso.esperaKey && <Aviso>{t(ingreso.esperaKey)}</Aviso>}
        {pollar.loadFailed && <Aviso tono="alerta">{t("evento.cuenta.error.cargar")}</Aviso>}
        {ingreso.errorCode && !ingreso.codigoMal && <Aviso tono="alerta">{t("evento.cuenta.error.entrar")}</Aviso>}
      </div>
      <Boton grande={!ingreso.conElCorreo} variante={ingreso.conElCorreo ? "secundario" : "primario"} disabled={!ingreso.listo || ingreso.enCurso} onClick={ingreso.google}>
        {t("evento.cuenta.google")}
      </Boton>
      {ingreso.conElCorreo ? (
        <Boton variante="secundario" onClick={ingreso.volver}>
          {t("evento.cuenta.volver")}
        </Boton>
      ) : (
        <Boton variante="secundario" disabled={!ingreso.listo} onClick={ingreso.abrirCorreo}>
          {t("evento.cuenta.correo")}
        </Boton>
      )}
    </>
  );
}
