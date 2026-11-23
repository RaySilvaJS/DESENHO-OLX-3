const fs = require("fs");
const path = require("path");
const configPath = path.join(__dirname, "../config.json");

function getInviteCode(groupLink) {
  let url;

  try {
    url = new URL(groupLink);
  } catch {
    throw new Error("Link de convite do WhatsApp inválido.");
  }

  if (url.protocol !== "https:" || url.hostname !== "chat.whatsapp.com") {
    throw new Error("Use um link de convite do WhatsApp: https://chat.whatsapp.com/...");
  }

  const match = url.pathname.match(/^\/([A-Za-z0-9_-]+)\/?$/);
  if (!match) {
    throw new Error("Link de convite do WhatsApp inválido.");
  }

  return match[1];
}

async function resolveGroupId(conn, groupIdOrLink) {
  if (typeof groupIdOrLink !== "string" || !groupIdOrLink.trim()) {
    throw new Error("O grupo do WhatsApp não foi configurado.");
  }

  const value = groupIdOrLink.trim();
  if (/^[^@\s]+@g\.us$/.test(value)) {
    return value;
  }

  const inviteCode = getInviteCode(value);
  const group = await conn.groupGetInviteInfo(inviteCode);

  if (!group || typeof group.id !== "string" || !group.id.endsWith("@g.us")) {
    throw new Error("Não foi possível obter o ID do grupo pelo link de convite.");
  }

  return group.id;
}

async function ensureGroupJoined(conn, groupIdOrLink) {
  const isInviteLink =
    typeof groupIdOrLink === "string" &&
    groupIdOrLink.trim().startsWith("https://");
  const groupId = await resolveGroupId(conn, groupIdOrLink);
  const participatingGroups = await conn.groupFetchAllParticipating();

  if (participatingGroups[groupId]) {
    return groupId;
  }

  if (!isInviteLink) {
    throw new Error(
      `O bot não está no grupo ${groupId}. Configure o link de convite para permitir a entrada automática.`,
    );
  }

  const inviteCode = getInviteCode(groupIdOrLink.trim());
  const joinedGroupId = await conn.groupAcceptInvite(inviteCode);

  if (joinedGroupId !== groupId) {
    throw new Error(
      "O WhatsApp não confirmou a entrada no grupo. Verifique se o convite ainda é válido e se o grupo não exige aprovação.",
    );
  }

  return groupId;
}

module.exports = { getInviteCode, resolveGroupId, ensureGroupJoined };

/**
 * Resolve e salva o ID de cada grupo configurado em config.json["grupos"].
 * Se o grupo já tem um ID salvo, usa ele direto.
 * Se só tem link, resolve via API do WhatsApp e salva o ID no config.json.
 * Retorna array com os IDs dos grupos.
 */
async function resolverESalvarGrupos(conn) {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const grupos = config.grupos || [];

  if (grupos.length === 0) {
    throw new Error("Nenhum grupo configurado em config.json['grupos'].");
  }

  let alterou = false;

  for (let i = 0; i < grupos.length; i++) {
    const grupo = grupos[i];

    // Já tem ID salvo — só valida o formato
    if (grupo.id && /^[^@\s]+@g\.us$/.test(grupo.id)) {
      continue;
    }

    // Sem ID, resolve pelo link
    if (!grupo.link) {
      console.warn(`Grupo ${i + 1} sem link nem ID configurado. Pulando.`);
      continue;
    }

    try {
      const groupId = await ensureGroupJoined(conn, grupo.link);
      grupos[i].id = groupId;
      alterou = true;
      console.log(`✅ Grupo ${i + 1} resolvido e salvo: ${groupId}`);
    } catch (err) {
      console.error(`❌ Erro ao resolver grupo ${i + 1} (${grupo.link}):`, err.message);
    }
  }

  // Salva o ID no config.json se houve mudança
  if (alterou) {
    config.grupos = grupos;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log("💾 IDs dos grupos salvos no config.json");
  }

  return grupos.map((g) => g.id).filter(Boolean);
}

module.exports = { getInviteCode, resolveGroupId, ensureGroupJoined, resolverESalvarGrupos };
