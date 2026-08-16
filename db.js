const mysql = require("mysql2/promise");
require("dotenv").config();

//(sos_platform)
const DB_NAME = process.env.DB_NAME || "sos_platform";

let pool = null;

async function initDatabase() {
    pool = mysql.createPool({
        host: process.env.DB_HOST || "localhost",
        user: process.env.DB_USER || "root",
        password: process.env.DB_PASSWORD ?? "tsirava",
        database: DB_NAME,
        waitForConnections: true,
        connectionLimit: 10,
        charset: "utf8mb4",
        dateStrings: true
    });

    // Sécurité : crée une table UNIQUEMENT si elle n'existe pas.
    
    await createTablesIfMissing();

    // Ajoute des données de démo UNIQUEMENT si les tables sont vides.
    await seedIfEmpty();

    console.log(`✅ Connecté à la base "${DB_NAME}" (tables existantes conservées).`);
    return pool;
}

async function createTablesIfMissing() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nom VARCHAR(100) NOT NULL,
            prenom VARCHAR(100) NOT NULL,
            telephone VARCHAR(30),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS emergency_contacts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            nom VARCHAR(150) NOT NULL,
            telephone VARCHAR(50) NOT NULL,
            relation VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS emergency_centers (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nom VARCHAR(200) NOT NULL,
            type VARCHAR(50) DEFAULT 'AUTRE',
            telephone VARCHAR(50),
            adresse VARCHAR(300),
            latitude DECIMAL(10,6) NOT NULL,
            longitude DECIMAL(10,6) NOT NULL,
            disponible BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS alerts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            type VARCHAR(50) NOT NULL,
            description TEXT,
            latitude DECIMAL(10,6) NOT NULL,
            longitude DECIMAL(10,6) NOT NULL,
            priorite VARCHAR(20) DEFAULT 'ELEVEE',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS alert_cancellations (
            alert_id INT PRIMARY KEY,
            cancelled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}

async function seedIfEmpty() {
    // Utilisateur démo id=1 
    await pool.query(`
        INSERT INTO users (id, nom, prenom, telephone)
        VALUES (1, 'Demo', 'User', '+261340000000')
        ON DUPLICATE KEY UPDATE nom = VALUES(nom)
    `);


    const [rows] = await pool.query(
        "SELECT COUNT(*) AS total FROM emergency_centers"
    );

    if (Number(rows[0].total) === 0) {
        await pool.query(`
            INSERT INTO emergency_centers
            (nom, type, telephone, adresse, latitude, longitude, disponible)
            VALUES
            ('Hôpital Central','MEDICALE','+261202222649','Centre-ville',-18.9076,47.5253,1),
            ('Clinique Sainte-Famille','MEDICALE','+261202225160','Analakely',-18.9036,47.5203,1),
            ('Commissariat Central','AGRESSION','+261202220717','Centre-ville',-18.9101,47.5258,1),
            ('Brigade de Gendarmerie','AGRESSION','+261202224432','Isoraka',-18.8940,47.5150,1),
            ('Caserne des Pompiers','INCENDIE','+261202225673','Soarano',-18.9005,47.5190,1),
            ('Station d\'Ambulances','ACCIDENT','+261340000001','Analakely',-18.8980,47.5120,1),
            ('Poste de Secours Analakely','ACCIDENT','+261331111111','Marché',-18.9081,47.5234,1),
            ('Bureau Personnes Perdues','PERDU','+261202212345','Gare',-18.9020,47.5170,1)
        `);
        console.log("✅ Centres de démo ajoutés (table vide détectée).");
    }
}

function getDb() {
    if (!pool) throw new Error("Base non initialisée.");
    return pool;
}

module.exports = { initDatabase, getDb };