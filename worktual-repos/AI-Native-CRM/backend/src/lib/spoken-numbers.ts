const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
];
const TEENS = [
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

function underHundred(n: number): string {
  if (n < 10) return ONES[n] ?? String(n);
  if (n < 20) return TEENS[n - 10] ?? String(n);
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  if (ones === 0) return TENS[tens] ?? String(n);
  return `${TENS[tens]} ${ONES[ones]}`;
}

export function integerToSpokenWords(n: number): string {
  if (!Number.isFinite(n)) return "";
  const value = Math.trunc(n);
  if (value < 0) return `minus ${integerToSpokenWords(-value)}`;
  if (value < 100) return underHundred(value);
  if (value < 1000) {
    const hundreds = Math.floor(value / 100);
    const rest = value % 100;
    const head = `${ONES[hundreds]} hundred`;
    return rest === 0 ? head : `${head} and ${underHundred(rest)}`;
  }
  if (value < 1_000_000) {
    const thousands = Math.floor(value / 1000);
    const rest = value % 1000;
    const head = `${integerToSpokenWords(thousands)} thousand`;
    if (rest === 0) return head;
    if (rest < 100) return `${head} and ${underHundred(rest)}`;
    return `${head} ${integerToSpokenWords(rest)}`;
  }
  return String(value);
}

/** Replace digit runs so TTS speaks "one hundred eighty eight" instead of "one eight eight". */
export function digitsToSpokenText(text: string): string {
  return text.replace(/(?<![:\d])\b\d+\b(?![:\d])/g, (raw) =>
    integerToSpokenWords(Number(raw)),
  );
}
