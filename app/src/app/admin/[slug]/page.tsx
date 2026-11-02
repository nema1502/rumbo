// El panel de quien organiza: lo construye el frente del panel. Por ahora, un cartel.
import { Pantalla } from "@/components/ui.tsx";
import { getT } from "@/i18n/server.ts";

export default async function AdminPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await getT();
  return (
    <Pantalla titulo={t("enConstruccion.titulo")} bajada={t("enConstruccion.texto")}>
      <p className="apagado chico">/admin/{slug}</p>
    </Pantalla>
  );
}
