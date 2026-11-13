const fs = require("fs");
const path = require("path");

const caminhoArquivo = path.join(__dirname, "../../data/compradores.json");

function carregarHistorico() {
  try {
    return JSON.parse(fs.readFileSync(caminhoArquivo, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function salvarHistorico(historico) {
  fs.mkdirSync(path.dirname(caminhoArquivo), { recursive: true });
  fs.writeFileSync(caminhoArquivo, JSON.stringify(historico, null, 2));
}

function normalizarNome(nome) {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function formatarNome(nome) {
  return nome
    .trim()
    .split(/\s+/)
    .map((palavra) => palavra.toLocaleLowerCase("pt-BR"))
    .map((palavra) => palavra.charAt(0).toLocaleUpperCase("pt-BR") + palavra.slice(1))
    .join(" ");
}

function dataNascimentoValida(data) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(data)) return false;

  const [dia, mes, ano] = data.split("/").map(Number);
  const nascimento = new Date(ano, mes - 1, dia);
  if (
    nascimento.getFullYear() !== ano ||
    nascimento.getMonth() !== mes - 1 ||
    nascimento.getDate() !== dia
  ) {
    return false;
  }

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return nascimento <= hoje;
}

function listarCompradores(userId) {
  const historico = carregarHistorico();
  return (historico[userId] || []).slice().sort((a, b) => {
    const diferenca = new Date(b.ultimoUso) - new Date(a.ultimoUso);
    return diferenca || a.nome.localeCompare(b.nome, "pt-BR");
  });
}

function salvarComprador(userId, nome, dataNascimento) {
  const historico = carregarHistorico();
  const compradores = historico[userId] || [];
  const nomeFormatado = formatarNome(nome);
  const nomeNormalizado = normalizarNome(nomeFormatado);
  const existente = compradores.find(
    (comprador) => normalizarNome(comprador.nome) === nomeNormalizado,
  );
  const registro = {
    nome: nomeFormatado,
    dataNascimento,
    ultimoUso: new Date().toISOString(),
  };

  if (existente) {
    Object.assign(existente, registro);
  } else {
    compradores.push(registro);
  }

  historico[userId] = compradores;
  salvarHistorico(historico);
  return registro;
}

function apagarComprador(userId, indice) {
  const historico = carregarHistorico();
  const compradores = (historico[userId] || []).slice().sort((a, b) => {
    const diferenca = new Date(b.ultimoUso) - new Date(a.ultimoUso);
    return diferenca || a.nome.localeCompare(b.nome, "pt-BR");
  });
  if (indice < 0 || indice >= compradores.length) return null;

  const comprador = compradores[indice];
  historico[userId] = (historico[userId] || []).filter(
    (item) => item !== comprador,
  );
  if (historico[userId].length === 0) delete historico[userId];
  salvarHistorico(historico);
  return comprador;
}

module.exports = {
  apagarComprador,
  dataNascimentoValida,
  formatarNome,
  listarCompradores,
  salvarComprador,
};
