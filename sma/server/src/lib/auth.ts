import { createClerkClient } from "@clerk/backend";

export type AuthContext = {
  userId: string;
};

let cachedClient: ReturnType<typeof createClerkClient> | null = null;

function clerk() {
  if (cachedClient) return cachedClient;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY não configurada em sma/.env");
  }
  cachedClient = createClerkClient({
    secretKey,
    publishableKey: process.env.VITE_CLERK_PUBLISHABLE_KEY,
  });
  return cachedClient;
}

/**
 * Verifica o JWT do Clerk no header `Authorization: Bearer ...` ou no cookie
 * de sessão. Retorna null se não autenticado.
 *
 * Em Fase 1 (sem restrição de domínio), qualquer Clerk user válido =
 * membro do time = acesso total. RBAC granular é Fase 5.
 */
export async function authenticate(req: Request): Promise<AuthContext | null> {
  try {
    const requestState = await clerk().authenticateRequest(req);
    if (!requestState.isSignedIn) return null;
    const auth = requestState.toAuth();
    if (!auth?.userId) return null;
    return { userId: auth.userId };
  } catch {
    return null;
  }
}
