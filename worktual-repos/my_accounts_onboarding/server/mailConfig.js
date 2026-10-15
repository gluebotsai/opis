function env(name) {
  let value = process.env[name]?.trim() || "";

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return value;
}

function normalizeSecret(value) {
  return value.replace(/\s+/g, "");
}

function envSecret(name) {
  return normalizeSecret(env(name));
}

function mailEnv(name, fallback = "", defaultValue = "") {
  return env(name) || env(fallback) || defaultValue;
}

function mailEnvSecret(name, fallback = "") {
  const primary = envSecret(name);
  if (primary) {
    return primary;
  }

  return fallback ? envSecret(fallback) : "";
}

export function normalizeMailProfile(profile) {
  const value = String(profile || "").toLowerCase();
  if (value === "sales_admin") {
    return "sales_admin";
  }
  if (value === "sales") {
    return "sales";
  }
  return "finance";
}

export function getProfileConfig(profile = "finance") {
  const role = normalizeMailProfile(profile);

  if (role === "sales_admin") {
    const smtpHost = mailEnv("SALES_ADMIN_SMTP_HOST", "SALES_SMTP_HOST", "SMTP_HOST");
    const smtpUser = mailEnv("SALES_ADMIN_SMTP_USER", "SALES_SMTP_USER", "SMTP_USER");
    const smtpPass = mailEnvSecret("SALES_ADMIN_SMTP_PASS", "SALES_SMTP_PASS") || envSecret("SMTP_PASS");
    const smtpFrom = mailEnv("SALES_ADMIN_SMTP_FROM", "SALES_SMTP_FROM", "SMTP_FROM") || smtpUser;
    const imapHost = mailEnv("SALES_ADMIN_IMAP_HOST", "SALES_IMAP_HOST", "IMAP_HOST");
    const imapUser = mailEnv("SALES_ADMIN_IMAP_USER", "SALES_IMAP_USER", "IMAP_USER") || smtpUser;
    const imapPass = mailEnvSecret("SALES_ADMIN_IMAP_PASS", "SALES_IMAP_PASS") || envSecret("IMAP_PASS");

    return {
      role,
      smtpHost,
      smtpUser,
      smtpPass,
      smtpFrom,
      smtpPort: Number(mailEnv("SALES_ADMIN_SMTP_PORT", "SALES_SMTP_PORT", "587")),
      smtpSecure: mailEnv("SALES_ADMIN_SMTP_SECURE", "SALES_SMTP_SECURE") === "true",
      imapHost,
      imapUser,
      imapPass,
      imapPort: Number(mailEnv("SALES_ADMIN_IMAP_PORT", "SALES_IMAP_PORT", "993")),
      imapSecure:
        mailEnv("SALES_ADMIN_IMAP_SECURE", "SALES_IMAP_SECURE", "true") !== "false",
      imapInbox: mailEnv("SALES_ADMIN_IMAP_INBOX", "IMAP_INBOX", "INBOX"),
      imapSent: mailEnv("SALES_ADMIN_IMAP_SENT", "SALES_IMAP_SENT", "[Gmail]/Sent Mail"),
      imapSpam: mailEnv("SALES_ADMIN_IMAP_SPAM", "SALES_IMAP_SPAM", "[Gmail]/Spam"),
      hasSmtp() {
        return Boolean(smtpHost && smtpUser && smtpPass);
      },
      hasImap() {
        return Boolean(imapHost && imapUser && imapPass);
      },
    };
  }

  const isSales = role === "sales";
  const prefix = isSales ? "SALES_" : "FINANCE_";

  const smtpHost = mailEnv(`${prefix}SMTP_HOST`, isSales ? "SMTP_HOST" : "FINANCE_SMTP_HOST");
  const smtpUser = mailEnv(`${prefix}SMTP_USER`, isSales ? "SMTP_USER" : "FINANCE_SMTP_USER");
  const smtpPass = mailEnvSecret(`${prefix}SMTP_PASS`, isSales ? "SMTP_PASS" : "FINANCE_SMTP_PASS");
  const smtpFrom =
    mailEnv(`${prefix}SMTP_FROM`, isSales ? "SMTP_FROM" : "FINANCE_SMTP_FROM") || smtpUser;

  const imapHost = mailEnv(`${prefix}IMAP_HOST`, isSales ? "IMAP_HOST" : "FINANCE_IMAP_HOST");
  const imapUser =
    mailEnv(`${prefix}IMAP_USER`, isSales ? "IMAP_USER" : "FINANCE_IMAP_USER") || smtpUser;
  const imapPass = mailEnvSecret(`${prefix}IMAP_PASS`, isSales ? "IMAP_PASS" : "FINANCE_IMAP_PASS");

  return {
    role,
    smtpHost,
    smtpUser,
    smtpPass,
    smtpFrom,
    smtpPort: Number(mailEnv(`${prefix}SMTP_PORT`, isSales ? "SMTP_PORT" : "FINANCE_SMTP_PORT", "587")),
    smtpSecure:
      mailEnv(`${prefix}SMTP_SECURE`, isSales ? "SMTP_SECURE" : "FINANCE_SMTP_SECURE") === "true",
    imapHost,
    imapUser,
    imapPass,
    imapPort: Number(mailEnv(`${prefix}IMAP_PORT`, isSales ? "IMAP_PORT" : "FINANCE_IMAP_PORT", "993")),
    imapSecure:
      mailEnv(`${prefix}IMAP_SECURE`, isSales ? "IMAP_SECURE" : "FINANCE_IMAP_SECURE", "true") !==
      "false",
    imapInbox: mailEnv(`${prefix}IMAP_INBOX`, "IMAP_INBOX", "INBOX"),
    imapSent: mailEnv(
      `${prefix}IMAP_SENT`,
      isSales ? "IMAP_SENT" : "FINANCE_IMAP_SENT",
      "[Gmail]/Sent Mail",
    ),
    imapSpam: mailEnv(
      `${prefix}IMAP_SPAM`,
      isSales ? "IMAP_SPAM" : "FINANCE_IMAP_SPAM",
      "[Gmail]/Spam",
    ),
    hasSmtp() {
      return Boolean(smtpHost && smtpUser && smtpPass);
    },
    hasImap() {
      return Boolean(imapHost && imapUser && imapPass);
    },
  };
}

export function isGmailHost(host) {
  return host.toLowerCase().includes("gmail.com");
}

function getConfigWarnings(profile) {
  const warnings = [];
  const config = getProfileConfig(profile);

  if (profile === "finance" && !env("FINANCE_TEAM_EMAIL")) {
    warnings.push(
      "FINANCE_TEAM_EMAIL is not set in .env. The compose form will not pre-fill the finance recipient.",
    );
  }

  if (config.hasSmtp() && isGmailHost(config.smtpHost) && config.smtpPass.length < 16) {
    const label =
      profile === "sales_admin" ? "SALES_ADMIN" : profile === "sales" ? "SALES" : "FINANCE";
    warnings.push(`${label}_SMTP_PASS looks too short for a Gmail App Password.`);
  }

  if (config.hasImap() && isGmailHost(config.imapHost) && config.imapPass.length < 16) {
    const label =
      profile === "sales_admin" ? "SALES_ADMIN" : profile === "sales" ? "SALES" : "FINANCE";
    warnings.push(`${label}_IMAP_PASS looks too short for a Gmail App Password.`);
  }

  return warnings;
}

function isDevelopment() {
  const nodeEnv = env("NODE_ENV");
  return !nodeEnv || nodeEnv === "development" || nodeEnv === "test";
}

let smtpReachable = {};

export function markSmtpReachable(profile, reachable) {
  smtpReachable[normalizeMailProfile(profile)] = reachable;
}

export function getMailConfigStatus(profile = "finance") {
  const role = normalizeMailProfile(profile);
  const config = getProfileConfig(role);
  const dryRun = env("MAIL_DRY_RUN") === "true";
  const dryRunFallback = !dryRun && isDevelopment() && smtpReachable[role] === false;

  return {
    profile: role,
    smtpConfigured: config.hasSmtp(),
    imapConfigured: config.hasImap(),
    dryRun,
    dryRunFallback,
    smtpReachable: smtpReachable[role] !== false,
    fromAddress: config.smtpFrom,
    mailboxEmail: config.smtpUser,
    financeTeamEmail: env("FINANCE_TEAM_EMAIL"),
    warnings: getConfigWarnings(role),
  };
}

export function isMailDryRun() {
  return env("MAIL_DRY_RUN") === "true";
}

export function isDevelopmentMail() {
  return isDevelopment();
}
