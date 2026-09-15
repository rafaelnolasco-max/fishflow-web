// FishFlow — Novedades por módulo
// ─────────────────────────────────────────────────────────────────────────────
// El changelog que se le muestra al usuario la primera vez que abre un tablero
// después de una mejora. Vive como DATOS, no como pantalla: agregar una entrada
// aquí es todo lo que hace falta para que el aviso salga.
//
// Reglas de la casa:
//  - `version` es la fecha del cambio (YYYY-MM-DD). Es lo que se compara contra
//    lo último que vio el usuario, así que tiene que cambiar. La comparación es
//    por igualdad, no por orden: si hay dos entregas el mismo día, súfijala
//    ("2026-09-15.2") y el aviso vuelve a salir.
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
      version: "2026-09-15.3",
      titulo: "Carga tus gastos con una foto",
      puntos: [
        "En la pestaña Captura puedes subir los screenshots de los movimientos del app de tu banco. Leo los cargos, los clasifico y tú confirmas con un tap.",
        "Puedes elegir VARIAS capturas de una vez, hasta 8. Se leen una tras otra y todas caen en la misma lista para que revises y guardes una sola vez.",
        "Los pagos a la tarjeta y las devoluciones se omiten solos: no son gastos.",
        "Si dos capturas traen el mismo cargo, no se duplica.",
        "Cada vez que corriges el rubro de un comercio se guarda como regla tuya. La próxima vez ese cargo ya llega bien clasificado.",
        "Los cargos hechos con una tarjeta adicional llegan marcados con el nombre de quien los hizo. No se descartan solos —los pagas tú— pero hay un botón para sacarlos todos de un tap si así lo decides.",
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
