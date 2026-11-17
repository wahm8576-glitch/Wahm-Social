/** Boot hook (Node runtime only): see instrumentation-node.ts. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const m = await import("./instrumentation-node");
    await m.boot();
  }
}
