"use client";
// Pollar en el navegador: entrar con Google o con el correo (un código de un solo uso), y la cuenta de Stellar que
// Pollar crea y custodia. Un solo PollarClient por página y por clave (el SDK lo pide: dos instancias se pisan la
// sesión), cargado recién en el navegador para que el servidor no lo evalúe. La clave publicable llega del servidor.
import { useEffect, useState } from "react";
import type { AuthState, PollarClient, PollarUserProfile, WalletInfo, WalletProvisioning } from "@pollar/core";

let shared: { apiKey: string; client: Promise<PollarClient> } | null = null;

/** El cliente de Pollar de esta pestaña. Google vuelve a la raíz de la app, que es lo que tiene permitido la app de Pollar. */
export function loadPollar(apiKey: string): Promise<PollarClient> {
  // Las capturas (scripts/capturas-pollar.mjs) ponen acá un cliente de mentira para mostrar cada estado sin
  // entrar con Google. Solo en desarrollo: en el bundle de producción esta rama no existe.
  if (process.env.NODE_ENV !== "production") {
    const falso = (window as { __rumboPollarFalso?: PollarClient }).__rumboPollarFalso;
    if (falso) return Promise.resolve(falso);
  }
  if (shared?.apiKey === apiKey) return shared.client;
  const client = import("@pollar/core").then(
    ({ PollarClient: Client }) => new Client({ apiKey, stellarNetwork: "testnet", oauthRedirectUri: `${window.location.origin}/`, deviceLabel: "Rumbo" }),
  );
  shared = { apiKey, client };
  // Si no cargó (sin conexión), el próximo intento vuelve a probar.
  client.catch(() => {
    if (shared?.client === client) shared = null;
  });
  return client;
}

export interface PollarState {
  client: PollarClient | null;
  /** El cliente cargó y retomó la sesión guardada, si había. */
  ready: boolean;
  /** No se pudo cargar el SDK. */
  loadFailed: boolean;
  auth: AuthState;
  /** La cuenta de Stellar de quien entró, o null. */
  wallet: WalletInfo | null;
  /** Si Pollar ya creó la cuenta en la red: CREATING mientras tanto. Null si todavía no lo dijo. */
  provisioning: WalletProvisioning | null;
  /** El nombre y el correo de quien entró. Pollar los tiene solo en memoria: al recargar la página no vuelven. */
  profile: { name: string; email: string } | null;
}

function profileOf(raw: PollarUserProfile | null): { name: string; email: string } | null {
  if (!raw) return null;
  const name = [raw.first_name, raw.last_name].filter(Boolean).join(" ").trim();
  const email = raw.mail || raw.providers?.email?.address || "";
  return name || email ? { name, email } : null;
}

export function usePollar(apiKey: string | null): PollarState {
  const [client, setClient] = useState<PollarClient | null>(null);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [auth, setAuth] = useState<AuthState>({ step: "idle" });
  const [provisioning, setProvisioning] = useState<WalletProvisioning | null>(null);

  useEffect(() => {
    if (!apiKey) return;
    let alive = true;
    const off: Array<() => void> = [];
    loadPollar(apiKey)
      .then(async (c) => {
        if (!alive) return;
        setClient(c);
        // Los dos repiten el estado de ahora al suscribirse.
        off.push(c.onAuthStateChange((state) => alive && setAuth(state)));
        off.push(c.onWalletStateChange((state) => alive && setProvisioning(state)));
        await c.ready();
        if (!alive) return;
        setAuth(c.getAuthState());
        setReady(true);
      })
      .catch((error: unknown) => {
        console.warn("[pollar] No se pudo cargar el ingreso", error);
        if (alive) setLoadFailed(true);
      });
    return () => {
      alive = false;
      for (const stop of off) stop();
    };
  }, [apiKey]);

  const wallet = client && auth.step === "authenticated" ? client.getWallet() : null;
  return {
    client,
    ready,
    loadFailed,
    auth,
    wallet: wallet?.address ? wallet : null,
    provisioning: provisioning ?? wallet?.provisioning ?? null,
    profile: client && auth.step === "authenticated" ? profileOf(client.getUserProfile()) : null,
  };
}
