/** Starts the Node-side MSW server (for SSR / generateMetadata) when API mocking is on. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PUBLIC_API_MOCKING === "enabled") {
    const { server } = await import("./mocks/server");
    server.listen({ onUnhandledRequest: "bypass" });
  }
}
