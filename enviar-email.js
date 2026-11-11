const nodemailer = require("nodemailer");
const readline = require("readline/promises");
const { stdin, stdout } = require("process");

const emailRemetente = process.env.EMAIL_USER;
const senhaEmail = process.env.EMAIL_APP_PASSWORD;
const hostSmtp = process.env.SMTP_HOST || "smtp.gmail.com";
const portaSmtp = Number(process.env.SMTP_PORT || 465);

function emailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function main() {
  if (!emailRemetente || !senhaEmail) {
    console.error(
      "Configure EMAIL_USER e EMAIL_APP_PASSWORD antes de executar o script."
    );
    process.exitCode = 1;
    return;
  }

  if (!Number.isInteger(portaSmtp) || portaSmtp < 1 || portaSmtp > 65535) {
    console.error("SMTP_PORT deve ser uma porta válida entre 1 e 65535.");
    process.exitCode = 1;
    return;
  }

  const terminal = readline.createInterface({ input: stdin, output: stdout });

  try {
    const destinatario = (await terminal.question("E-mail do destinatário: ")).trim();
    const assunto = (await terminal.question("Assunto: ")).trim();
    const mensagem = await terminal.question("Mensagem: ");

    if (!emailValido(destinatario)) {
      console.error("O endereço de e-mail do destinatário não parece válido.");
      process.exitCode = 1;
      return;
    }

    if (!assunto || !mensagem.trim()) {
      console.error("O assunto e a mensagem não podem ficar vazios.");
      process.exitCode = 1;
      return;
    }

    const confirmacao = (await terminal.question(
      `Enviar este e-mail para ${destinatario}? Digite SIM para confirmar: `
    ))
      .trim()
      .toUpperCase();

    if (confirmacao !== "SIM") {
      console.log("Envio cancelado.");
      return;
    }

    const transporter = nodemailer.createTransport({
      host: hostSmtp,
      port: portaSmtp,
      secure: portaSmtp === 465,
      auth: {
        user: emailRemetente,
        pass: senhaEmail,
      },
    });

    const resultado = await transporter.sendMail({
      from: emailRemetente,
      to: destinatario,
      subject: assunto,
      text: mensagem,
    });

    console.log(`E-mail enviado. Identificador: ${resultado.messageId}`);
  } catch (error) {
    console.error("Falha ao enviar o e-mail:", error.message);
    process.exitCode = 1;
  } finally {
    terminal.close();
  }
}

main();
