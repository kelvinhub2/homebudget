/**
 * api.js — All backend calls in one place
 * Set USE_MOCK = false when backend is live
 * Set API_BASE to your backend URL
 */

const USE_MOCK = false;
const API_BASE = "";  // empty = same origin (served from FastAPI)
const CREDENTIALS = btoa(`admin:${localStorage.getItem("budget_pw") || ""}`);

async function request(method, path, body) {
  const pw = localStorage.getItem("budget_pw") || "";
  const headers = {
    "Authorization": `Basic ${btoa(`admin:${pw}`)}`,
    "Content-Type": "application/json",
  };
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    localStorage.removeItem("budget_pw");
    window.location.reload();
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return res.json();
}

export const get  = (path)        => request("GET",    path);
const post = (path, body)  => request("POST",   path, body);
const patch= (path, body)  => request("PATCH",  path, body);
const del  = (path, body)  => request("DELETE", path, body);

// ── Dashboard ──────────────────────────────────────────────────────────────
export const getDashboard = (month) =>
  get(`/api/dashboard${month ? `?month=${month}` : ""}`);

// ── Transactions ───────────────────────────────────────────────────────────
export const getTransactions = (params = {}) => {
  const q = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([,v]) => v !== undefined && v !== null && v !== ""))
  ).toString();
  return get(`/api/transactions${q ? `?${q}` : ""}`);
};

export const updateTransaction = (id, body) => patch(`/api/transactions/${id}`, body);

// ── Review ─────────────────────────────────────────────────────────────────
export const getUnclassified  = ()       => get("/api/review");
export const suggestCategory  = (id)     => get(`/api/review/${id}/suggest`);
export const approveTransaction = (id, body) => post(`/api/review/${id}/approve`, body);

// ── Rules ──────────────────────────────────────────────────────────────────
export const getRules        = ()        => get("/api/rules");
export const createRule      = (body)    => post("/api/rules", body);
export const updateRule      = (id, body)=> patch(`/api/rules/${id}`, body);
export const deleteRule      = (id)      => del(`/api/rules/${id}`);
export const testRule        = (text)    => get(`/api/rules/test?text=${encodeURIComponent(text)}`);
export const recategorize    = ()        => post("/api/rules/recategorize");

// ── Taxonomy ───────────────────────────────────────────────────────────────
export const migrateInternal   = (l2)     => post("/api/maintenance/migrate-internal", { l2 });
export const getTaxonomy       = ()       => get("/api/taxonomy");
export const getTaxonomyCounts = ()       => get("/api/taxonomy/counts");
export const addTaxonomy       = (body)   => post("/api/taxonomy", body);
export const renameTaxonomy    = (body)   => patch("/api/taxonomy/rename", body);
export const deleteTaxonomy    = (body)   => del("/api/taxonomy", body);
export const deleteTaxonomyL1  = (body)   => del("/api/taxonomy/l1", body);

// ── Accounts ───────────────────────────────────────────────────────────────
export const getAccounts     = ()        => get("/api/accounts");

// ── Imports ────────────────────────────────────────────────────────────────
export const getImports      = ()        => get("/api/imports");
export const scanHotfolder   = ()        => post("/api/import/scan");
export const uploadFile      = (file, accountId) => {
  const pw  = localStorage.getItem("budget_pw") || "";
  const fd  = new FormData();
  fd.append("file", file);
  if (accountId) fd.append("account_id", accountId);
  return fetch(`${API_BASE}/api/import/upload`, {
    method: "POST",
    headers: { "Authorization": `Basic ${btoa(`admin:${pw}`)}` },
    body: fd,
  }).then(r => r.json());
};

// ── Excel export ───────────────────────────────────────────────────────────
export const downloadExcel = (year, month) => {
  const pw  = localStorage.getItem("budget_pw") || "";
  let q;
  if (month) {
    q = `month=${month}`;
  } else if (year) {
    q = `year=${year}`;
  } else {
    q = `year=all`;
  }
  window.open(`${API_BASE}/api/export/excel?${q}&_auth=${btoa(`admin:${pw}`)}`);
};

// ── Analysis ───────────────────────────────────────────────────────────────
export const getBreakdown = (year) => {
  const q = year ? `?year=${year}` : "?year=all";
  return get(`/api/analysis/breakdown${q}`);
};
