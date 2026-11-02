// El escáner del voluntario: lo construye el frente del escáner. Por ahora, un cartel.
import { Pantalla } from "@/components/ui.tsx";
import { getT } from "@/i18n/server.ts";

export default async function ScanPage() {
  const t = await getT();
  return (
    <Pantalla titulo={t("enConstruccion.titulo")} bajada={t("enConstruccion.texto")}>
      <p className="apagado chico">/scan</p>
    </Pantalla>
  );
}
