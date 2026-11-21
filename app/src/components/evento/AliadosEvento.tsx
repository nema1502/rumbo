// Los aliados del evento en la credencial, sobre una tarjeta blanca también en el tema oscuro: así cada logo va en
// su versión para fondo claro, como lo piden las guías de marca, sin recolorear ninguno.
import type { AllyGroup } from "@/server/evento/aliados.ts";

export function AliadosEvento({ grupos, etiqueta }: { grupos: AllyGroup[]; etiqueta: string }) {
  return (
    <section className="aliados-evento" aria-label={etiqueta}>
      {grupos.map((g) => (
        <div key={g.role} className="aliados-grupo">
          <p className="aliados-rol">{g.role}</p>
          <div className="aliados-logos">
            {g.logos.map((l) => (
              // eslint-disable-next-line @next/next/no-img-element -- logos propios y chicos, sin optimizar
              <img key={l.src} src={l.src} alt={l.alt} width={l.width} height={l.height} loading="lazy" decoding="async" />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
