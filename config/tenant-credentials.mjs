function objectMap(value, name) {
  if (!value) return {};
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw new Error(`${name} 必须是 JSON 对象`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${name} 必须是 JSON 对象`);
  return parsed;
}

export function loadTenantCredentials(registry, environment = process.env) {
  const staffByTenant = objectMap(environment.TENANT_STAFF_PINS, "TENANT_STAFF_PINS");
  const adminByTenant = objectMap(environment.TENANT_ADMIN_PINS, "TENANT_ADMIN_PINS");
  const configuredTenantIds = new Set(registry.tenants.map((tenant) => tenant.tenantId));
  for (const tenantId of [...Object.keys(staffByTenant), ...Object.keys(adminByTenant)]) {
    if (!configuredTenantIds.has(tenantId)) throw new Error(`凭据配置引用了未知 tenant ${tenantId}`);
  }

  const staffCredentialOwners = new Map(); const adminCredentialOwners = new Map();
  const credentials = new Map(registry.tenants.map((tenant) => {
    const staffPins = staffByTenant[tenant.tenantId]; const adminPin = adminByTenant[tenant.tenantId];
    if (staffPins !== undefined && !Array.isArray(staffPins)) throw new Error(`TENANT_STAFF_PINS.${tenant.tenantId} 必须是数组`);
    if (adminPin !== undefined && typeof adminPin !== "string") throw new Error(`TENANT_ADMIN_PINS.${tenant.tenantId} 必须是字符串`);
    for (const account of staffPins || []) {
      const pin = String(account?.pin ?? "").trim(); if (!pin || account?.enabled === false) continue;
      const owner = staffCredentialOwners.get(pin); if (owner && owner !== tenant.tenantId) throw new Error("不同 tenant 不能复用同一个 Staff PIN");
      staffCredentialOwners.set(pin, tenant.tenantId);
    }
    if (adminPin) {
      const owner = adminCredentialOwners.get(adminPin); if (owner && owner !== tenant.tenantId) throw new Error("不同 tenant 不能复用同一个 Admin PIN");
      adminCredentialOwners.set(adminPin, tenant.tenantId);
    }
    return [tenant.tenantId, Object.freeze({ STAFF_PINS: JSON.stringify(staffPins || []), ADMIN_PIN: adminPin || undefined })];
  }));

  return Object.freeze({
    credentialsFor(tenantId) { return credentials.get(tenantId) || Object.freeze({ STAFF_PINS: "[]", ADMIN_PIN: undefined }); },
  });
}
