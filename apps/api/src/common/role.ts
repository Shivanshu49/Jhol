export type Role = "api" | "worker" | "all";

export function readRole(): Role {
  const role = (process.env.ROLE ?? "all").toLowerCase();
  if (role === "api" || role === "worker" || role === "all") return role;
  throw new Error(`ROLE must be api, worker or all (got "${role}")`);
}
