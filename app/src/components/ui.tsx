// Los componentes básicos de la app. Sin estado: sirven en el servidor y en el cliente.
// Las clases viven en src/app/globals.css y siguen docs/marca.md.
import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

type Variante = "primario" | "secundario";

function clases(...partes: Array<string | false | undefined | null>): string {
  return partes.filter(Boolean).join(" ");
}

interface BotonBase {
  variante?: Variante;
  grande?: boolean;
  className?: string;
  children: ReactNode;
}

/** Un botón. Por defecto es la acción principal (naranja con tinta encima). */
export function Boton({ variante = "primario", grande, className, children, type = "button", ...rest }: BotonBase & ComponentPropsWithoutRef<"button">) {
  return (
    <button type={type} className={clases("boton", `boton-${variante}`, grande && "boton-grande", className)} {...rest}>
      {children}
    </button>
  );
}

/** Un enlace que se ve como botón. */
export function BotonEnlace({ variante = "primario", grande, className, children, ...rest }: BotonBase & ComponentPropsWithoutRef<typeof Link>) {
  return (
    <Link className={clases("boton", `boton-${variante}`, grande && "boton-grande", className)} {...rest}>
      {children}
    </Link>
  );
}

export function Tarjeta({ children, className, alzada }: { children: ReactNode; className?: string; alzada?: boolean }) {
  return <div className={clases("tarjeta", alzada && "tarjeta-alzada", className)}>{children}</div>;
}

/** Los estados, siempre con palabra y color: pendiente, listo o canjeado, ganado, alerta (no corresponde), neutro. */
export type EstadoChip = "pendiente" | "listo" | "ganado" | "alerta" | "neutro";

export function Chip({ estado = "neutro", children, className }: { estado?: EstadoChip; children: ReactNode; className?: string }) {
  return <span className={clases("chip", `chip-${estado}`, className)}>{children}</span>;
}

interface CampoProps extends Omit<ComponentPropsWithoutRef<"input">, "id"> {
  id: string;
  etiqueta: string;
  ayuda?: string;
  error?: string;
  /** Si se pasa, reemplaza al input (un select o un textarea, por ejemplo). */
  children?: ReactNode;
}

/** Un campo con su etiqueta, su ayuda y su error. El error se anuncia a los lectores de pantalla. */
export function Campo({ id, etiqueta, ayuda, error, children, className, ...inputProps }: CampoProps) {
  const describedBy = clases(ayuda && `${id}-ayuda`, error && `${id}-error`) || undefined;
  return (
    <div className={clases("campo", error && "con-error", className)}>
      <label className="campo-etiqueta" htmlFor={id}>
        {etiqueta}
      </label>
      {children ?? <input id={id} aria-describedby={describedBy} aria-invalid={error ? true : undefined} {...inputProps} />}
      {ayuda && (
        <p className="campo-ayuda" id={`${id}-ayuda`}>
          {ayuda}
        </p>
      )}
      {error && (
        <p className="campo-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface PantallaProps {
  titulo: ReactNode;
  bajada?: ReactNode;
  /** La única acción principal: un Boton o BotonEnlace. Queda a la vista sin hacer scroll. */
  accion?: ReactNode;
  /** Una línea chica debajo de la acción ("Modo de prueba", por ejemplo). */
  nota?: ReactNode;
  ancha?: boolean;
  children?: ReactNode;
}

/** Una pantalla con una sola acción principal. En celular la acción queda pegada abajo. */
export function Pantalla({ titulo, bajada, accion, nota, ancha, children }: PantallaProps) {
  return (
    <section className={clases("pantalla", ancha && "pantalla-ancha")}>
      <header className="pantalla-cabecera">
        <h1>{titulo}</h1>
        {bajada && <p className="bajada">{bajada}</p>}
      </header>
      <div className="pantalla-cuerpo">{children}</div>
      {accion && (
        <div className="pantalla-accion">
          {accion}
          {nota && <p className="nota">{nota}</p>}
        </div>
      )}
    </section>
  );
}

/** Un aviso corto: nota (amarillo), listo (verde) o alerta. */
export function Aviso({ tono = "nota", children, className }: { tono?: "nota" | "listo" | "alerta"; children: ReactNode; className?: string }) {
  return (
    <p className={clases("aviso", tono !== "nota" && `aviso-${tono}`, className)} role={tono === "alerta" ? "alert" : undefined}>
      <span>{children}</span>
    </p>
  );
}
