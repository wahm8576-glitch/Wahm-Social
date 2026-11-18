export type StrengthScore = 0 | 1 | 2 | 3 | 4;

export function passwordStrength(pw: string): { score: StrengthScore; hints: string[] } {
  const hints: string[] = [];
  if (pw.length < 8) hints.push("min8");
  else if (pw.length < 12) hints.push("longer");
  if (pw.length >= 8 && !(/[a-z]/.test(pw) && /[A-Z]/.test(pw))) hints.push("mixedCase");
  if (pw.length >= 8 && !/\d/.test(pw)) hints.push("number");
  if (pw.length >= 8 && !/[^A-Za-z0-9]/.test(pw)) hints.push("symbol");

  let score = 0 as number;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length > 0 && score < 1) score = 1;
  if (pw.length < 8) score = Math.min(score, 1);
  return { score: Math.max(0, Math.min(4, score)) as StrengthScore, hints };
}
