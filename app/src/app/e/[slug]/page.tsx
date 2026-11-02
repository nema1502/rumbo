// La página pública del evento: la construye el frente del evento. Por ahora, un cartel.
import { Pantalla } from "@/components/ui.tsx";
import { getT } from "@/i18n/server.ts";

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await getT();
  return (
    <Pantalla titulo={t("enConstruccion.titulo")} bajada={t("enConstruccion.texto")}>
      <p className="apagado chico">/e/{slug}</p>
    </Pantalla>
  );
}
