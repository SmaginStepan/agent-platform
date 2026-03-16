import crypto from "crypto";

export function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function newInviteCode(length = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}