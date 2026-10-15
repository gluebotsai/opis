import { getActiveUserByEmail, isPasswordHashed, rehashUserPassword, sanitizeUser, verifyUserPassword } from "./users.js";
import {
  createSession,
  getSession,
  invalidateUserSessions,
  revokeSession,
} from "./sessions.js";

export { invalidateUserSessions };
export {
  checkLoginRateLimit,
  recordFailedLoginAttempt,
  getClientIp,
} from "./infra/rateLimit.js";

const MAILBOX_BY_ROLE = {
  sales: "sales",
  finance: "finance",
  sales_admin: "sales_admin",
  // Admin mail uses finance mailbox credentials (no dedicated ADMIN_* mail env).
  admin: "finance",
  customer: "sales",
};

export function resolveMailboxForRole(role) {
  return MAILBOX_BY_ROLE[role] || null;
}

export async function loginUser(email, password) {
  const normalizedEmail = email.trim().toLowerCase();
  const storedUser = await getActiveUserByEmail(normalizedEmail);

  if (storedUser && (await verifyUserPassword(storedUser, password))) {
    if (!isPasswordHashed(storedUser.password)) {
      await rehashUserPassword(storedUser.id, password);
    }

    const session = await createSession({
      email: storedUser.email,
      role: storedUser.role,
      userId: storedUser.id,
      displayName: storedUser.displayName || "",
    });

    return {
      ...session,
      profile: sanitizeUser(storedUser),
    };
  }

  throw new Error("Invalid email or password.");
}

export async function signInAccount(email, password) {
  try {
    const result = await loginUser(email, password);
    return { accountType: "internal", ...result };
  } catch {
    const { loginCustomerUser } = await import("./customerAuth.js");
    try {
      const result = await loginCustomerUser(email, password);
      return { accountType: "customer", ...result };
    } catch {
      throw new Error("Invalid email or password.");
    }
  }
}

export async function logoutUser(token) {
  await revokeSession(token);
}

export { getSession };

async function readAuthSession(request) {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return getSession(token);
}

function readBearerToken(request) {
  const header = request.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export async function requireAuth(request, response, next) {
  try {
    const session = await readAuthSession(request);

    if (!session) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    request.authUser = session;
    next();
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

export async function requireMailAuth(request, response, next) {
  try {
    let session = await readAuthSession(request);

    if (!session) {
      const header = request.headers.authorization || "";
      const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      const { getCustomerSession } = await import("./customerAuth.js");
      const customerSession = await getCustomerSession(token);
      if (customerSession) {
        session = {
          email: customerSession.email,
          role: "customer",
          userId: customerSession.customerUserId,
          displayName: customerSession.displayName || "",
        };
      }
    }

    if (!session) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    const mailboxProfile = resolveMailboxForRole(session.role);
    if (!mailboxProfile) {
      response.status(403).json({ error: "Mail access is not available for this role." });
      return;
    }

    request.authUser = session;
    request.mailboxProfile = mailboxProfile;
    next();
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

export async function requireFinanceAuth(request, response, next) {
  try {
    const session = await readAuthSession(request);

    if (!session || session.role !== "finance") {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    request.financeUser = session;
    request.authUser = session;
    next();
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

export async function requireAdminAuth(request, response, next) {
  try {
    const session = await readAuthSession(request);

    if (!session || session.role !== "admin") {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    request.adminUser = session;
    request.authUser = session;
    next();
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

export async function requireSalesAuth(request, response, next) {
  try {
    const session = await readAuthSession(request);

    if (!session || session.role !== "sales") {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    request.salesUser = session;
    request.authUser = session;
    next();
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

export async function requireSalesAdminAuth(request, response, next) {
  try {
    const session = await readAuthSession(request);

    if (!session || session.role !== "sales_admin") {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    request.salesAdminUser = session;
    request.authUser = session;
    next();
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

export async function requireSalesOversightAuth(request, response, next) {
  try {
    const session = await readAuthSession(request);

    if (!session || (session.role !== "sales_admin" && session.role !== "admin")) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    request.oversightUser = session;
    request.authUser = session;
    next();
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

export async function requireSalesAdminWriteAuth(request, response, next) {
  try {
    const session = await readAuthSession(request);

    if (!session || session.role !== "sales_admin") {
      response.status(403).json({ error: "Sales admin access required." });
      return;
    }

    request.salesAdminUser = session;
    request.authUser = session;
    next();
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

/** Sales agent or sales admin — customer support inbox for their accounts */
export async function requireSalesWorkspaceAuth(request, response, next) {
  try {
    const session = await readAuthSession(request);

    if (!session || (session.role !== "sales" && session.role !== "sales_admin")) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    request.authUser = session;
    next();
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

export function getRequestBearerToken(request) {
  return readBearerToken(request);
}
