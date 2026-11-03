// Lo primero que corre el servidor de Next al levantar, una vez por instancia. Si a la base le falta lo que
// necesita (con Postgres: DATABASE_URL y RUMBO_DATA_KEY), la instancia no arranca y el registro dice qué falta,
// en vez de fallar después, en el primer pedido. Durante el build no se comprueba: ahí la base no se usa.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { assertDataConfig } = await import("./server/base/index.ts");
    assertDataConfig();
  }
}
