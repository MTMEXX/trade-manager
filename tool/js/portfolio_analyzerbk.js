/* ==========================
   PORTFOLIO ANALYZER v7.1
   ========================== */

/* === UTILS === */

// parsing numeri stile italiano: "-1.211,88 €" -> -1211.88
function parseNum(value) {
  if (!value) return 0;
  return parseFloat(
    value
      .toString()
      .replace(/\./g, "")   // separatore migliaia
      .replace(",", ".")    // virgola -> punto
      .replace("€", "")
      .trim()
  );
}

function cleanAsset(a) {
  return (a || "").toString().trim().toUpperCase();
}

// dd/mm/yyyy -> Date
function parseDateIT(str) {
  if (!str) return null;
  const [d, m, y] = str.split("/").map(Number);
  return new Date(y, m - 1, d);
}

function diffDays(start, end) {
  if (!start || !end) return null;
  const d1 = parseDateIT(start);
  const d2 = parseDateIT(end);
  if (!d1 || !d2) return null;
  return Math.round((d2 - d1) / 86400000);
}

/* === FILE LOADER === */

document.getElementById("analyzeBtn").addEventListener("click", () => {
  const file = document.getElementById("csvFile").files[0];
  if (!file) {
    alert("Carica un file CSV prima di analizzare.");
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => parseCSV(e.target.result);
  // Excel italiano: usare ISO-8859-1
  reader.readAsText(file, "ISO-8859-1");
});

function parseCSV(text) {
  const sep = text.includes(";") ? ";" : ",";
  const rows = text.trim().split("\n").map((r) => r.split(sep));

  const headers = rows[0].map((h) => h.trim());
  const trades = rows.slice(1).map((r) =>
    Object.fromEntries(headers.map((h, i) => [h, r[i] ? r[i].trim() : ""]))
  );

  analyzeTrades(trades);
}

/* ======================
   LOGICA PRINCIPALE
   ====================== */

function analyzeTrades(trades) {
  const openPositions = {};   // asset -> { qty, avg }
  const firstBuyDate = {};    // asset -> prima data acquisto

  let pnlRealized = 0;        // solo vendite
  let divReceived = 0;
  let commissions = 0;
  let taxes = 0;

  // netPNL = profitti/perdite REALIZZATI netti (trade + dividendi - costi - imposte)
  let netPNL = 0;

  let pool = 0;               // solo per PNL storico (valore derivato da netPNL)
  let investedRisk = 0;       // valore derivato

  const pnlHistory = [];      // [{date, value}]
  const equityHistory = [];   // [{date, equity, invested, pool}]
  const closedPositions = [];

  // equity = somma costo posizioni aperte
  function computeEquity() {
    return Object.values(openPositions)
      .reduce((tot, p) => tot + p.qty * p.avg, 0);
  }

  trades.forEach((t) => {
    const asset = cleanAsset(t["DESCRIZIONE"]);
    const tipo = (t["TIPOLOGIA"] || "").trim(); // Acquisto titoli / Vendita titoli / ...
    const qty = parseNum(t["QTA'"]);
    const amount = parseNum(t["IMPORTO"]);      // negativo per uscite, positivo per entrate
    const date = t["DATA"];

    /* ============================
       COSTI: COMPETENZE / IMPOSTE
       ============================ */
    if (tipo === "Competenze" || tipo === "Imposta") {
      const cost = Math.abs(amount);
      if (tipo === "Competenze") commissions += cost;
      if (tipo === "Imposta")    taxes       += cost;

      netPNL += amount;                  // amount è negativo -> riduce profitti netti
      pnlHistory.push({ date, value: amount });

      const equity = computeEquity();
      const profitAvail = Math.max(netPNL, 0);            // profitti netti ≥ 0
      const profitOnEquity = Math.min(equity, profitAvail);
      investedRisk = Math.max(equity - profitAvail, 0);   // soldi tuoi a rischio
      pool = profitAvail - profitOnEquity;                // profitti liberi

      equityHistory.push({ date, equity, invested: investedRisk, pool });
      return;
    }

    /* ============================
       DIVIDENDI
       ============================ */
    if (tipo === "Accredito dividendi") {
      divReceived += amount;   // positivo
      netPNL += amount;
      pnlHistory.push({ date, value: amount });

      const equity = computeEquity();
      const profitAvail = Math.max(netPNL, 0);
      const profitOnEquity = Math.min(equity, profitAvail);
      investedRisk = Math.max(equity - profitAvail, 0);
      pool = profitAvail - profitOnEquity;

      equityHistory.push({ date, equity, invested: investedRisk, pool });
      return;
    }

    /* ============================
       ACQUISTO TITOLI
       ============================ */
    if (tipo === "Acquisto titoli") {
      if (!openPositions[asset]) {
        openPositions[asset] = { qty: 0, avg: 0 };
      }
      const pos = openPositions[asset];
      const cost = Math.abs(amount);

      // aggiorno media prezzo
      const totalCost = pos.qty * pos.avg + cost;
      pos.qty += qty;
      pos.avg = totalCost / pos.qty;

      if (!firstBuyDate[asset]) firstBuyDate[asset] = date;

      // netPNL non cambia (nessun PNL realizzato)
      const equity = computeEquity();
      const profitAvail = Math.max(netPNL, 0);
      const profitOnEquity = Math.min(equity, profitAvail);
      investedRisk = Math.max(equity - profitAvail, 0);
      pool = profitAvail - profitOnEquity;

      equityHistory.push({ date, equity, invested: investedRisk, pool });
      return;
    }

    /* ============================
       VENDITA TITOLI
       ============================ */
    if (tipo === "Vendita titoli") {
      // se non ho posizione, tratto tutto come PNL cash (edge case)
      if (!openPositions[asset] || openPositions[asset].qty <= 0) {
        netPNL += amount;             // tutto PNL
        pnlHistory.push({ date, value: amount });

        const equity = computeEquity();
        const profitAvail = Math.max(netPNL, 0);
        const profitOnEquity = Math.min(equity, profitAvail);
        investedRisk = Math.max(equity - profitAvail, 0);
        pool = profitAvail - profitOnEquity;

        equityHistory.push({ date, equity, invested: investedRisk, pool });
        return;
      }

      const pos = openPositions[asset];
      const sellTotal = amount;          // incasso (positivo)
      const buyTotal = pos.avg * qty;    // costo storico venduto

      const realized = sellTotal - buyTotal;
      pnlRealized += realized;
      netPNL += realized;
      pnlHistory.push({ date, value: realized });

      closedPositions.push({
        asset,
        qty,
        buyTotal,
        sellTotal,
        pnl: realized,
        holdingDays: diffDays(firstBuyDate[asset], date)
      });

      // aggiorno posizione residua (media invariata)
      pos.qty -= qty;
      if (pos.qty <= 0) {
        pos.qty = 0;
        pos.avg = 0;
        firstBuyDate[asset] = null;
      }

      const equity = computeEquity();
      const profitAvail = Math.max(netPNL, 0);
      const profitOnEquity = Math.min(equity, profitAvail);
      investedRisk = Math.max(equity - profitAvail, 0);
      pool = profitAvail - profitOnEquity;

      equityHistory.push({ date, equity, invested: investedRisk, pool });
      return;
    }

    /* === fallback per righe non gestite esplicitamente === */
    const equity = computeEquity();
    const profitAvail = Math.max(netPNL, 0);
    const profitOnEquity = Math.min(equity, profitAvail);
    investedRisk = Math.max(equity - profitAvail, 0);
    pool = profitAvail - profitOnEquity;

    equityHistory.push({ date, equity, invested: investedRisk, pool });
  });

  const openList = Object.entries(openPositions)
    .filter(([_, p]) => p.qty > 0)
    .map(([asset, p]) => ({
      asset,
      qty: p.qty,
      avg: p.avg,
      invested: p.qty * p.avg
    }));

  renderResults({
    pnlRealized,
    divReceived,
    commissions,
    taxes,
    openList,
    closedPositions,
    pnlHistory,
    equityHistory
  });
}

/* =========================
   RENDER RISULTATI HTML
   ========================= */

function renderResults(d) {
  const card = document.getElementById("results");
  card.classList.add("visible");

  const fmt = (v) => (isFinite(v) ? v.toFixed(2) : "-");

  card.innerHTML = `
    <h2>📊 Risultati Analisi</h2>

    <p><b>PNL realizzato (vendite):</b> ${fmt(d.pnlRealized)} €</p>
    <p><b>Dividendi ricevuti:</b> ${fmt(d.divReceived)} €</p>
    <p><b>Commissioni / competenze:</b> ${fmt(d.commissions)} €</p>
    <p><b>Imposte totali:</b> ${fmt(d.taxes)} €</p>

    <h3>📂 Posizioni aperte</h3>
    ${renderOpenPositions(d.openList)}

    <h3>📉 Posizioni chiuse</h3>
    ${renderClosedPositions(d.closedPositions)}

    <h3>🟣 Allocazione portafoglio (posizioni aperte)</h3>
    <canvas id="pieChart" height="200"></canvas>

    <h3>🔵 PNL Storico (per evento)</h3>
    <canvas id="pnlChart" height="200"></canvas>

    <h3>📈 Equity / Invested / Pool</h3>
    <p class="small-note">
      Equity = capitale attualmente investito in posizioni (al costo).<br>
      Invested (soldi tuoi a rischio) = max(equity − profitti netti disponibili, 0).<br>
      Pool = profitti netti disponibili non utilizzati per coprire il rischio (liberi).
    </p>
    <canvas id="equityChart" height="220"></canvas>
  `;

  renderPieChart(d.openList);
  renderPNLChart(d.pnlHistory);
  renderEquityChart(d.equityHistory);
}

/* =========================
   TABELLE
   ========================= */

function renderOpenPositions(list) {
  if (!list.length) return "<p>Nessuna posizione aperta.</p>";

  let h = `<table>
    <tr><th>Asset</th><th>Qta</th><th>PM</th><th>Investito</th></tr>`;
  list.forEach((p) => {
    h += `<tr>
      <td>${p.asset}</td>
      <td>${p.qty}</td>
      <td>${p.avg.toFixed(2)}</td>
      <td>${p.invested.toFixed(2)} €</td>
    </tr>`;
  });
  return h + "</table>";
}

function renderClosedPositions(list) {
  if (!list.length) return "<p>Nessuna posizione chiusa.</p>";

  let h = `<table>
    <tr>
      <th>Asset</th>
      <th>Qta</th>
      <th>Tot. Acquisti</th>
      <th>Tot. Vendite</th>
      <th>PNL</th>
      <th>Holding (gg)</th>
    </tr>`;
  list.forEach((p) => {
    h += `<tr>
      <td>${p.asset}</td>
      <td>${p.qty}</td>
      <td>${p.buyTotal.toFixed(2)} €</td>
      <td>${p.sellTotal.toFixed(2)} €</td>
      <td style="color:${p.pnl >= 0 ? "#22c55e" : "#ef4444"}">${p.pnl.toFixed(2)} €</td>
      <td>${p.holdingDays ?? "-"}</td>
    </tr>`;
  });
  return h + "</table>";
}

/* =========================
   GRAFICI
   ========================= */

function renderPieChart(list) {
  if (!list.length) return;
  new Chart(document.getElementById("pieChart"), {
    type: "pie",
    data: {
      labels: list.map((p) => p.asset),
      datasets: [{ data: list.map((p) => p.invested) }]
    }
  });
}

// PNL con barre verdi/rosse (valore assoluto)
function renderPNLChart(hist) {
  if (!hist.length) return;
  new Chart(document.getElementById("pnlChart"), {
    type: "bar",
    data: {
      labels: hist.map((e) => e.date),
      datasets: [{
        label: "PNL per evento (assoluto)",
        data: hist.map((e) => Math.abs(e.value)),
        backgroundColor: hist.map((e) =>
          e.value >= 0 ? "#22c55e" : "#ef4444"
        )
      }]
    }
  });
}

// Equity / Invested / Pool
function renderEquityChart(hist) {
  if (!hist.length) return;
  new Chart(document.getElementById("equityChart"), {
    type: "line",
    data: {
      labels: hist.map((e) => e.date),
      datasets: [
        {
          label: "Equity",
          data: hist.map((e) => e.equity),
          borderColor: "#38bdf8",
          borderWidth: 2,
          tension: 0.25
        },
        {
          label: "Invested (soldi tuoi a rischio)",
          data: hist.map((e) => e.invested),
          borderColor: "#22c55e",
          borderDash: [4, 4],
          borderWidth: 2,
          tension: 0.25
        },
        {
          label: "Pool (profitti disponibili)",
          data: hist.map((e) => e.pool),
          borderColor: "#facc15",
          borderWidth: 2,
          tension: 0.25
        }
      ]
    }
  });
}
