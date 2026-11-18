/* LocCompare — version Artifact. Le moteur (schéma, adaptateurs, prompt, calcul) vient de LocCore (artifact/core.ts). */
(function () {
  "use strict";
  const C = window.LocCore;
  const EXAMPLE = window.LOC_EXAMPLE || null;
  const MAX_PAGE_CHARS = 60000;
  const LS_KEY = "loccompare.artifact.v1";

  // ---------- état ----------
  const state = {
    listings: [],
    settings: clone(C.DEFAULT_SETTINGS),
    editing: null, // { listing, isNew, warnings, selected: number[] }
    tab: "texte",
    busy: false,
    error: null,
    sort: { key: "cout", dir: 1 },
    storage: "local", // "local" | "db"
    claude: "pending", // "pending" | "ok" | "absent" | "denied"
    confirmDelete: false,
  };
  let sample = null, db = null, stateDoc = null, downloads = null;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
  const eur = (n, dec) => (n == null || !isFinite(n) ? "—" : (dec ? nf2 : nf0).format(n) + " €");
  const money = (n, estimated, dec) =>
    estimated ? `<span class="num est" title="Montant estimé (non lu dans l'annonce)">${eur(n, dec)}<span class="est-tag">≈ estimé</span></span>` : `<span class="num">${eur(n, dec)}</span>`;
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2));
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (t.hidden = true), 2600);
  }

  // ---------- stockage : db privé (data/users/<id>/state) sinon navigateur ----------
  function reviveListing(l) {
    if (!l || !l.id) return null;
    return {
      id: l.id,
      createdAt: l.createdAt || new Date().toISOString(),
      updatedAt: l.updatedAt || new Date().toISOString(),
      data: C.ListingDataSchema.parse(l.data || {}),
      editedFields: Array.isArray(l.editedFields) ? l.editedFields : [],
      aplMensuelle: typeof l.aplMensuelle === "number" ? l.aplMensuelle : null,
      extraction: l.extraction || { method: "manuel", adapter: null, llm: false, fetchedAt: null },
      commentaire: l.commentaire || "",
    };
  }
  function applyStored(obj) {
    if (!obj) return;
    state.listings = (obj.listings || []).map(reviveListing).filter(Boolean);
    const s = obj.settings || {};
    state.settings = { ...clone(C.DEFAULT_SETTINGS), ...s, estimations: { ...C.DEFAULT_SETTINGS.estimations, ...(s.estimations || {}) } };
  }
  function snapshot() { return { v: 1, listings: state.listings, settings: state.settings }; }
  function loadLocal() {
    try { const raw = localStorage.getItem(LS_KEY); if (raw) applyStored(JSON.parse(raw)); } catch (e) { /* stockage indisponible */ }
  }
  let saveTimer = null, saving = false, pending = false;
  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(snapshot())); } catch (e) { /* ignoré */ }
    if (!stateDoc) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 700);
  }
  async function flush() {
    if (saving) { pending = true; return; }
    saving = true;
    try { await stateDoc.set(snapshot()); }
    catch (e) { state.storage = "local"; renderStatus(); toast("Sauvegarde distante impossible : annonces gardées dans ce navigateur."); stateDoc = null; }
    saving = false;
    if (pending) { pending = false; flush(); }
  }

  async function initCapabilities() {
    const claude = window.claude;
    if (!claude || !claude.use) { state.claude = "absent"; renderStatus(); renderAdd(); return; }
    const [s, d, u, dl] = await Promise.all([claude.use("sample"), claude.use("db"), claude.use("user"), claude.use("downloads")]);
    sample = s; downloads = dl;
    state.claude = s ? "ok" : "absent";
    if (d && u) {
      try {
        const id = await u.id();
        if (id) {
          db = d;
          stateDoc = db.doc("data/users/" + id + "/state");
          let done = false;
          const timer = setTimeout(() => { if (!done) { stateDoc = null; renderStatus(); } }, 10000);
          const snap = await stateDoc.get();
          done = true;
          clearTimeout(timer);
          const remote = snap && snap.data && snap.data();
          if (remote && remote.listings) applyStored(remote);
          else if (state.listings.length) await stateDoc.set(snapshot()); // migre ce qui était dans le navigateur
          state.storage = "db";
        }
      } catch (e) { stateDoc = null; }
    }
    renderAll();
  }

  // ---------- extraction par Claude ----------
  async function analyze(text, url) {
    state.busy = true; state.error = null; renderAdd();
    try {
      const fakePage = { url: url || "", finalUrl: url || "", title: "", text };
      const adapter = C.pickAdapter(url || "about:blank");
      const ad = adapter.extract(fakePage, { jsonLd: [], meta: {}, nextData: null });
      if (!url) { delete ad.data.url; delete ad.data.source; }
      const warnings = [];
      let llmData = null;
      if (sample) {
        let pageText = text;
        if (pageText.length > MAX_PAGE_CHARS) {
          warnings.push(`Texte très long : seuls les ${MAX_PAGE_CHARS} premiers caractères ont été analysés.`);
          pageText = pageText.slice(0, MAX_PAGE_CHARS);
        }
        const prompt = C.SYSTEM_PROMPT + "\n\n" + C.buildUserPrompt({ url: url || null, pageText, preExtracted: ad.data });
        let raw;
        try {
          const r = await sample(prompt, { modelTier: "default", cache: true, onText: () => {} });
          raw = C.parseJsonObject(r.text);
        } catch (e) {
          if (e && e.code) throw e;
          const r2 = await sample(prompt + "\n\nTa réponse précédente n'était pas un JSON valide. Réponds uniquement par l'objet JSON.", { modelTier: "default" });
          raw = C.parseJsonObject(r2.text);
        }
        const parsed = C.ListingDataSchema.safeParse(raw);
        if (!parsed.success) throw new Error("La réponse de Claude ne respecte pas le schéma.");
        llmData = parsed.data;
      } else {
        warnings.push("Claude n'est pas disponible ici : seules les valeurs reconnues automatiquement sont remplies. Complétez la fiche.");
      }
      const data = C.mergeResults(ad, llmData);
      if (url && !data.url) data.url = url;
      if (url && !data.source) data.source = C.sourceName(url);
      openDraft(data, { method: llmData ? (adapter.id === "generic" ? "claude" : "adaptateur+claude") : adapter.id, adapter: adapter.id, llm: !!llmData, fetchedAt: null }, warnings);
      $("#paste-text").value = ""; $("#paste-url").value = "";
    } catch (e) {
      const code = e && e.code;
      state.error =
        code === "not_granted" ? "Vous avez refusé l'accès à Claude pour cette page : utilisez la saisie manuelle." :
        code === "rate_limited" ? "Trop de demandes à Claude pour le moment. Réessayez dans une minute." :
        code === "prompt_too_large" ? "Texte trop long : ne collez que l'annonce elle-même." :
        code === "refused" ? "Claude a refusé de traiter ce texte." :
        (e && e.message) || "Analyse impossible.";
      if (code === "not_granted") { state.claude = "denied"; renderStatus(); }
    }
    state.busy = false;
    renderAdd();
  }

  function openDraft(data, extraction, warnings) {
    const now = new Date().toISOString();
    const v = data.variantes || [];
    let selected = [];
    if (v.length > 1) { const i = v.findIndex((x) => x.disponible); selected = [i >= 0 ? i : 0]; }
    state.editing = { isNew: true, warnings, selected, listing: { id: uid(), createdAt: now, updatedAt: now, data, editedFields: [], aplMensuelle: null, extraction, commentaire: "" } };
    state.confirmDelete = false;
    renderEditor();
    $("#editor").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function variantData(data, v) {
    const baseTitle = (data.titre || "").replace(/\s+—\s+.*$/, "");
    const out = { ...data, confiance: { ...data.confiance } };
    const map = [["type_logement", "type_logement"], ["surface_m2", "surface_m2"], ["loyer_hc", "loyer_hc"], ["charges_mensuelles", "charges_mensuelles"], ["loyer_cc", "loyer_cc"], ["depot_garantie", "depot_garantie"], ["frais_dossier", "frais_dossier"], ["disponibilite", "disponibilite"], ["charges_incluses", "charges_incluses"]];
    for (const [from, to] of map) {
      out[to] = v[from] != null ? v[from] : Array.isArray(data[to]) ? [] : null;
      out.confiance[to] = v[from] != null ? (from === "surface_m2" && v.surface_max_m2 && v.surface_max_m2 !== v.surface_m2 ? 0.8 : 0.95) : null;
    }
    out.titre = v.nom ? `${baseTitle} — ${v.nom}` : baseTitle;
    return out;
  }

  // ---------- rendu : statut ----------
  function renderStatus() {
    const c = { pending: ["", "Connexion à Claude…"], ok: ["ok", "Claude actif"], absent: ["warn", "Claude indisponible ici"], denied: ["warn", "Accès à Claude refusé"] }[state.claude];
    $("#status").innerHTML =
      `<span class="pill ${c[0]}">${c[1]}</span>` +
      `<span class="pill ${state.storage === "db" ? "ok" : ""}">${state.storage === "db" ? "Enregistré dans votre espace" : "Enregistré dans ce navigateur"}</span>`;
  }

  // ---------- rendu : ajout ----------
  function renderAdd() {
    const t = state.tab;
    const prevText = $("#paste-text") ? $("#paste-text").value : "";
    const prevUrl = $("#paste-url") ? $("#paste-url").value : "";
    $("#add").innerHTML = `
      <div class="panel-head"><h2>Ajouter une annonce</h2></div>
      <div class="tabs" role="tablist">
        <button role="tab" id="tab-texte" aria-selected="${t === "texte"}" data-tab="texte">Coller l'annonce</button>
        <button role="tab" id="tab-manuel" aria-selected="${t === "manuel"}" data-tab="manuel">Saisie manuelle</button>
      </div>
      ${t === "texte" ? `
        <form id="paste-form" class="stack">
          <p class="small muted" style="margin:0">Ouvrez l'annonce (Studapart, Leboncoin, SeLoger, PAP, Bien'ici, résidence…), faites <strong>Ctrl+A</strong> puis <strong>Ctrl+C</strong>, et collez le texte ici. Claude en extrait les données sans rien inventer ; vous vérifiez ensuite la fiche.</p>
          <textarea id="paste-text" rows="7" placeholder="Texte de l'annonce…" aria-label="Texte de l'annonce"></textarea>
          <div class="row">
            <input id="paste-url" type="url" placeholder="URL de l'annonce (conseillé : active le lecteur Studapart / Leboncoin)" aria-label="URL de l'annonce">
            <button class="btn primary" id="analyze" type="submit" ${state.busy || state.claude === "pending" ? "disabled" : ""}>${state.busy ? '<span class="spin"></span> Analyse…' : "Analyser avec Claude"}</button>
            ${EXAMPLE ? `<button class="btn ghost" type="button" id="load-example">Charger l'exemple Studapart 4337</button>` : ""}
          </div>
          ${state.busy ? `<p class="small muted" aria-live="polite" style="margin:0">Claude lit l'annonce et remplit la fiche (10 à 40 s)…</p>` : ""}
          ${state.error ? `<div class="banner err">${esc(state.error)}</div>` : ""}
        </form>` : `
        <div class="row"><p class="small muted" style="margin:0;flex:1 1 260px">Crée une fiche vide que vous remplissez vous-même.</p><button class="btn primary" id="manual">Créer une fiche vide</button></div>`}
    `;
    if ($("#paste-text")) { $("#paste-text").value = prevText; $("#paste-url").value = prevUrl; }
  }

  // ---------- rendu : fiche ----------
  const OFFER = { particulier: "Particulier", agence: "Agence", residence_etudiante: "Résidence étudiante", colocation: "Colocation" };
  const E = (arr, labels) => ({ enum: arr, labels });
  const SECTIONS = [
    ["Identification", [["titre", "Titre", "text", 1], ["url", "URL", "text", 1], ["source", "Site", "text"], ["nom_residence_agence", "Résidence / agence / loueur", "text"], ["date_publication", "Date de publication", "text"], ["type_offre", "Type d'offre", E(Object.keys(OFFER), OFFER)]]],
    ["Localisation", [["adresse", "Adresse", "text", 1], ["code_postal", "Code postal", "text"], ["ville", "Ville", "text"], ["quartier", "Quartier", "text"], ["latitude", "Latitude", "number"], ["longitude", "Longitude", "number"], ["transports", "Transports à proximité", "list", 1]]],
    ["Logement", [["type_logement", "Type (chambre, studio, T1…)", "text"], ["surface_m2", "Surface (m²)", "number"], ["nb_pieces", "Pièces", "number"], ["etage", "Étage", "number"], ["nb_etages", "Nombre d'étages", "number"], ["ascenseur", "Ascenseur", "bool"], ["meuble", "Meublé", "bool"], ["chauffage_type", "Chauffage", E(["individuel", "collectif"])], ["chauffage_energie", "Énergie de chauffage", E(["electrique", "gaz", "reseau_urbain", "fioul", "bois", "pompe_a_chaleur", "autre"])], ["dpe", "DPE", E(["a", "b", "c", "d", "e", "f", "g"])], ["ges", "GES", E(["a", "b", "c", "d", "e", "f", "g"])], ["depenses_energie_min", "Dépenses énergie min (€/an)", "number"], ["depenses_energie_max", "Dépenses énergie max (€/an)", "number"], ["disponibilite", "Disponibilité", "text"], ["duree_min_mois", "Durée min. du bail (mois)", "number"], ["duree_max_mois", "Durée max. du bail (mois)", "number"], ["type_bail", "Type de bail", "text"], ["equipements", "Équipements", "list", 1]]],
    ["Prix", [["loyer_hc", "Loyer hors charges (€/mois)", "number"], ["charges_mensuelles", "Charges (€/mois)", "number"], ["charges_mode", "Mode des charges", E(["provision", "forfait"])], ["loyer_cc", "Loyer charges comprises affiché (€/mois)", "number"], ["charges_incluses", "Charges incluses", "list", 1], ["charges_non_incluses", "Charges NON incluses", "list", 1], ["frais_agence", "Honoraires d'agence (€)", "number"], ["frais_etat_des_lieux", "État des lieux (€)", "number"], ["frais_dossier", "Frais de dossier / plateforme (€)", "number"], ["depot_garantie", "Dépôt de garantie (€)", "number"], ["assurance_obligatoire", "Assurance obligatoire", "bool"], ["garant_requis", "Garant requis", "bool"], ["visale_accepte", "Visale accepté", "bool"], ["eligible_apl", "Éligible APL/ALS", "bool"]]],
  ];

  function dotClass(conf, edited, empty) {
    if (edited) return "ed";
    if (empty || conf == null) return "";
    return conf >= 0.85 ? "hi" : conf >= 0.6 ? "mid" : "lo";
  }
  function fieldHtml([key, label, type, wide], l) {
    const d = l.data, v = d[key];
    const empty = v == null || v === "" || (Array.isArray(v) && !v.length);
    const edited = l.editedFields.includes(key);
    const conf = d.confiance[key];
    const title = edited ? "Corrigé à la main" : empty ? "Non renseigné" : conf != null ? `Confiance ${Math.round(conf * 100)} %` : "";
    let input;
    const id = "f-" + key;
    if (type === "number") input = `<input id="${id}" data-k="${key}" data-t="number" type="number" step="any" inputmode="decimal" value="${typeof v === "number" ? v : ""}">`;
    else if (type === "bool") input = `<select id="${id}" data-k="${key}" data-t="bool"><option value="">— inconnu —</option><option value="oui" ${v === true ? "selected" : ""}>Oui</option><option value="non" ${v === false ? "selected" : ""}>Non</option></select>`;
    else if (type === "list") input = `<textarea id="${id}" data-k="${key}" data-t="list" rows="${Math.min(6, Math.max(2, (v || []).length))}" placeholder="Un élément par ligne">${esc((v || []).join("\n"))}</textarea>`;
    else if (typeof type === "object") input = `<select id="${id}" data-k="${key}" data-t="enum"><option value="">— inconnu —</option>${type.enum.map((o) => `<option value="${o}" ${v === o ? "selected" : ""}>${esc((type.labels && type.labels[o]) || (o.length === 1 ? o.toUpperCase() : o.replace(/_/g, " ")))}</option>`).join("")}</select>`;
    else input = `<input id="${id}" data-k="${key}" data-t="text" type="text" value="${esc(v ?? "")}">`;
    return `<label class="f ${wide || type === "list" ? "wide" : ""}" for="${id}"><span class="lab"><span class="dot ${dotClass(conf, edited, empty)}" title="${title}" data-dot="${key}"></span>${esc(label)}</span>${input}</label>`;
  }

  function servicesHtml(services) {
    return `<div class="wide services"><div class="small muted" style="margin-bottom:6px">Services payants de la résidence (ménage, linge, parking, laverie…)</div>
      ${services.length ? "" : `<p class="small muted" style="margin:0 0 6px">Aucun service payant.</p>`}
      ${services.map((s, i) => `<div class="svc">
        <input aria-label="Nom du service" data-svc="${i}" data-f="nom" value="${esc(s.nom)}">
        <input aria-label="Prix mensuel" placeholder="€/mois" type="number" data-svc="${i}" data-f="prix_mensuel" value="${s.prix_mensuel ?? ""}">
        <input aria-label="Prix unique" placeholder="€ unique" type="number" data-svc="${i}" data-f="prix_unique" value="${s.prix_unique ?? ""}">
        <label class="tiny"><input type="checkbox" data-svc="${i}" data-f="obligatoire" ${s.obligatoire ? "checked" : ""} style="width:auto"> obligatoire</label>
        <button class="link tiny" data-svc-del="${i}" type="button">Retirer</button></div>`).join("")}
      <button class="link small" id="svc-add" type="button">+ Ajouter un service</button></div>`;
  }

  function renderEditor() {
    const ed = state.editing;
    const host = $("#editor");
    if (!ed) { host.innerHTML = ""; return; }
    const l = ed.listing, d = l.data, v = d.variantes || [];
    host.innerHTML = `<section class="editor">
      <h2>${ed.isNew ? "Vérifiez la fiche avant de l'ajouter" : "Modifier l'annonce"}</h2>
      <div class="editor-cols">
        <div class="stack">
          ${ed.warnings.length ? `<div class="banner">${ed.warnings.map(esc).join("<br>")}</div>` : ""}
          ${v.length > 1 ? `<div class="panel"><div class="panel-head"><h2>Types de logement dans l'annonce (${v.length})</h2></div>
            <p class="small muted" style="margin:0 0 8px">${ed.isNew ? "Cochez les logements à ajouter (une ligne du comparatif par logement). « Afficher » remplit la fiche avec ce type." : "« Afficher » remplace les valeurs de la fiche par celles de ce type."}</p>
            <div class="scroll"><table class="variants"><thead><tr>${ed.isNew ? "<th></th>" : ""}<th>Type</th><th>Surface</th><th>Loyer</th><th>Dépôt</th><th>Frais</th><th>Dispo</th><th></th></tr></thead><tbody>
            ${v.map((x, i) => `<tr>${ed.isNew ? `<td><input type="checkbox" style="width:auto" data-var="${i}" aria-label="Ajouter ${esc(x.nom || "ce logement")}" ${ed.selected.includes(i) ? "checked" : ""}></td>` : ""}
              <td><strong>${esc(x.nom || "Type " + (i + 1))}</strong></td>
              <td class="num">${x.surface_m2 ?? "—"}${x.surface_max_m2 && x.surface_max_m2 !== x.surface_m2 ? "–" + x.surface_max_m2 : ""} m²</td>
              <td class="num">${eur(x.loyer_cc ?? x.loyer_hc)} ${x.loyer_cc != null ? "CC" : x.loyer_hc != null ? "HC" : ""}</td>
              <td class="num">${eur(x.depot_garantie)}</td><td class="num">${eur(x.frais_dossier)}</td>
              <td class="${x.disponible === false ? "muted" : ""}">${x.disponible === false ? "complet" : esc(x.disponibilite || "?")}</td>
              <td><button class="link" type="button" data-show-var="${i}">Afficher</button></td></tr>`).join("")}
            </tbody></table></div></div>` : ""}
          ${SECTIONS.map(([title, fields]) => `<div class="panel"><div class="panel-head"><h2>${title}</h2></div><div class="grid2">
            ${fields.map((f) => fieldHtml(f, l)).join("")}
            ${title === "Localisation" ? `<p class="wide tiny muted" style="margin:0">Pour la distance : copiez les coordonnées depuis une carte (clic droit sur Google Maps ou OpenStreetMap) dans Latitude / Longitude.</p>` : ""}
            ${title === "Prix" ? servicesHtml(d.services) : ""}</div></div>`).join("")}
          <div class="panel"><div class="panel-head"><h2>Qualité de l'extraction</h2></div>
            <p class="tiny muted" style="margin:0 0 6px">Méthode : ${esc(l.extraction.method)}${l.extraction.llm ? " · lu par Claude" : ""}</p>
            <p class="tiny muted legend" style="margin:0 0 8px"><span><span class="dot hi"></span>sûr</span><span><span class="dot mid"></span>à vérifier</span><span><span class="dot lo"></span>douteux</span><span><span class="dot"></span>non renseigné</span><span><span class="dot ed"></span>corrigé à la main</span></p>
            ${d.notes.length ? `<ul class="notes">${d.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : `<p class="small muted" style="margin:0">Aucune ambiguïté signalée.</p>`}
          </div>
        </div>
        <div class="editor-side">
          <div class="panel"><div class="panel-head"><h2>Coût réel</h2></div><div id="cost"></div>
            <div class="stack" style="margin-top:12px">
              <label class="f" for="apl">APL estimée (€/mois, optionnel)<input id="apl" type="number" min="0" inputmode="decimal" value="${l.aplMensuelle ?? ""}"></label>
              <label class="f" for="comment">Commentaire<textarea id="comment" rows="2">${esc(l.commentaire)}</textarea></label>
            </div>
          </div>
          <div class="row">
            <button class="btn primary" id="save" ${ed.isNew && v.length > 1 && !ed.selected.length ? "disabled" : ""}>${ed.isNew ? (ed.selected.length > 1 ? `Ajouter ${ed.selected.length} logements` : "Ajouter au comparatif") : "Enregistrer"}</button>
            <button class="btn" id="cancel">Annuler</button>
            ${ed.isNew ? "" : state.confirmDelete ? `<span class="confirm">Supprimer ? <button class="btn danger" id="del-yes">Oui, supprimer</button><button class="btn ghost" id="del-no">Non</button></span>` : `<button class="btn danger" id="del">Supprimer</button>`}
          </div>
        </div>
      </div></section>`;
    renderCost();
  }

  function renderCost() {
    const ed = state.editing; if (!ed) return;
    const c = C.computeCost(ed.listing, state.settings), n = state.settings.dureeMois;
    const lines = (arr, total, totEst) => `<table class="lines"><tbody>${arr.map((x) => `<tr><td class="${x.estimated ? "est" : ""}">${esc(x.label)}${x.note ? `<span class="note">${esc(x.note)}</span>` : ""}</td><td>${money(x.amount, x.estimated, true)}</td></tr>`).join("")}<tr class="total"><td>Total</td><td>${money(total, totEst, true)}</td></tr></tbody></table>`;
    $("#cost").innerHTML = `
      <div class="kpis">
        <div class="kpi main"><div class="k">Coût mensuel réel</div><div class="v">${money(c.coutMensuelReel, c.hasEstimates)}</div></div>
        <div class="kpi"><div class="k">€/m² réel</div><div class="v">${money(c.prixM2Reel, c.hasEstimates, true)}</div></div>
        <div class="kpi"><div class="k">Total sur ${n} mois</div><div class="v">${money(c.coutTotalSejour, c.hasEstimates)}</div></div>
        <div class="kpi"><div class="k">Trésorerie à l'entrée</div><div class="v">${money(c.tresorerieEntree)}</div></div>
        ${c.coutApresApl != null ? `<div class="kpi"><div class="k">Après APL</div><div class="v">${money(c.coutApresApl, c.hasEstimates)}</div></div>` : ""}
      </div>
      <div style="margin-top:12px"><h3>Coût mensuel récurrent</h3>${lines(c.recurring, c.coutMensuelRecurrent, c.hasEstimates)}</div>
      <div style="margin-top:12px"><h3>Frais uniques</h3>${c.oneOff.length ? lines(c.oneOff, c.fraisUniques) + `<p class="tiny muted" style="margin:4px 0 0">Lissés sur ${n} mois : ${money(c.fraisUniques / n, false, true)} / mois</p>` : `<p class="small muted" style="margin:0">Aucun frais unique indiqué.</p>`}</div>
      <div style="margin-top:12px"><h3>Trésorerie à l'entrée</h3>${lines(c.tresorerieLines, c.tresorerieEntree)}<p class="tiny muted" style="margin:4px 0 0">Le dépôt de garantie est remboursable : il n'entre pas dans le coût réel.</p></div>
      <div style="margin-top:12px"><h3>Alertes</h3>${c.alerts.length ? `<ul class="alerts">${c.alerts.map((a) => `<li class="${a.level}">${esc(a.message)}</li>`).join("")}</ul>` : `<p class="small" style="margin:0;color:var(--accent)">Aucune alerte.</p>`}</div>`;
  }

  // ---------- rendu : paramètres ----------
  function renderSettings() {
    const s = state.settings, e = s.estimations;
    const open = $("#settings details") ? $("#settings details").open : false;
    const num = (id, label, val, step) => `<label class="f" for="${id}">${label}<input id="${id}" data-set="${id}" type="number" min="0" step="${step || 1}" inputmode="decimal" value="${val}"></label>`;
    $("#settings").innerHTML = `<details ${open ? "open" : ""}>
      <summary class="panel-head" style="margin:0"><h2>Paramètres du calcul</h2><span class="btn ghost">Modifier</span></summary>
      <p class="small muted" style="margin:8px 0 0">Séjour de <strong>${s.dureeMois} mois</strong> · électricité ${e.electricite} € · internet ${e.internet} € · assurance ${e.assurance} € · eau ${e.eau} € / mois · ${s.reference ? `distances depuis <strong>${esc(s.reference.label)}</strong>` : "aucune adresse de référence"}</p>
      <div class="stack" style="margin-top:12px">
        <div class="sgrid">
          ${num("dureeMois", "Durée de séjour (mois)", s.dureeMois)}
          ${num("electricite", "Électricité (€/mois)", e.electricite)}
          ${num("internet", "Internet (€/mois)", e.internet)}
          ${num("assurance", "Assurance (€/mois)", e.assurance)}
          ${num("eau", "Eau (€/mois)", e.eau)}
          ${num("prixKwhChauffage", "Chauffage (€/kWh)", e.prixKwhChauffage, "0.01")}
        </div>
        <p class="tiny muted" style="margin:0">Chauffage individuel non inclus : estimation DPE de l'annonce si elle existe, sinon surface × consommation type de la classe DPE (D si inconnue) × prix du kWh.</p>
        <label class="f" for="zone" style="max-width:360px">Zone (plafonds d'honoraires loi ALUR)
          <select id="zone" data-set="zone">
            ${[["auto", "Automatique (selon le code postal)"], ["tres_tendue", "Très tendue (12 €/m² + 3 €/m²)"], ["tendue", "Tendue (10 €/m² + 3 €/m²)"], ["non_tendue", "Non tendue (8 €/m² + 3 €/m²)"]].map(([v, t]) => `<option value="${v}" ${s.zone === v ? "selected" : ""}>${t}</option>`).join("")}
          </select></label>
        <div class="grid2">
          <label class="f" for="ref-label">Adresse de référence (école, travail)<input id="ref-label" placeholder="ex. Sorbonne, Paris 5e" value="${esc(s.reference ? s.reference.label : "")}"></label>
          <label class="f" for="ref-coords">Coordonnées (latitude, longitude)<input id="ref-coords" placeholder="48.8486, 2.3434" value="${s.reference ? s.reference.lat + ", " + s.reference.lon : ""}"></label>
          <div class="wide row"><button class="btn" id="ref-save" type="button">Enregistrer l'adresse</button>${s.reference ? `<button class="btn ghost" id="ref-clear" type="button">Retirer</button>` : ""}<span class="tiny muted">Coordonnées : clic droit sur l'adresse dans Google Maps ou OpenStreetMap, puis copiez-les ici.</span></div>
        </div>
        <div><button class="btn ghost" id="reset-settings" type="button">Rétablir les valeurs par défaut</button></div>
      </div></details>`;
  }

  // ---------- rendu : comparatif ----------
  const COLS = [["loyer", "Loyer affiché"], ["cout", "Coût mensuel réel"], ["m2", "€/m² réel"], ["surface", "Surface"], ["total", "Total séjour"], ["treso", "Trésorerie entrée"], ["dist", "Distance"]];
  function rows() {
    const ref = state.settings.reference;
    return state.listings.map((l) => {
      const cost = C.computeCost(l, state.settings);
      const km = ref && l.data.latitude != null && l.data.longitude != null ? C.haversineKm(ref, { lat: l.data.latitude, lon: l.data.longitude }) : null;
      return { l, cost, km, min: km != null ? C.estimateTransitMinutes(km) : null };
    });
  }
  function val(r, k) {
    switch (k) {
      case "cout": return r.cost.complete ? r.cost.coutMensuelReel : null;
      case "m2": return r.cost.complete ? r.cost.prixM2Reel : null;
      case "surface": return r.l.data.surface_m2;
      case "total": return r.cost.complete ? r.cost.coutTotalSejour : null;
      case "treso": return r.cost.tresorerieEntree;
      case "dist": return r.km;
      case "loyer": return r.cost.loyerAffiche;
    }
  }
  function alertsHtml(cost) {
    const a = cost.alerts.filter((x) => x.level !== "info");
    if (!a.length) return `<div class="ok">✓ aucune</div>`;
    return a.slice(0, 3).map((x) => `<div class="${x.level === "danger" ? "d" : "w"}" title="${esc(x.message)}">${x.level === "danger" ? "⛔" : "⚠"} ${esc(x.message)}</div>`).join("") + (a.length > 3 ? `<div class="muted">+${a.length - 3} autre(s)</div>` : "");
  }
  function renderCompare() {
    const rs = rows();
    const complete = rs.filter((r) => r.cost.complete).sort((a, b) => a.cost.coutMensuelReel - b.cost.coutMensuelReel);
    const rank = new Map(complete.map((r, i) => [r.l.id, i]));
    const best = complete.find((r) => !r.cost.alerts.some((a) => a.code === "complet"));
    const heat = (r) => {
      if (!rank.has(r.l.id)) return "var(--surface)";
      const t = complete.length > 1 ? rank.get(r.l.id) / (complete.length - 1) : 0;
      return `hsl(${Math.round(150 - t * 145)} var(--heat-s) var(--heat-l))`;
    };
    const { key, dir } = state.sort;
    rs.sort((a, b) => { const x = val(a, key), y = val(b, key); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x - y) * dir; });
    const has = state.listings.length > 0;
    const distTxt = (r) => r.km != null ? `${r.km.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km<div class="tiny est" title="Temps estimé en transports : vol d'oiseau × 1,35 à 18 km/h + 8 min">≈ ${r.min} min</div>` : state.settings.reference ? `<span class="tiny muted">pas de coordonnées</span>` : "—";
    $("#compare").innerHTML = `
      <div class="panel-head"><h2>Comparatif (${state.listings.length})</h2>
        <div class="row">
          <button class="btn" id="exp-csv" ${has ? "" : "disabled"}>Export CSV</button>
          <button class="btn" id="exp-xlsx" ${has ? "" : "disabled"}>Export Excel</button>
          <button class="btn ghost" id="exp-json" ${has ? "" : "disabled"}>Sauvegarde JSON</button>
          <label class="btn ghost" for="imp-json">Importer<input id="imp-json" type="file" accept="application/json" hidden></label>
        </div></div>
      ${!has ? `<div class="empty"><p class="muted" style="margin:0">Aucune annonce pour l'instant. Collez le texte d'une annonce ci-dessus${EXAMPLE ? ", ou essayez avec une vraie annonce Studapart" : ""}.</p>${EXAMPLE ? `<button class="btn primary" id="try-example">Essayer avec l'annonce Studapart 4337</button>` : ""}</div>` : `
      <div class="row mobsort" style="margin-bottom:10px"><label class="small muted" for="sort-m">Trier par</label>
        <select id="sort-m" style="width:auto">${COLS.flatMap(([k, t]) => [`<option value="${k}:1" ${key === k && dir === 1 ? "selected" : ""}>${t} ↑</option>`, `<option value="${k}:-1" ${key === k && dir === -1 ? "selected" : ""}>${t} ↓</option>`]).join("")}</select></div>
      <ul class="cards">${rs.map((r) => `<li><button class="card" data-open="${r.l.id}" style="background:${heat(r)}">
        <div class="top"><div>${best && r.l.id === best.l.id ? `<span class="badge">★ Meilleure offre</span>` : ""}<div class="ttl">${esc(r.l.data.titre || "Sans titre")}</div>
          <div class="meta">${[r.l.data.ville, r.l.data.source, r.l.data.surface_m2 ? r.l.data.surface_m2 + " m²" : null].filter(Boolean).map(esc).join(" · ")}</div></div>
          <div class="big">${r.cost.complete ? money(r.cost.coutMensuelReel, r.cost.hasEstimates) : "—"}<div class="tiny muted">réel / mois</div></div></div>
        <div class="meta"><span>Affiché ${money(r.cost.loyerAffiche)}</span><span>${r.cost.prixM2Reel != null ? money(r.cost.prixM2Reel, r.cost.hasEstimates, true) + " /m²" : ""}</span>${r.km != null ? `<span>${r.km.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km · ≈ ${r.min} min</span>` : ""}</div>
        <div class="al">${alertsHtml(r.cost)}</div></button></li>`).join("")}</ul>
      <div class="scroll tablewrap"><table class="cmp"><thead><tr><th>Logement</th>
        ${COLS.map(([k, t]) => `<th aria-sort="${key === k ? (dir === 1 ? "ascending" : "descending") : "none"}"><button data-sort="${k}" class="${key === k ? "on" : ""}">${t} ${key === k ? (dir === 1 ? "▲" : "▼") : "↕"}</button></th>`).join("")}<th style="text-align:left">Alertes</th></tr></thead>
        <tbody>${rs.map((r) => `<tr data-open="${r.l.id}" class="${best && r.l.id === best.l.id ? "best" : ""}" tabindex="0">
          <td style="background:${heat(r)}">${best && r.l.id === best.l.id ? `<span class="badge">★ Meilleure offre</span>` : ""}<div class="ttl" title="${esc(r.l.data.titre)}">${esc(r.l.data.titre || "Sans titre")}</div>
            <div class="tiny muted">${[r.l.data.ville, r.l.data.type_logement, r.l.data.source].filter(Boolean).map(esc).join(" · ")}${r.l.data.url && /^https?:/.test(r.l.data.url) ? ` · <a href="${esc(r.l.data.url)}" target="_blank" rel="noreferrer" style="color:var(--accent)">annonce ↗</a>` : ""}</div></td>
          <td style="background:${heat(r)}">${money(r.cost.loyerAffiche)}</td>
          <td style="background:${heat(r)};font-size:16px"><strong>${r.cost.complete ? money(r.cost.coutMensuelReel, r.cost.hasEstimates) : "—"}</strong>${r.cost.coutApresApl != null ? `<div class="tiny muted">après APL ${money(r.cost.coutApresApl)}</div>` : ""}</td>
          <td style="background:${heat(r)}">${r.cost.complete ? money(r.cost.prixM2Reel, r.cost.hasEstimates, true) : "—"}</td>
          <td style="background:${heat(r)}" class="num">${r.l.data.surface_m2 != null ? r.l.data.surface_m2 + " m²" : "—"}</td>
          <td style="background:${heat(r)}">${r.cost.complete ? money(r.cost.coutTotalSejour, r.cost.hasEstimates) : "—"}</td>
          <td style="background:${heat(r)}">${money(r.cost.tresorerieEntree)}</td>
          <td style="background:${heat(r)}" class="num">${distTxt(r)}</td>
          <td style="background:${heat(r)}" class="al">${alertsHtml(r.cost)}</td></tr>`).join("")}</tbody></table></div>
      <p class="tiny muted" style="margin:10px 0 0">Couleur : du vert (coût mensuel réel le plus bas) au rouge (le plus haut). Cliquez sur une ligne pour voir le détail et corriger la fiche.</p>`}
      ${downloads === null && state.claude !== "pending" ? `<p class="tiny muted" style="margin:8px 0 0">Les téléchargements ne sont pas disponibles dans cette vue.</p>` : ""}`;
  }

  function renderAll() { renderStatus(); renderAdd(); renderEditor(); renderSettings(); renderCompare(); }

  // ---------- exports ----------
  function exportRows() {
    const s = state.settings, ref = s.reference;
    const cols = [
      ["Titre", (l) => l.data.titre], ["Source", (l) => l.data.source], ["URL", (l) => l.data.url], ["Type d'offre", (l) => l.data.type_offre],
      ["Résidence / agence", (l) => l.data.nom_residence_agence], ["Adresse", (l) => l.data.adresse], ["Code postal", (l) => l.data.code_postal], ["Ville", (l) => l.data.ville],
      ["Type", (l) => l.data.type_logement], ["Surface (m²)", (l) => l.data.surface_m2], ["Meublé", (l) => (l.data.meuble == null ? null : l.data.meuble ? "oui" : "non")], ["DPE", (l) => (l.data.dpe ? l.data.dpe.toUpperCase() : null)],
      ["Loyer HC", (l) => l.data.loyer_hc], ["Charges", (l) => l.data.charges_mensuelles], ["Loyer CC affiché", (l) => l.data.loyer_cc], ["Charges incluses", (l) => l.data.charges_incluses.join(", ")],
      ["Frais d'agence", (l) => l.data.frais_agence], ["Frais état des lieux", (l) => l.data.frais_etat_des_lieux], ["Frais dossier/plateforme", (l) => l.data.frais_dossier], ["Dépôt de garantie", (l) => l.data.depot_garantie],
      ["Coût mensuel récurrent", (l, c) => c.coutMensuelRecurrent, 1], ["Frais uniques", (l, c) => c.fraisUniques], [`Coût mensuel réel (${s.dureeMois} mois)`, (l, c) => c.coutMensuelReel, 1],
      ["Dont estimations", (l, c) => c.recurring.filter((x) => x.estimated).map((x) => `${x.label} ${x.amount}€`).join(" ; ")], ["Coût total séjour", (l, c) => c.coutTotalSejour, 1], ["€/m² réel", (l, c) => c.prixM2Reel, 1],
      ["Trésorerie à l'entrée", (l, c) => c.tresorerieEntree], ["APL saisie", (l) => l.aplMensuelle], ["Coût après APL", (l, c) => c.coutApresApl, 1],
      ["Distance (km, vol d'oiseau)", (l) => (ref && l.data.latitude != null ? Math.round(C.haversineKm(ref, { lat: l.data.latitude, lon: l.data.longitude }) * 10) / 10 : null)],
      ["Alertes", (l, c) => c.alerts.map((a) => a.message).join(" | ")], ["Notes d'extraction", (l) => l.data.notes.join(" | ")], ["Commentaire", (l) => l.commentaire],
    ];
    return { cols, data: state.listings.map((l) => { const c = C.computeCost(l, s); return { c, vals: cols.map(([, f]) => f(l, c)) }; }) };
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  async function save(filename, data) {
    if (!downloads) { toast("Téléchargement indisponible dans cette vue."); return; }
    try { const r = await downloads.save({ filename, data }); if (r.status === "saved") toast("Fichier enregistré."); }
    catch (e) { if (e && e.code !== "declined") toast(e.code === "rate_limited" ? "Une demande est déjà ouverte." : "Téléchargement impossible ici."); }
  }
  function exportCsv() {
    const { cols, data } = exportRows();
    const cell = (v) => { if (v == null) return ""; const s = typeof v === "number" ? String(v).replace(".", ",") : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [cols.map(([h]) => cell(h)).join(";"), ...data.map((r) => r.vals.map(cell).join(";"))];
    save(`loccompare-${stamp()}.csv`, "﻿" + lines.join("\r\n"));
  }
  async function exportXlsx() {
    if (typeof window.writeXlsxFile !== "function") { toast("Bibliothèque Excel non chargée : utilisez l'export CSV."); return; }
    const { cols, data } = exportRows();
    const sheet = [cols.map(([h]) => ({ value: h, fontWeight: "bold" })), ...data.map((r) => r.vals.map((v, i) => (v == null || v === "" ? null : { value: v, ...(cols[i][2] && r.c.hasEstimates ? { fontStyle: "italic" } : {}) })))];
    const blob = await window.writeXlsxFile(sheet, { columns: cols.map(([h]) => ({ width: Math.min(40, Math.max(10, h.length + 2)) })) }).toBlob();
    save(`loccompare-${stamp()}.xlsx`, blob);
  }

  // ---------- événements ----------
  function markEdited(key) {
    const l = state.editing.listing;
    if (!l.editedFields.includes(key)) l.editedFields.push(key);
    const dot = document.querySelector(`[data-dot="${key}"]`);
    if (dot) { dot.className = "dot ed"; dot.title = "Corrigé à la main"; }
  }
  document.addEventListener("input", (ev) => {
    const t = ev.target;
    if (state.editing && t.dataset.k) {
      const k = t.dataset.k, ty = t.dataset.t, d = state.editing.listing.data;
      d[k] = ty === "number" ? (t.value === "" ? null : Number(t.value)) : ty === "bool" ? (t.value === "" ? null : t.value === "oui") : ty === "list" ? t.value.split("\n").map((s) => s.trim()).filter(Boolean) : t.value.trim() === "" ? null : t.value;
      markEdited(k); renderCost(); return;
    }
    if (state.editing && t.dataset.svc != null) {
      const s = state.editing.listing.data.services[+t.dataset.svc], f = t.dataset.f;
      s[f] = f === "obligatoire" ? t.checked : f === "nom" ? t.value : t.value === "" ? null : Number(t.value);
      markEdited("services"); renderCost(); return;
    }
    if (t.id === "apl" && state.editing) { state.editing.listing.aplMensuelle = t.value === "" ? null : Number(t.value); renderCost(); return; }
    if (t.id === "comment" && state.editing) { state.editing.listing.commentaire = t.value; return; }
  });
  document.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.dataset.var != null && state.editing) {
      const i = +t.dataset.var, sel = state.editing.selected;
      state.editing.selected = t.checked ? [...new Set([...sel, i])].sort((a, b) => a - b) : sel.filter((x) => x !== i);
      renderEditor(); return;
    }
    if (t.dataset.set) {
      const s = state.settings, k = t.dataset.set;
      if (k === "dureeMois") s.dureeMois = Math.max(1, Number(t.value) || 1);
      else if (k === "zone") s.zone = t.value;
      else s.estimations[k] = Number(t.value) || 0;
      persist(); renderSettings(); renderCompare(); renderCost(); return;
    }
    if (t.id === "sort-m") { const [k, d] = t.value.split(":"); state.sort = { key: k, dir: +d }; renderCompare(); return; }
    if (t.id === "imp-json" && t.files && t.files[0]) {
      t.files[0].text().then((txt) => {
        const j = JSON.parse(txt);
        const imported = (j.listings || []).map(reviveListing).filter(Boolean);
        const byId = new Map(state.listings.map((l) => [l.id, l]));
        imported.forEach((l) => byId.set(l.id, l));
        state.listings = [...byId.values()];
        if (j.settings) applyStored({ listings: state.listings, settings: j.settings });
        persist(); renderAll(); toast(`${imported.length} annonce(s) importée(s).`);
      }).catch(() => toast("Fichier de sauvegarde invalide."));
    }
  });
  document.addEventListener("submit", (ev) => {
    if (ev.target.id === "paste-form") {
      ev.preventDefault();
      const text = $("#paste-text").value.trim(), url = $("#paste-url").value.trim();
      if (text.length < 50) { state.error = "Collez au moins quelques lignes du texte de l'annonce."; renderAdd(); return; }
      if (url && !/^https?:\/\//i.test(url)) { state.error = "L'URL doit commencer par http:// ou https://."; renderAdd(); return; }
      analyze(text, url || null);
    }
  });
  document.addEventListener("keydown", (ev) => {
    const tr = ev.target.closest && ev.target.closest("tr[data-open]");
    if (tr && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); openExisting(tr.dataset.open); }
  });
  function openExisting(id) {
    const l = state.listings.find((x) => x.id === id);
    if (!l) return;
    state.editing = { isNew: false, warnings: [], selected: [], listing: clone(l) };
    state.confirmDelete = false;
    renderEditor();
    $("#editor").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  document.addEventListener("click", (ev) => {
    const t = ev.target.closest("button, tr[data-open], a");
    if (!t || t.tagName === "A") return;
    if (t.dataset.tab) { state.tab = t.dataset.tab; renderAdd(); return; }
    if (t.dataset.open) { openExisting(t.dataset.open); return; }
    if (t.dataset.sort) { const k = t.dataset.sort; state.sort = state.sort.key === k ? { key: k, dir: -state.sort.dir } : { key: k, dir: 1 }; renderCompare(); return; }
    if (t.dataset.showVar != null && state.editing) { state.editing.listing.data = variantData(state.editing.listing.data, state.editing.listing.data.variantes[+t.dataset.showVar]); renderEditor(); return; }
    if (t.dataset.svcDel != null && state.editing) { state.editing.listing.data.services.splice(+t.dataset.svcDel, 1); markEdited("services"); renderEditor(); return; }
    switch (t.id) {
      case "manual": openDraft({ ...C.emptyListingData(), titre: "Nouvelle annonce" }, { method: "manuel", adapter: null, llm: false, fetchedAt: null }, []); break;
      case "load-example": $("#paste-text").value = EXAMPLE.text; $("#paste-url").value = EXAMPLE.url; break;
      case "try-example": state.tab = "texte"; renderAdd(); $("#paste-text").value = EXAMPLE.text; $("#paste-url").value = EXAMPLE.url; $("#add").scrollIntoView({ behavior: "smooth" }); $("#paste-text").focus(); toast("Exemple chargé : cliquez sur « Analyser avec Claude »."); break;
      case "svc-add": state.editing.listing.data.services.push({ nom: "Service", prix_mensuel: null, prix_unique: null, obligatoire: false }); markEdited("services"); renderEditor(); break;
      case "save": {
        const ed = state.editing, now = new Date().toISOString(), base = { ...ed.listing, updatedAt: now };
        const saved = ed.isNew && ed.selected.length > 1 ? ed.selected.map((i, k) => ({ ...clone(base), id: k === 0 ? base.id : base.id + "-" + i, data: variantData(base.data, base.data.variantes[i]) })) : [base];
        const byId = new Map(state.listings.map((l) => [l.id, l]));
        saved.forEach((l) => byId.set(l.id, l));
        state.listings = [...byId.values()];
        state.editing = null;
        persist(); renderEditor(); renderCompare();
        toast(saved.length > 1 ? `${saved.length} logements ajoutés.` : ed.isNew ? "Annonce ajoutée." : "Annonce enregistrée.");
        $("#compare").scrollIntoView({ behavior: "smooth", block: "start" });
        break;
      }
      case "cancel": state.editing = null; renderEditor(); break;
      case "del": state.confirmDelete = true; renderEditor(); break;
      case "del-no": state.confirmDelete = false; renderEditor(); break;
      case "del-yes": state.listings = state.listings.filter((l) => l.id !== state.editing.listing.id); state.editing = null; persist(); renderEditor(); renderCompare(); toast("Annonce supprimée."); break;
      case "ref-save": {
        const m = /(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)/.exec($("#ref-coords").value);
        if (!m) { toast("Coordonnées attendues : latitude, longitude (ex. 48.8486, 2.3434)."); break; }
        const lat = Number(m[1].replace(",", ".")), lon = Number(m[2].replace(",", "."));
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) { toast("Coordonnées hors limites."); break; }
        state.settings.reference = { label: $("#ref-label").value.trim() || `${lat}, ${lon}`, lat, lon };
        persist(); renderSettings(); renderCompare(); toast("Adresse de référence enregistrée."); break;
      }
      case "ref-clear": state.settings.reference = null; persist(); renderSettings(); renderCompare(); break;
      case "reset-settings": state.settings = { ...clone(C.DEFAULT_SETTINGS), reference: state.settings.reference }; persist(); renderSettings(); renderCompare(); renderCost(); break;
      case "exp-csv": exportCsv(); break;
      case "exp-xlsx": exportXlsx(); break;
      case "exp-json": save(`loccompare-sauvegarde-${stamp()}.json`, JSON.stringify(snapshot(), null, 2)); break;
    }
  });

  // ---------- démarrage ----------
  loadLocal();
  renderAll();
  initCapabilities();
})();
