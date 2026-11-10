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
