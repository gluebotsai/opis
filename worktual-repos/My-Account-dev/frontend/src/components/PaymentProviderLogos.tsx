// @ts-nocheck
import stripeLogoUrl from "../assets/payment/stripe-logo.png";
import razorpayLogoUrl from "../assets/payment/razorpay-logo.png";

export function StripeLogo({ className = "" }) {
  return (
    <img
      alt="Stripe"
      className={className}
      decoding="async"
      height={44}
      src={stripeLogoUrl}
      width={140}
    />
  );
}

export function RazorpayLogo({ className = "" }) {
  return (
    <img
      alt="Razorpay"
      className={className}
      decoding="async"
      height={44}
      src={razorpayLogoUrl}
      width={180}
    />
  );
}
