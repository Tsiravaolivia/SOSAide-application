const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const { initDatabase, getDb } = require("./db");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));


// HELPERS


function toNumber(v) {
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function distanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const s = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function centersMatch(type, emergencyType) {
    const c = String(type || "").toUpperCase();
    if (emergencyType === "MEDICALE") return /MED|HOP|CLIN|AMBUL|SANTE/.test(c);
    if (emergencyType === "AGRESSION") return /POLICE|GEND|SECUR/.test(c);
    if (emergencyType === "INCENDIE") return /POMPI|FIRE|INCEND/.test(c);
    if (emergencyType === "ACCIDENT") return /MED|HOP|AMBUL|POLICE|GEND|SECOUR/.test(c);
    if (emergencyType === "PERDU") return /PERDU|POLICE|GEND|SOCIAL/.test(c);
    return true;
}


// TEST


app.get("/api/test", async (req, res) => {
    try {
        await getDb().query("SELECT 1");
        res.json({ success: true, message: "Serveur SOS OK", database: "connectée" });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});


// CONTACTS


app.get("/api/contacts/:userId", async (req, res) => {
    try {
        const [rows] = await getDb().query(`
            SELECT id, user_id, nom, telephone, relation
            FROM emergency_contacts
            WHERE user_id = ?
            ORDER BY id DESC
        `, [toNumber(req.params.userId)]);

        res.json({ success: true, contacts: rows });
    } catch (e) {
        res.status(500).json({ success: false, message: "Erreur contacts." });
    }
});

app.post("/api/contacts", async (req, res) => {
    try {
        const userId = toNumber(req.body.user_id);
        const nom = String(req.body.nom || "").trim();
        const telephone = String(req.body.telephone || "").replace(/[^\d+]/g, "");
        const relation = String(req.body.relation || "").trim();

        if (!userId || nom.length < 2 || telephone.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Nom et numéro obligatoires."
            });
        }

        const [r] = await getDb().query(`
            INSERT INTO emergency_contacts (user_id, nom, telephone, relation)
            VALUES (?, ?, ?, ?)
        `, [userId, nom, telephone, relation]);

        res.status(201).json({
            success: true,
            contact_id: r.insertId,
            message: "✅ Contact ajouté."
        });
    } catch (e) {
        res.status(500).json({ success: false, message: "Ajout impossible." });
    }
});

app.delete("/api/contacts/:id", async (req, res) => {
    try {
        const [r] = await getDb().query(
            "DELETE FROM emergency_contacts WHERE id = ?",
            [toNumber(req.params.id)]
        );

        if (!r.affectedRows) {
            return res.status(404).json({ success: false, message: "Contact introuvable." });
        }

        res.json({ success: true, message: "Contact supprimé." });
    } catch (e) {
        res.status(500).json({ success: false, message: "Suppression impossible." });
    }
});


// CENTRES (selon urgence + distance)

app.get("/api/centers", async (req, res) => {
    try {
        const lat = toNumber(req.query.lat);
        const lng = toNumber(req.query.lng);
        const type = String(req.query.type || "AUTRE").toUpperCase();

        const [rows] = await getDb().query(`
            SELECT id, nom, type, telephone, adresse, latitude, longitude
            FROM emergency_centers
            WHERE disponible = 1
        `);

        let centers = rows
            .filter(c => centersMatch(c.type, type))
            .map(c => ({
                ...c,
                latitude: Number(c.latitude),
                longitude: Number(c.longitude)
            }));

        if (lat !== null && lng !== null) {
            centers = centers
                .map(c => ({
                    ...c,
                    distanceKm: Number(
                        distanceKm(lat, lng, c.latitude, c.longitude).toFixed(2)
                    )
                }))
                .sort((a, b) => a.distanceKm - b.distanceKm);
        }

        res.json({ success: true, centers: centers.slice(0, 6) });
    } catch (e) {
        res.status(500).json({ success: false, message: "Erreur centres." });
    }
});


// AIDANTS (démo, selon position)
app.get("/api/helpers", (req, res) => {
    const lat = toNumber(req.query.lat);
    const lng = toNumber(req.query.lng);

    if (lat === null || lng === null) {
        return res.json({ success: true, helpers: [] });
    }

    res.json({
        success: true,
        helpers: [
            { nom: "Jean (volontaire)", tel: "+261341122334", latitude: lat + 0.004, longitude: lng + 0.002 },
            { nom: "Marie (voisine)", tel: "+261339988776", latitude: lat - 0.003, longitude: lng - 0.004 },
            { nom: "Fetra (motard)", tel: "+261325544332", latitude: lat + 0.006, longitude: lng - 0.002 }
        ]
    });
});

// ALERTES SOS

app.post("/api/alerts", async (req, res) => {
    try {
        const userId = toNumber(req.body.user_id);
        const type = String(req.body.type || "AUTRE").toUpperCase();
        const description = String(req.body.description || "").trim().slice(0, 2000);
        const latitude = toNumber(req.body.latitude);
        const longitude = toNumber(req.body.longitude);

        if (!userId || latitude === null || longitude === null) {
            return res.status(400).json({
                success: false,
                message: "Informations incomplètes."
            });
        }

        const [r] = await getDb().query(`
            INSERT INTO alerts (user_id, type, description, latitude, longitude, priorite)
            VALUES (?, ?, ?, ?, ?, 'ELEVEE')
        `, [userId, type, description, latitude, longitude]);

        res.status(201).json({
            success: true,
            alert_id: r.insertId,
            message: "🚨 Alerte enregistrée."
        });
    } catch (e) {
        res.status(500).json({ success: false, message: "Création d'alerte impossible." });
    }
});

app.get("/api/alerts", async (req, res) => {
    try {
        const [rows] = await getDb().query(`
            SELECT
                a.*,
                CASE
                    WHEN c.alert_id IS NULL THEN 'ACTIVE'
                    ELSE 'CANCELLED'
                END AS status
            FROM alerts a
            LEFT JOIN alert_cancellations c ON a.id = c.alert_id
            ORDER BY a.created_at DESC
            LIMIT 20
        `);

        res.json({ success: true, alerts: rows });
    } catch (e) {
        res.status(500).json({ success: false, message: "Erreur historique." });
    }
});

app.post("/api/alerts/:id/cancel", async (req, res) => {
    try {
        const id = toNumber(req.params.id);

        const [alerts] = await getDb().query(
            "SELECT id FROM alerts WHERE id = ?", [id]
        );

        if (!alerts.length) {
            return res.status(404).json({ success: false, message: "Alerte introuvable." });
        }

        await getDb().query(`
            INSERT INTO alert_cancellations (alert_id, cancelled_at)
            VALUES (?, NOW())
            ON DUPLICATE KEY UPDATE cancelled_at = NOW()
        `, [id]);

        res.json({ success: true, message: "🛑 SOS annulé." });
    } catch (e) {
        res.status(500).json({ success: false, message: "Annulation impossible." });
    }
});


// IA (analyse locale, mode démo)

app.post("/api/ai/analyze", (req, res) => {
    const t = String(req.body.description || "").toLowerCase();

    let type = "AUTRE";
    let advice = "Analyse terminée : aide polyvalente envoyée.";

    if (/(feu|incend|fum)/.test(t)) { type = "INCENDIE"; advice = "Quittez la zone, les pompiers sont prévenus."; }
    else if (/(sang|bless|malade|douleur|inconscient|malaise)/.test(t)) { type = "MEDICALE"; advice = "Restez calme, un service médical est prévenu."; }
    else if (/(vol|attaqu|agress|menace|danger)/.test(t)) { type = "AGRESSION"; advice = "Mettez-vous en lieu sûr, la police est prévenue."; }
    else if (/(accident|collision|voiture|moto)/.test(t)) { type = "ACCIDENT"; advice = "Sécurisez la zone, les secours sont en route."; }
    else if (/(perdu|egare|perd)/.test(t)) { type = "PERDU"; advice = "Restez visible, un itinéraire vers un lieu sûr est proposé."; }

    res.json({ success: true, type, urgency: "ELEVEE", advice });
});



function listenWithFallback(port, tries = 3) {
    const server = app.listen(port, () => {
        console.log("------------------------------------");
        console.log("🚨 SOS HELP — serveur + base de données");
        console.log(`✅ http://localhost:${port}`);
        console.log("------------------------------------");
    });

    server.on("error", err => {
        if (err.code === "EADDRINUSE" && tries > 0) {
            console.warn(`⚠️ Port ${port} déjà occupé → essai sur ${port + 1}`);
            listenWithFallback(port + 1, tries - 1);
        } else {
            console.error("❌ Impossible de démarrer :", err.message);
            process.exit(1);
        }
    });
}

async function start() {
    try {
        await initDatabase();
        listenWithFallback(Number(process.env.PORT || 3000));
    } catch (e) {
        console.error("❌ Erreur de démarrage (vérifie MySQL et .env) :", e.message);
        process.exit(1);
    }
}

start();