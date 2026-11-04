"use client";
// Entrar como organizador: con Google o con el correo por Pollar (lo mismo que la inscripción, IngresoPollar.tsx)
// y después "Entrar al panel", que prueba que la cuenta es de quien entró (el desafío SEP-53 de
// /api/cuenta/desafio, firmado con client.stellar.sep53.signMessage) y abre la sesión en /api/organizador/entrar.
// Con la cookie puesta, la página de /admin se vuelve a pedir y muestra Mis eventos, o vuelve a la página del panel
// de la que venía (volver, ya revisada en el servidor: solo una ruta que empieza con /admin/).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AccionesIngreso, FormulariosCorreo, useIngresoPollar } from "@/components/evento/IngresoPollar.tsx";
import { usePollar } from "@/components/evento/usePollar.ts";
import { Aviso, Boton } from "@/components/ui.tsx";
import { useLang, useT } from "@/i18n/client.tsx";

type Paso = "prueba" | "entrando";

export function EntrarOrganizador({ pollarKey, volver = null }: { pollarKey: string; volver?: string | null }) {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const pollar = usePollar(pollarKey);
  const ingreso = useIngresoPollar(pollar);
  const { client, wallet, profile } = pollar;
  const [paso, setPaso] = useState<Paso | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function entrar() {
    if (!client || !wallet || paso) return;
    setPaso("prueba");
    setError(null);
    const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    let entro = false;
    try {
      const desafio = await post("/api/cuenta/desafio", { publicKey: wallet.address, lang });
      if (desafio.status === 429) return setError(t("panel.cuenta.error.demasiados"));
      if (!desafio.ok) return setError(t("panel.cuenta.error.entrar"));
      const { challengeId, message } = (await desafio.json()) as { challengeId: string; message: string };
      const prueba = await client.stellar.sep53.signMessage(message);
      if (prueba.status !== "signed" || prueba.signerAddress !== wallet.address) {
        console.warn("[pollar] La cuenta no firmó el desafío", prueba.status === "error" ? (prueba.details ?? prueba.code) : "otra cuenta");
        return setError(t("panel.cuenta.error.prueba"));
      }
      setPaso("entrando");
      const sesion = await post("/api/organizador/entrar", {
        wallet: { provider: "pollar", publicKey: wallet.address, challengeId, signature: prueba.signature },
        name: profile?.name ?? "",
        lang,
      });
      if (sesion.status === 429) return setError(t("panel.cuenta.error.demasiados"));
      if (sesion.status === 503) return setError(t("panel.cuenta.sinPollar"));
      if (!sesion.ok) return setError(t("panel.cuenta.error.entrar"));
      // La cookie ya está: de vuelta al panel del que venía, o la página se vuelve a pedir y muestra Mis eventos.
      entro = true;
      if (volver) router.replace(volver);
      else router.refresh();
    } catch (err) {
      console.warn("[pollar] No se pudo entrar como organizador", err);
      setError(t("panel.cuenta.error.entrar"));
    } finally {
      // Si salió bien, el paso se queda a la vista hasta que la página cambie; si no, el botón vuelve.
      if (!entro) setPaso(null);
    }
  }

  async function otraCuenta() {
    if (!client) return;
    setError(null);
    ingreso.reiniciar();
    await client.logout().catch(() => undefined);
  }

  const quien = profile?.email || "";
  return (
    <section className="pantalla form-inscripcion cuenta-organizador">
      <header className="pantalla-cabecera">
        <h1>{t("panel.cuenta.titulo")}</h1>
        <p className="bajada">{volver ? t("panel.cuenta.bajadaVolver") : t("panel.cuenta.bajada")}</p>
      </header>
      <div className="pantalla-cuerpo">
        {wallet ? (
          <Aviso tono="listo" className="cuenta-entro">
            <span>{quien ? t("panel.cuenta.entraste", { correo: quien }) : t("panel.cuenta.entrasteSinCorreo")}</span>
            <button type="button" className="enlace" onClick={otraCuenta} disabled={paso !== null}>
              {t("panel.cuenta.otraCuenta")}
            </button>
          </Aviso>
        ) : (
          <>
            <FormulariosCorreo ingreso={ingreso} pollar={pollar} />
            {/* Sin cuenta todavía, los botones van pegados al título: abajo, solos, dejaban un hueco en la pantalla. */}
            <div className="cuenta-acciones">
              <AccionesIngreso ingreso={ingreso} pollar={pollar} />
            </div>
          </>
        )}
      </div>
      <div className="pantalla-accion">
        {wallet ? (
          <>
            <div aria-live="polite" className="cuenta-estado">
              {paso ? <Aviso>{t(`panel.cuenta.paso.${paso}`)}</Aviso> : error ? <Aviso tono="alerta">{error}</Aviso> : null}
            </div>
            <Boton grande onClick={entrar} disabled={paso !== null} aria-busy={paso !== null || undefined}>
              {t("panel.cuenta.entrar")}
            </Boton>
          </>
        ) : null}
        <p className="nota">{t("panel.cuenta.custodia")}</p>
      </div>
    </section>
  );
}
