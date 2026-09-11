import { env } from "@getficksd/env/server";
import nodemailer, { type SendMailOptions, type Transporter } from "nodemailer";

let transport: Transporter | undefined;

function getTransport() {
  const auth = env.SMTP_USER
    ? {
        user: env.SMTP_USER,
        pass: env.SMTP_PASSWORD,
      }
    : undefined;

  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number.parseInt(env.SMTP_PORT, 10),
    secure: env.SMTP_SECURE === "true",
    auth,
  });

  return transport;
}

export type MailMessage = Omit<SendMailOptions, "from"> & {
  from?: SendMailOptions["from"];
};

export function sendMail(message: MailMessage) {
  return getTransport().sendMail({
    from: message.from ?? env.SMTP_FROM,
    ...message,
  });
}

export function verifySmtpConnection() {
  return getTransport().verify();
}
