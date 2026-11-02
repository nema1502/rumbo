import { BotonEnlace, Pantalla } from "@/components/ui.tsx";
import { getT } from "@/i18n/server.ts";

export default async function NotFound() {
  const t = await getT();
  return (
    <Pantalla
      titulo={t("noEncontrado.titulo")}
      bajada={t("noEncontrado.texto")}
      accion={<BotonEnlace href="/">{t("noEncontrado.volver")}</BotonEnlace>}
    />
  );
}
