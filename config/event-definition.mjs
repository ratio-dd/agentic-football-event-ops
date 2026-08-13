const GATE_KEYS = [
  "selfServiceTeam",
  "participantHelp",
  "codeIssuance",
  "qualification",
  "scheduleEditing",
  "publicMaintenanceSnapshot",
];

function requiredText(value, path, maximum = 120) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`活动配置缺少 ${path}`);
  if (result.length > maximum) throw new Error(`活动配置 ${path} 最长为 ${maximum} 个字符`);
  return result;
}
function integer(value, path, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`活动配置 ${path} 必须是 ${minimum}–${maximum} 的整数`);
  }
  return value;
}

function httpsUrl(value, path) {
  const result = requiredText(value, path, 500);
  let parsed;
  try { parsed = new URL(result); } catch { throw new Error(`活动配置 ${path} 必须是有效 URL`); }
  if (parsed.protocol !== "https:") throw new Error(`活动配置 ${path} 必须使用 HTTPS`);
  return parsed.toString();
}

export function normaliseEventDefinition(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("活动配置必须是 JSON 对象");
  if (input.schemaVersion !== 1) throw new Error("活动配置 schemaVersion 当前只支持 1");

  const eventId = requiredText(input.id, "id", 80);
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(eventId)) throw new Error("活动配置 id 只能使用小写字母、数字和连字符");

  const minMembers = integer(input.teamPolicy?.minMembers, "teamPolicy.minMembers", 1, 10);
  const maxMembers = integer(input.teamPolicy?.maxMembers, "teamPolicy.maxMembers", 1, 10);
  if (minMembers > maxMembers) throw new Error("活动配置 teamPolicy.minMembers 不能大于 maxMembers");

  const maxTeamsPerGroup = integer(input.tournamentPolicy?.maxTeamsPerGroup, "tournamentPolicy.maxTeamsPerGroup", 2, 16);
  const maxQualifiersPerGroup = integer(input.tournamentPolicy?.maxQualifiersPerGroup, "tournamentPolicy.maxQualifiersPerGroup", 1, maxTeamsPerGroup);
  const defaultQualifiersPerGroup = integer(input.tournamentPolicy?.defaultQualifiersPerGroup, "tournamentPolicy.defaultQualifiersPerGroup", 1, maxQualifiersPerGroup);

  const gates = {};
  for (const key of GATE_KEYS) {
    if (typeof input.defaultGates?.[key] !== "boolean") throw new Error(`活动配置 defaultGates.${key} 必须是布尔值`);
    gates[key] = input.defaultGates[key];
  }

  return Object.freeze({
    schemaVersion: 1,
    id: eventId,
    name: requiredText(input.name, "name"),
    branding: Object.freeze({
      brandName: requiredText(input.branding?.brandName, "branding.brandName", 80),
      locationLabel: requiredText(input.branding?.locationLabel, "branding.locationLabel", 80),
      displayLabel: requiredText(input.branding?.displayLabel, "branding.displayLabel", 120),
      pageTitle: requiredText(input.branding?.pageTitle, "branding.pageTitle", 120),
    }),
    links: Object.freeze({
      workshopUrl: httpsUrl(input.links?.workshopUrl, "links.workshopUrl"),
      gamePortalUrl: httpsUrl(input.links?.gamePortalUrl, "links.gamePortalUrl"),
    }),
    teamPolicy: Object.freeze({
      minMembers,
      maxMembers,
      maxTeams: integer(input.teamPolicy?.maxTeams, "teamPolicy.maxTeams", 1, 256),
    }),
    tournamentPolicy: Object.freeze({
      maxTeamsPerGroup,
      maxGroups: integer(input.tournamentPolicy?.maxGroups, "tournamentPolicy.maxGroups", 1, 26),
      defaultQualifiersPerGroup,
      maxQualifiersPerGroup,
    }),
    defaultGates: Object.freeze(gates),
  });
}
