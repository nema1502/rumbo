// El escáner del voluntario: una página instalable, con cola local, que funciona sin red una vez
// que se abrió el puesto con conexión. Todo lo que hace está en src/components/escaner.
import type { Metadata } from "next";
import { Escaner } from "@/components/escaner/Escaner.tsx";
import { getT } from "@/i18n/server.ts";
import "./scan.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("inicio.escaner"),
    manifest: "/scan/manifest.webmanifest",
    appleWebApp: { capable: true, title: "Rumbo", statusBarStyle: "default" },
  };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Con ?demo=1 aparece el interruptor para simular que se va la conexión: sirve para mostrar el escáner y
 * para probarlo. En la fila no está, para que un voluntario no lo active sin querer y deje de sincronizar.
 */
export default async function ScanPage({ searchParams }: Props) {
  const { demo } = await searchParams;
  return <Escaner demo={demo === "1"} />;
}
