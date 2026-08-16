
// ---------- DONNÉES DE DÉMO ----------
const DEFAULT_POS = { lat: -18.8792, lng: 47.5079 };

const DEMO_CENTERS = [
  { nom: "Hôpital Central", type: "MEDICALE", tel: "+261202222649", lat: -18.9076, lng: 47.5253 },
  { nom: "Clinique Sainte-Famille", type: "MEDICALE", tel: "+261202225160", lat: -18.9036, lng: 47.5203 },
  { nom: "Commissariat Central", type: "AGRESSION", tel: "+261202220717", lat: -18.9101, lng: 47.5258 },
  { nom: "Brigade de Gendarmerie", type: "AGRESSION", tel: "+261202224432", lat: -18.8940, lng: 47.5150 },
  { nom: "Caserne des Pompiers", type: "INCENDIE", tel: "+261202225673", lat: -18.9005, lng: 47.5190 },
  { nom: "Station d'Ambulances", type: "ACCIDENT", tel: "+261340000000", lat: -18.8980, lng: 47.5120 },
  { nom: "Poste de Secours Analakely", type: "ACCIDENT", tel: "+261331111111", lat: -18.9081, lng: 47.5234 },
  { nom: "Bureau Personnes Perdues", type: "PERDU", tel: "+261202212345", lat: -18.9020, lng: 47.5170 }
];

const DEMO_HELPERS = [
  { nom: "Jean (volontaire)", tel: "+261341122334", dLat: 0.004, dLng: 0.002 },
  { nom: "Marie (voisine)", tel: "+261339988776", dLat: -0.003, dLng: -0.004 },
  { nom: "Fetra (motard)", tel: "+261325544332", dLat: 0.006, dLng: -0.002 }
];

const DEMO_FEED = [
  { from: "034 12 345 67", text: "🚨 SOS ! Je suis près du marché Analakely.", lat: -18.9081, lng: 47.5234 },
  { from: "Utilisateur #245", text: "🚨 Accident de moto vers Isoraka.", lat: -18.9150, lng: 47.5180 },
  { from: "Fetra R.", text: "🚨 Je suis perdu près de la gare Soarano.", lat: -18.9095, lng: 47.5162 }
];

// ---------- ÉTAT ----------
let userPos = null;
let state = "idle"; // idle | counting | active
let currentType = "AUTRE";
let currentAlertId = null;
let countdownTimer = null;
let callTimer = null;
let feedTimer = null;
let map = null;
let userMarker = null;
let centerMarkers = [];

let contacts = JSON.parse(localStorage.getItem("sos_contacts") || "[]");
let history = JSON.parse(localStorage.getItem("sos_history") || "[]");

// ---------- HELPERS ----------
const $ = id => document.getElementById(id);

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function gmapsLink(p) {
  return "https://www.google.com/maps?q=" + p.lat + "," + p.lng;
}

function gmapsDir(a, b) {
  return "https://www.google.com/maps/dir/?api=1&origin=" +
    a.lat + "," + a.lng + "&destination=" + b.lat + "," + b.lng;
}

async function getRoute(from, to, profile) {
  try {
    const url = "https://router.project-osrm.org/route/v1/" + profile + "/" +
      from.lng + "," + from.lat + ";" + to.lng + "," + to.lat +
      "?overview=false&steps=false";
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === "Ok" && data.routes && data.routes.length) {
      return {
        km: data.routes[0].distance / 1000,
        min: data.routes[0].duration / 60
      };
    }
  } catch (e) { /* hors ligne : estimation */ }

  const km = haversineKm(from, to);
  const speed = profile === "driving" ? 25 : (profile === "cycling" ? 12 : 4.5);
  return { km: km, min: (km / speed) * 60 };
}

async function routesHTML(from, to) {
  const drive = await getRoute(from, to, "driving");
  const walk = await getRoute(from, to, "walking");
  const bus = drive.km > 1.5
    ? '<span class="t">🚌 Bus ligne 5 possible</span>'
    : "";
  return '<div class="routes">' +
    '<span class="t">🚗 ' + drive.km.toFixed(1) + ' km • ~' + Math.max(1, Math.round(drive.min)) + ' min</span>' +
    '<span class="t">🚶 ~' + Math.max(1, Math.round(walk.min)) + ' min</span>' +
    bus +
    '<a class="t link" target="_blank" href="' + gmapsDir(from, to) + '">🧭 Itinéraire complet</a>' +
    '</div>';
}

// ---------- CARTE ----------
function initMap() {
  map = L.map("map").setView([DEFAULT_POS.lat, DEFAULT_POS.lng], 13);
   map.zoomControl.setPosition("bottomright");
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);
}

function setMapUser() {
  if (!map || !userPos) return;
  if (userMarker) userMarker.remove();
  userMarker = L.marker([userPos.lat, userPos.lng])
    .addTo(map)
    .bindPopup("📍 Votre position");
  map.setView([userPos.lat, userPos.lng], 14);
}

function clearCenterMarkers() {
  centerMarkers.forEach(m => m.remove());
  centerMarkers = [];
}

// ---------- POSITION ----------
function locate() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

async function ensurePosition() {
  if (userPos) return userPos;
  $("locationStatus").textContent = "📍 Recherche de votre position...";
  const pos = await locate();
  if (pos) {
    userPos = pos;
    $("locationStatus").textContent =
      "📍 Position détectée : " + pos.lat.toFixed(5) + ", " + pos.lng.toFixed(5);
  } else {
    userPos = { ...DEFAULT_POS };
    $("locationStatus").textContent =
      "📍 GPS refusé → position de démonstration utilisée.";
  }
  setMapUser();
  return userPos;
}

// ---------- CENTRES SELON URGENCE ----------
function centersFor(type) {
  const match = {
    MEDICALE: ["MEDICALE"],
    AGRESSION: ["AGRESSION"],
    INCENDIE: ["INCENDIE"],
    ACCIDENT: ["ACCIDENT", "MEDICALE"],
    PERDU: ["PERDU", "AGRESSION"],
    AUTRE: ["MEDICALE", "AGRESSION", "INCENDIE", "ACCIDENT", "PERDU"]
  }[type] || ["MEDICALE", "AGRESSION", "INCENDIE", "ACCIDENT", "PERDU"];

  return DEMO_CENTERS
    .filter(c => match.includes(c.type))
    .map(c => ({ ...c, km: userPos ? haversineKm(userPos, c) : 0 }))
    .sort((a, b) => a.km - b.km);
}

async function renderCenters(type) {
  const list = centersFor(type).slice(0, 4);
  const box = $("centersList");
  box.innerHTML = '<p class="loading">🔎 Recherche des centres + itinéraires...</p>';
  clearCenterMarkers();

  const cards = [];
  for (const c of list) {
    if (map) {
      const m = L.marker([c.lat, c.lng]).addTo(map)
        .bindPopup("<strong>" + escapeHtml(c.nom) + "</strong><br>" + escapeHtml(c.tel));
      centerMarkers.push(m);
    }
    const routes = userPos ? await routesHTML(userPos, c) : "";
    cards.push(
      '<article class="card">' +
      '<h3>' + escapeHtml(c.nom) + '</h3>' +
      '<p>' + escapeHtml(c.type) + ' • ' + c.km.toFixed(1) + ' km</p>' +
      '<p>📞 ' + escapeHtml(c.tel) + '</p>' +
      '<div class="row">' +
      '<a class="btn red" href="tel:' + c.tel + '">Appeler</a>' +
      '<a class="btn blue" target="_blank" href="' + gmapsDir(userPos || DEFAULT_POS, c) + '">Itinéraire</a>' +
      '</div>' + routes + '</article>'
    );
  }
  box.innerHTML = cards.join("") || '<p class="loading">Aucun centre.</p>';
}

// ---------- AIDANTS ----------
async function renderHelpers() {
  const box = $("helpersList");
  if (!userPos) { box.innerHTML = ""; return; }

  const cards = [];
  for (const h of DEMO_HELPERS) {
    const pos = { lat: userPos.lat + h.dLat, lng: userPos.lng + h.dLng };
    const routes = await routesHTML(pos, userPos);
    cards.push(
      '<article class="card">' +
      '<h3>🤝 ' + escapeHtml(h.nom) + '</h3>' +
      '<p>📞 ' + escapeHtml(h.tel) + '</p>' +
      '<p>Vient vous aider — itinéraire ci-dessous :</p>' +
      '<div class="row">' +
      '<a class="btn blue" target="_blank" href="' + gmapsDir(pos, userPos) + '">Voir son trajet</a>' +
      '</div>' + routes + '</article>'
    );
  }
  box.innerHTML = cards.join("");
}

// ---------- JOURNAUX (appels / sms) ----------
function logCall(t) {
  $("callLog").innerHTML += "<p>" + escapeHtml(t) + "</p>";
}
function logSms(t) {
  $("smsLog").innerHTML += "<p>" + escapeHtml(t) + "</p>";
}
function logIncoming(m) {
  const link = userPos
    ? '<a class="t link" target="_blank" href="' + gmapsDir(userPos, m) + '">🧭 Itinéraire vers cette personne</a>'
    : "";
  $("incomingSms").innerHTML +=
    "<p><strong>" + escapeHtml(m.from) + "</strong> : " + escapeHtml(m.text) + " " + link + "</p>";
}

function startAutoCalls(centers) {
  let i = 0;
  clearInterval(callTimer);
  callTimer = setInterval(() => {
    if (state !== "active") { clearInterval(callTimer); return; }
    if (i < centers.length) {
      logCall("📞 Appel automatique → " + centers[i].nom + " (" + centers[i].tel + ")");
      i++;
    } else {
      logCall("✅ Tous les centres proches ont été appelés.");
      clearInterval(callTimer);
    }
  }, 2500);
}

function sendEmergencySMS(centers) {
  contacts.forEach(c => {
    logSms("📨 SMS envoyé à " + c.name + " (" + c.phone + ") : " +
      "\"🚨 SOS ! Ma position : " + gmapsLink(userPos) + "\"");
  });
  centers.slice(0, 2).forEach(c => {
    logSms("📨 SMS d'urgence envoyé au centre " + c.nom);
  });
}

function startFeed() {
  let i = 0;
  clearInterval(feedTimer);
  feedTimer = setInterval(() => {
    if (state !== "active") { clearInterval(feedTimer); return; }
    logIncoming(DEMO_FEED[i % DEMO_FEED.length]);
    i++;
  }, 9000);
}

// ---------- HISTORIQUE ----------
function pushHistory(entry) {
  entry.id = Date.now();
  history.unshift(entry);
  history = history.slice(0, 20);
  localStorage.setItem("sos_history", JSON.stringify(history));
  renderHistory();
}

function renderHistory() {
  const box = $("historyList");
  if (!history.length) {
    box.innerHTML = '<p class="loading">Aucune urgence enregistrée.</p>';
    return;
  }
  box.innerHTML = history.map(h => {
    const when = new Date(h.time).toLocaleString("fr-FR");
    const badge = h.status === "CANCELLED"
      ? '<span class="badge red">ANNULÉ</span>'
      : '<span class="badge green">ACTIF</span>';
    const km = userPos ? haversineKm(userPos, h) : 0;
    const min = Math.max(1, Math.round((km / 25) * 60));
    return '<article class="card">' +
      '<h3>🚨 ' + escapeHtml(h.type) + ' ' + badge + '</h3>' +
      '<p>🕐 ' + escapeHtml(when) + '</p>' +
      '<p>📍 ' + Number(h.lat).toFixed(5) + ', ' + Number(h.lng).toFixed(5) + '</p>' +
      '<p> ~' + km.toFixed(1) + ' km • ~' + min + ' min</p>' +
      '<a class="t link" target="_blank" href="' + gmapsDir(userPos || DEFAULT_POS, h) + '">🧭 Itinéraire vers ce lieu</a>' +
      '</article>';
  }).join("");
}

// ---------- CONTACTS ----------
function renderContacts() {
  const box = $("contactList");
  if (!contacts.length) {
    box.innerHTML = '<p class="loading">Aucun contact. Ajoutez-en un ci-dessus.</p>';
    return;
  }
  box.innerHTML = contacts.map((c, i) =>
    '<article class="card">' +
    '<h3>' + escapeHtml(c.name) + '</h3>' +
    '<p>' + escapeHtml(c.rel || "Contact") + ' • 📞 ' + escapeHtml(c.phone) + '</p>' +
    '<div class="row">' +
    '<a class="btn red" href="tel:' + escapeHtml(c.phone) + '">Appeler</a>' +
    '<a class="btn blue" href="sms:' + escapeHtml(c.phone) + '">SMS</a>' +
    '<button class="btn black del" data-i="' + i + '" type="button">Supprimer</button>' +
    '</div></article>'
  ).join("");

  box.querySelectorAll(".del").forEach(b => {
    b.addEventListener("click", () => {
      contacts.splice(Number(b.dataset.i), 1);
      localStorage.setItem("sos_contacts", JSON.stringify(contacts));
      renderContacts();
    });
  });
}

// ---------- IA ----------
function aiAnalyze(text) {
  const t = text.toLowerCase();
  if (/(feu|incend|fum)/.test(t)) return { type: "INCENDIE", advice: "Quittez la zone, les pompiers sont prévenus." };
  if (/(sang|bless|malade|douleur|inconscient|malaise)/.test(t)) return { type: "MEDICALE", advice: "Restez calme, un service médical est prévenu." };
  if (/(vol|attaqu|agress|menace|danger)/.test(t)) return { type: "AGRESSION", advice: "Mettez-vous en lieu sûr, la police est prévenue." };
  if (/(accident|collision|voiture|moto)/.test(t)) return { type: "ACCIDENT", advice: "Sécurisez la zone, les secours sont en route." };
  if (/(perdu|egare|perd)/.test(t)) return { type: "PERDU", advice: "Restez visible, un itinéraire vers un lieu sûr est proposé." };
  return { type: "AUTRE", advice: "Analyse terminée : aide polyvalente envoyée." };
}

// ---------- FLUX SOS ----------
function startCountdown() {
  state = "counting";
  let s = 10;
  $("countdownBox").classList.remove("hidden");
  $("countdownValue").textContent = s;
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    s--;
    $("countdownValue").textContent = s;
    if (s <= 0) {
      clearInterval(countdownTimer);
      activateSOS();
    }
  }, 1000);
}

function cancelCountdown() {
  clearInterval(countdownTimer);
  state = "idle";
  $("countdownBox").classList.add("hidden");
  pushHistory({
    type: currentType,
    time: new Date().toISOString(),
    status: "CANCELLED",
    lat: userPos.lat,
    lng: userPos.lng
  });
  alert("🛑 SOS annulé. Aucune alerte envoyée.");
}

async function activateSOS() {
  state = "active";
  $("countdownBox").classList.add("hidden");
  $("activePanel").classList.remove("hidden");
  $("callLog").innerHTML = "";
  $("smsLog").innerHTML = "";
  $("incomingSms").innerHTML = "";

  currentAlertId = Date.now();
  pushHistory({
    type: currentType,
    time: new Date().toISOString(),
    status: "ACTIVE",
    lat: userPos.lat,
    lng: userPos.lng
  });

  const centers = centersFor(currentType).slice(0, 4);
  startAutoCalls(centers);
  sendEmergencySMS(centers);
  startFeed();
  renderCenters(currentType);
  renderHelpers();
}

function cancelActive() {
  state = "idle";
  clearInterval(callTimer);
  clearInterval(feedTimer);
  $("activePanel").classList.add("hidden");
  history = history.map(h =>
    h.id === currentAlertId ? { ...h, status: "CANCELLED" } : h
  );
  localStorage.setItem("sos_history", JSON.stringify(history));
  renderHistory();
  alert("✅ Urgence annulée.");
}

async function chooseType(type) {
  currentType = type;
  $("typeModal").classList.add("hidden");
  await ensurePosition();
  startCountdown();
}

// ---------- ÉVÉNEMENTS ----------
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  renderContacts();
  renderHistory();

  $("sosButton").addEventListener("click", () => {
    $("typeModal").classList.remove("hidden");
  });

  $("closeModal").addEventListener("click", () => {
    $("typeModal").classList.add("hidden");
  });

  document.querySelectorAll(".type-btn").forEach(b => {
    b.addEventListener("click", () => chooseType(b.dataset.type));
  });

  $("aiBtn").addEventListener("click", () => {
    const txt = $("aiText").value.trim();
    if (!txt) { alert("Décrivez votre problème."); return; }
    const r = aiAnalyze(txt);
    alert("🤖 Urgence détectée : " + r.type + "\n\n" + r.advice);
    chooseType(r.type);
  });

  $("cancelCountdown").addEventListener("click", cancelCountdown);
  $("cancelActive").addEventListener("click", cancelActive);

  $("shareBtn").addEventListener("click", async () => {
    if (!userPos) { alert("Position indisponible."); return; }
    const url = gmapsLink(userPos);
    try {
      await navigator.clipboard.writeText("🚨 J'ai besoin d'aide. Ma position : " + url);
      alert("📍 Position copiée !");
    } catch (e) {
      prompt("Copiez ce lien :", url);
    }
  });

  $("contactForm").addEventListener("submit", e => {
    e.preventDefault();
    contacts.push({
      name: $("cName").value.trim(),
      phone: $("cPhone").value.trim(),
      rel: $("cRel").value.trim()
    });
    localStorage.setItem("sos_contacts", JSON.stringify(contacts));
    $("contactForm").reset();
    renderContacts();
  });
});