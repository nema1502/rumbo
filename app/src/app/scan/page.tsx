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

export default function ScanPage() {
  return <Escaner />;
}
