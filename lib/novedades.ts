// FishFlow — Novedades por módulo
// ─────────────────────────────────────────────────────────────────────────────
// El changelog que se le muestra al usuario la primera vez que abre un tablero
// después de una mejora. Vive como DATOS, no como pantalla: agregar una entrada
// aquí es todo lo que hace falta para que el aviso salga.
//
// Reglas de la casa:
//  - `version` es la fecha del cambio (YYYY-MM-DD). Es lo que se compara contra
//    lo último que vio el usuario, así que tiene que crecer.
//  - La entrada más reciente va PRIMERO en el arreglo.
//  - Se escribe para el usuario, no para el commit: qué puede hacer ahora, no
//    qué tabla se creó. Si un punto no cambia lo que él puede hacer, no va.

export interface Novedad {
  /** Fecha del cambio, YYYY-MM-DD. Ordena y sirve de llave. */
  version: string;
  titulo: string;
  puntos: string[];
}

/** Llave = slug del módulo que se le pasa al componente <Novedades />. */
export const NOVEDADES: Record<string, Novedad[]> = {
  finanzas: [
    {
      version: "2026-09-15",
      titulo: "Carga tus gastos con una foto",
      puntos: [
        "En la pestaña Captura puedes subir el screenshot de los movimientos del app de tu banco. Leo los cargos, los clasifico y tú confirmas con un tap.",
        "Los pagos a la tarjeta y las devoluciones se omiten solos: no son gastos.",
        "Si dos capturas traen el mismo cargo, no se duplica.",
        "Cada vez que corriges el rubro de un comercio se guarda como regla tuya. La próxima vez ese cargo ya llega bien clasificado.",
      ],
    },
  ],
};

/** La entrada más reciente de un módulo, o null si no hay novedades. */
export function ultimaNovedad(modulo: string): Novedad | null {
  const lista = NOVEDADES[modulo];
  return lista && lista.length > 0 ? lista[0] : null;
}

export function historialNovedades(modulo: string): Novedad[] {
  return (NOVEDADES[modulo] ?? []).slice(1);
}

/** Llave de localStorage. Por módulo, para que un tablero no silencie a otro. */
export function llaveNovedades(modulo: string): string {
  return `ff_novedades_${modulo}`;
}
