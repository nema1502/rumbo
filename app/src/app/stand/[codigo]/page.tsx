// El panel de quien atiende un stand. Se abre con el código del puesto de ese stand (el mismo que abre su
// escáner): /stand/ABCD-EFGH-JKLM. Muestra sus visitas y, de quienes aceptaron compartir su contacto, su nombre y
// su correo para calificarlos, anotarlos y exportarlos. El código de la puerta o de otra mesa no abre nada acá.
import type { Metadata } from "next";
import { headers } from "next/headers";
import { PanelStandCliente } from "@/components/stands/PanelStand.tsx";
import "@/components/stands/stands.css";
import "../../admin/panel.css";
import { BotonEnlace, Pantalla } from "@/components/ui.tsx";
import { getT } from "@/i18n/server.ts";
import { authorizeStandCode, getStandPanel } from "@/server/stands.ts";

export const dynamic = "force-dynamic";

type Params = Promise<{ codigo: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  // Sin referente: el código viaja en la dirección y no tiene que salir con ningún enlace.
  return { title: t("stands.panel.titulo"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function StandPage({ params }: { params: Params }) {
  const { codigo } = await params;
  const t = await getT();
  const auth = await authorizeStandCode(decodeURIComponent(codigo), await headers());
  if (!auth.ok) {
    return (
      <Pantalla
        titulo={t("stands.panel.titulo")}
        bajada={auth.reason === "blocked" ? t("stands.panel.demasiados") : t("stands.panel.codigoMal")}
        accion={
          <BotonEnlace href="/scan" grande>
            {t("stands.panel.volver")}
          </BotonEnlace>
        }
      />
    );
  }
  const panel = await getStandPanel(auth.stand.id);
  return <PanelStandCliente codigo={codigo} initial={panel} />;
}
