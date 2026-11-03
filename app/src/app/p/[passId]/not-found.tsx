// Cuando el enlace de una credencial no abre: sin clave, con la clave cambiada o con un pase que no existe.
// Se dice lo mismo en los tres casos, para no contar si el pase existe.
import { BotonEnlace, Pantalla } from "@/components/ui.tsx";
import { getT } from "@/i18n/server.ts";

export default async function PassNotFound() {
  const t = await getT();
  return (
    <Pantalla
      titulo={t("evento.credencial.noAbre.titulo")}
      bajada={t("evento.credencial.noAbre.texto")}
      accion={<BotonEnlace href="/">{t("noEncontrado.volver")}</BotonEnlace>}
    />
  );
}
