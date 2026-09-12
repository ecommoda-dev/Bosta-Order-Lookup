// Bosta Lookup Worker
// skills: worker-builder v1.0.0 · constants v1.2.0 · shopify-graphql-helper v1.0.0 — 26-08-2026
// GET  /?order=35514  → Lookup delivery from Bosta
// POST /sync          → Sync 4 metafields to Shopify order
//
// Secrets required:
//   BOSTA_API_KEY
//   SHOP_DOMAIN
//   CLIENT_ID
//   CLIENT_SECRET

const BOSTA_API_BASE = "https://app.bosta.co/api/v2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/sync") return handleSync(request, env);
    if (request.method === "GET") return handleLookup(request, env);
    return json({ error: "Method not allowed" }, 405);
  },
};

// ── Lookup ────────────────────────────────────────────────────────────────────

async function handleLookup(request, env) {
  const url = new URL(request.url);
  const orderNumber = url.searchParams.get("order");
  if (!orderNumber) return json({ error: "Missing ?order= parameter" }, 400);

  try {
    const res = await fetch(`${BOSTA_API_BASE}/deliveries/search`, {
      method: "POST",
      headers: { Authorization: env.BOSTA_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ businessReference: orderNumber }),
    });
    const data = await res.json();
    if (!res.ok) return json({ error: `Bosta API error: ${res.status}`, details: data }, res.status);
    return json({ success: true, raw: data }, 200);
  } catch (err) {
    return json({ error: "Worker error", details: err.message }, 500);
  }
}

// ── Sync ──────────────────────────────────────────────────────────────────────

async function handleSync(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const { orderNumber, delivery } = body;
  if (!orderNumber || !delivery) return json({ error: "Missing orderNumber or delivery" }, 400);

  let accessToken;
  try { accessToken = await getAccessToken(env); }
  catch (err) { return json({ error: `Token error: ${err.message}` }, 500); }

  let orderId;
  try { orderId = await getOrderId(env, accessToken, orderNumber); }
  catch (err) { return json({ error: `Order lookup error: ${err.message}` }, 500); }

  if (!orderId) return json({ error: `Order not found: ${orderNumber}` }, 404);

  const stateLabel = getStateLabel(delivery.state?.code, delivery.state?.value);

  const metafields = [
    { key: "bosta_tracking_number",    value: String(delivery.trackingNumber || ""),               type: "number_integer"         },
    { key: "bosta_webhook",            value: stateLabel,                                          type: "single_line_text_field" },
    { key: "bosta_order_type",         value: String(delivery.type?.value || delivery.type || ""), type: "single_line_text_field" },
    { key: "bosta_number_of_attempts", value: String(delivery.numberOfAttempts ?? delivery.noOfAttempts ?? 0), type: "number_integer" },
  ].map(m => ({ ...m, ownerId: orderId, namespace: "custom" }));

  let errors;
  try { errors = await setMetafields(env, accessToken, metafields); }
  catch (err) { return json({ error: `Metafield write error: ${err.message}` }, 500); }

  if (errors?.length > 0) return json({ error: "Metafield errors", details: errors }, 500);

  return json({
    success: true,
    orderId,
    synced: {
      trackingNumber: String(delivery.trackingNumber || ""),
      state:          stateLabel,
      orderType:      String(delivery.type?.value || delivery.type || ""),
      attempts:       String(delivery.numberOfAttempts ?? delivery.noOfAttempts ?? 0),
    },
  });
}

// ── Shopify Helpers ───────────────────────────────────────────────────────────

async function getAccessToken(env) {
  const resp = await fetch(`https://${env.SHOP_DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET, grant_type: "client_credentials" }),
  });
  if (!resp.ok) throw new Error(`OAuth failed: ${resp.status}`);
  const data = await resp.json();
  return data.access_token;
}

async function getOrderId(env, accessToken, orderNumber) {
  const name = orderNumber.replace(/^#/, "").trim();
  const query = `query getOrderByName($query: String!) { orders(first: 1, query: $query) { edges { node { id } } } }`;
  const resp = await fetch(`https://${env.SHOP_DOMAIN}/admin/api/2026-01/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
    body: JSON.stringify({ query, variables: { query: `name:#${name}` } }),
  });
  const data = await resp.json();
  return data?.data?.orders?.edges?.[0]?.node?.id || null;
}

async function setMetafields(env, accessToken, metafields) {
  const mutation = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { key value }
        userErrors { field message }
      }
    }
  `;
  const resp = await fetch(`https://${env.SHOP_DOMAIN}/admin/api/2026-01/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
    body: JSON.stringify({ query: mutation, variables: { metafields } }),
  });
  const data = await resp.json();
  return data?.data?.metafieldsSet?.userErrors || [];
}

// ── State Code → Label ────────────────────────────────────────────────────────

function getStateLabel(code, fallback) {
  const STATE_MAP = {
    10:  "Pickup requested",
    11:  "Waiting for route",
    20:  "Route Assigned",
    21:  "Picked up from business",
    22:  "Picking up from consignee",
    23:  "Picked up from consignee",
    24:  "Received at warehouse",
    25:  "Fulfilled",
    30:  "In transit between Hubs",
    40:  "Picking up",
    41:  "Picked up",
    45:  "Delivered",
    46:  "Returned to business",
    47:  "Exception",
    48:  "Terminated",
    49:  "Canceled",
    100: "Lost",
  };
  return STATE_MAP[code] || fallback || "";
}

// ── Helper ────────────────────────────────────────────────────────────────────

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
