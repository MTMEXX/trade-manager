/* ============================================================
   PORTFOLIO ANALYZER – VERSIONE CORRETTA (Equity / Invested / Pool)
   ============================================================ */

/* --------- PARSER UTILI --------- */

function parseNum(v) {
    if (!v) return 0;
    return parseFloat(
        v.replace(/\./g, "")
         .replace(",", ".")
         .replace("€", "")
         .trim()
    );
}

function cleanAsset(a) {
    return (a || "").toString().trim().toUpperCase();
}

function parseDateIT(s) {
    const [d, m, y] = s.split("/").map(Number);
    return new Date(y, m - 1, d);
}

function diffDays(a, b) {
    return Math.round((parseDateIT(b) - parseDateIT(a)) / 86400000);
}

/* --------- LOAD CSV --------- */

document.getElementById("analyzeBtn").addEventListener("click", () => {
    const file = document.getElementById("csvFile").files[0];
    if (!file) return alert("Carica un CSV!");
    const reader = new FileReader();
    reader.onload = e => parseCSV(e.target.result);
    reader.readAsText(file, "ISO-8859-1");
});

function parseCSV(text) {
    const sep = text.includes(";") ? ";" : ",";
    const rows = text.trim().split("\n").map(r => r.split(sep));

    const headers = rows[0].map(h => h.trim());
    const trades = rows.slice(1).map(r =>
        Object.fromEntries(headers.map((h, i) => [h, r[i] ? r[i].trim() : ""]))
    );

    analyzeTrades(trades);
}

/* ============================================================
   LOGICA PRINCIPALE – Pool / Invested / Equity CORRETTI
   ============================================================ */

function analyzeTrades(trades) {

    const open = {};
    const firstBuy = {};

    let pnlRealized = 0;
    let divs = 0;
    let commissions = 0;
    let taxes = 0;

    let pool = 0;       // profitti disponibili
    let invested = 0;   // soldi MIEI immessi nel sistema

    const pnlHistory = [];
    const equityHistory = [];
    const closedPositions = [];

    function equityNow() {
        return Object.values(open).reduce((s, p) => s + p.qty * p.avg, 0);
    }

    /* ============================================================
       CICLO PRINCIPALE
       ============================================================ */
    trades.forEach(t => {

        const asset = cleanAsset(t["DESCRIZIONE"]);
        const tipo  = t["TIPOLOGIA"];
        const qty   = parseNum(t["QTA'"]);
        const amt   = parseNum(t["IMPORTO"]);
        const date  = t["DATA"];

        /* ---------------------------------------
           📌 SPESE & IMPOSTE → prima dalla pool
        ----------------------------------------*/
        if (tipo === "Competenze" || tipo === "Imposta") {
            let cost = Math.abs(amt);

            if (tipo === "Competenze") commissions += cost;
            if (tipo === "Imposta") taxes += cost;

            if (pool >= cost) {
                pool -= cost;
            } else {
                invested -= (cost - pool); // resto lo pago io
                pool = 0;
            }

            equityHistory.push({ date, equity: equityNow(), invested, pool });
            return;
        }

        /* ---------------------------------------
           📌 DIVIDENDI → interamente in Pool
        ----------------------------------------*/
        if (tipo === "Accredito dividendi") {
            divs += amt;
            pool += amt;

            pnlHistory.push({ date, value: amt });

            equityHistory.push({ date, equity: equityNow(), invested, pool });
            return;
        }

        /* ---------------------------------------
           📌 ACQUISTO TITOLI
        ----------------------------------------*/
        if (tipo === "Acquisto titoli") {

            const cashOut = Math.abs(amt);

            if (!open[asset]) open[asset] = { qty: 0, avg: 0 };
            const p = open[asset];

            /* 🔥 1) Usa prima la Pool */
            const usePool = Math.min(pool, cashOut);
            pool -= usePool;

            /* 🔥 2) se non basta → soldi miei */
            const ext = cashOut - usePool;
            invested += ext;

            /* 🔥 3) aggiorna media e quantità */
            const totalCost = p.qty * p.avg + cashOut;
            p.qty += qty;
            p.avg = totalCost / p.qty;

            if (!firstBuy[asset]) firstBuy[asset] = date;

            equityHistory.push({ date, equity: equityNow(), invested, pool });
            return;
        }

        /* ---------------------------------------
           📌 VENDITA TITOLI
        ----------------------------------------*/
        if (tipo === "Vendita titoli") {

            if (!open[asset] || open[asset].qty <= 0) {
                // niente posizione → tutto è profitto
                pool += amt;
                pnlHistory.push({ date, value: amt });
                equityHistory.push({ date, equity: equityNow(), invested, pool });
                return;
            }

            const p = open[asset];

            const sellTot = amt;           // incasso lordo
            const buyTot  = p.avg * qty;   // costo storico
            const profit  = sellTot - buyTot;

            pnlRealized += profit;
            pool += profit;

            pnlHistory.push({ date, value: profit });

            closedPositions.push({
                asset,
                qty,
                buyTotal: buyTot,
                sellTotal: sellTot,
                pnl: profit,
                holdingDays: diffDays(firstBuy[asset], date)
            });

            /* aggiorna posizione */
            p.qty -= qty;
            if (p.qty <= 0) {
                delete open[asset];
                delete firstBuy[asset];
            }

            equityHistory.push({ date, equity: equityNow(), invested, pool });
            return;
        }

        /* fallback */
        equityHistory.push({ date, equity: equityNow(), invested, pool });
    });

    const openList = Object.entries(open).map(([asset, p]) => ({
        asset,
        qty: p.qty,
        avg: p.avg,
        invested: p.qty * p.avg
    }));

    renderResults({
        pnlRealized,
        divs,
        commissions,
        taxes,
        openList,
        closedPositions,
        pnlHistory,
        equityHistory
    });
}

/* ============================================================
   RENDER RISULTATI
   ============================================================ */

function renderResults(d) {

    const box = document.getElementById("results");
    box.classList.add("visible");

    const fmt = v => v.toFixed(2);

    box.innerHTML = `
        <h2>📊 Risultati Analisi</h2>

        <p><b>PNL realizzato:</b> ${fmt(d.pnlRealized)} €</p>
        <p><b>Dividendi:</b> ${fmt(d.divs)} €</p>
        <p><b>Commissioni:</b> ${fmt(d.commissions)} €</p>
        <p><b>Imposte:</b> ${fmt(d.taxes)} €</p>

        <h3>📂 Posizioni aperte</h3>
        ${renderOpenPositions(d.openList)}

        <h3>📉 Posizioni chiuse</h3>
        ${renderClosedPositions(d.closedPositions)}

        <h3>🟣 Allocazione portafoglio</h3>
        <canvas id="pieChart"></canvas>

        <h3>🔵 PNL Storico</h3>
        <canvas id="pnlChart"></canvas>

        <h3>📈 Equity / Invested / Pool</h3>
        <canvas id="equityChart"></canvas>
    `;

    renderPieChart(d.openList);
    renderPNLChart(d.pnlHistory);
    renderEquityChart(d.equityHistory);
}

/* --------- TABELLE --------- */

function renderOpenPositions(list) {
    if (!list.length) return "<p>Nessuna posizione aperta.</p>";
    let h = `<table><tr><th>Asset</th><th>Qta</th><th>PM</th><th>Investito</th></tr>`;
    list.forEach(p => h += `
        <tr><td>${p.asset}</td><td>${p.qty}</td><td>${p.avg.toFixed(2)}</td>
        <td>${p.invested.toFixed(2)} €</td></tr>`);
    return h + "</table>";
}

function renderClosedPositions(list) {
    if (!list.length) return "<p>Nessuna posizione chiusa.</p>";
    let h = `<table><tr>
        <th>Asset</th><th>Qta</th><th>Acquisti</th><th>Vendite</th>
        <th>PNL</th><th>Holding (gg)</th>
    </tr>`;
    list.forEach(p => h += `
        <tr>
            <td>${p.asset}</td>
            <td>${p.qty}</td>
            <td>${p.buyTotal.toFixed(2)} €</td>
            <td>${p.sellTotal.toFixed(2)} €</td>
            <td style="color:${p.pnl>=0?"#22c55e":"#ef4444"}">${p.pnl.toFixed(2)} €</td>
            <td>${p.holdingDays}</td>
        </tr>
    `);
    return h + "</table>";
}

/* --------- GRAFICI --------- */

function renderPieChart(list) {
    if (!list.length) return;
    new Chart(document.getElementById("pieChart"), {
        type: "pie",
        data: {
            labels: list.map(p => p.asset),
            datasets: [{ data: list.map(p => p.invested) }]
        }
    });
}

function renderPNLChart(h) {
    new Chart(document.getElementById("pnlChart"), {
        type: "bar",
        data: {
            labels: h.map(e => e.date),
            datasets: [{
                label: "PNL assoluto",
                data: h.map(e => Math.abs(e.value)),
                backgroundColor: h.map(e => e.value >= 0 ? "#22c55e" : "#ef4444")
            }]
        }
    });
}

function renderEquityChart(h) {
    new Chart(document.getElementById("equityChart"), {
        type: "line",
        data: {
            labels: h.map(e => e.date),
            datasets: [
                {
                    label: "Equity",
                    data: h.map(e => e.equity),
                    borderColor: "#3b82f6",
                    borderWidth: 3,
                    tension: 0.2
                },
                {
                    label: "Invested (soldi tuoi)",
                    data: h.map(e => e.invested),
                    borderColor: "#22c55e",
                    borderDash: [6,6],
                    borderWidth: 3,
                    tension: 0.2
                },
                {
                    label: "Pool (profitti disponibili)",
                    data: h.map(e => e.pool),
                    borderColor: "#facc15",
                    borderWidth: 3,
                    tension: 0.2
                }
            ]
        }
    });
}
