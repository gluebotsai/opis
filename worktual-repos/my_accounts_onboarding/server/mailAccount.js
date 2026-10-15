export function getMailAccountFromRequest(request) {
  const session = request.authUser || {};
  const mailboxProfile = request.mailboxProfile;

  if (!mailboxProfile) {
    return null;
  }

  if (session.role === "customer") {
    return {
      accountType: "customer",
      accountId: session.userId,
      mailboxProfile,
    };
  }

  if (!session.userId) {
    return null;
  }

  return {
    accountType: "internal",
    accountId: session.userId,
    mailboxProfile,
  };
}
