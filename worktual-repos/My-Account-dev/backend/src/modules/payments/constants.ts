export const PAYMENT_STATUSES = {
  PENDING: "pending",
  REPORTED: "reported",
  PARTIAL: "partial",
  PAID: "paid",
  FAILED: "failed",
  REFUNDED: "refunded",
};

export const WELCOME_EMAIL_STATUSES = {
  PENDING: "pending",
  SENT: "sent",
  SENT_WITHOUT_CREDENTIALS: "sent_without_credentials",
  FAILED: "failed",
  NOT_APPLICABLE: "not_applicable",
  UNKNOWN: "unknown",
};

export const FINANCE_ALERT_STATUSES = {
  PENDING: "pending",
  SENT: "sent",
  FAILED: "failed",
};

export const INTERNAL_CREDENTIALS_STATUSES = {
  PENDING: "pending",
  SENT: "sent",
  FAILED: "failed",
  NOT_APPLICABLE: "not_applicable",
};

export const PAYMENT_PROVIDERS = {
  STRIPE: "stripe",
  RAZORPAY: "razorpay",
  MANUAL: "manual",
  BANK_TRANSFER: "bank_transfer",
  OTHER: "other",
};
