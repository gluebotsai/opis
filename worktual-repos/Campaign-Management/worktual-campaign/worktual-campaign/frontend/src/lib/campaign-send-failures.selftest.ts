import { sendFailureRemedy } from "@/lib/campaign-send-failures";

if (
  !sendFailureRemedy("email_mailbox_not_ready: No My Accounts")?.includes(
    "Setup",
  )
) {
  throw new Error("mailbox remedy expected");
}
if (
  !sendFailureRemedy("email_images_not_public")?.includes("public media")
) {
  throw new Error("images remedy expected");
}
console.log("campaign-send-failures.selftest: ok");
