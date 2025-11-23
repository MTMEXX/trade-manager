/* ==========================
   PORTFOLIO ANALYZER v8.0
   Pool = Equity – Invested (differenza diretta)
   ========================== */

/* === UTILS === */

function parseNum(value) {
  if (!value) return 0;
  return parseFloat(
    value
      .toString()
      .replace(/\./g, "")
      .replace(",", ".")
      .replace("€", "")
      .trim()
  );
}

function cleanAsset(a) {
  return (a || "").toString().trim().toUpperCase();
}

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
  const openPositions = {};
  const firstBuyDate = {};

  let pnlRealized = 0;
  let divReceived = 0;
  let commissions = 0;
  let taxes = 0;
  let netPNL = 0;

  // serie dei grafici
  let investedRisk = 0;

  const pnlHistory = [];
  const equityHistory = [];
  const closedPositions = [];

  function computeEquity() {
    return Object.values(openPositions)
      .reduce((tot, p) => tot + p.qty * p.avg, 0);
  }

  function updateSeries(date, netPNL) {
    const equity = computeEquity();

    // Invested = equity - profitti netti (MAI sotto 0)
    investedRisk = Math.max(equity - Math.max(netPNL, 0), 0);

    // Pool = differenza: EQUITY – INVESTED (può essere negativa o positiva)
    const pool = equity - investedRisk;

    equityHistory.push({ date, equity, invested: investedRisk, pool });
  }

  trades.forEach((t) => {
    const asset = cleanAsset(t["DESCRIZIONE"]);
    const tipo = (t["TIPOLOGIA"] || "").trim();
    const qty = parseNum(t["QTA'"]);
    const amount = parseNum(t["IMPORTO"]);
    const date = t["DATA"];

    /* === COSTI: competenze / imposte === */
    if (tipo === "Competenze" || tipo === "Imposta") {
      const cost = Math.abs(amount);

      if (tipo === "Competenze") commissions += cost;
      if (tipo === "Imposta") taxes += cost;

      netPNL += amount; // negativo
      pnlHistory.push({ date, value: amount });

      updateSeries(date, netPNL);
      return;
    }

    /* === DIVIDENDI === */
    if (tipo === "Accredito dividendi") {
      divReceived += amount;
      netPNL += amount; // positivo
      pnlHistory.push({ date, value: amount });

      updateSeries(date, netPNL);
      return;
    }

    /* === ACQUISTO === */
    if (tipo === "Acquisto titoli") {
      if (!openPositions[asset]) openPositions[asset] = { qty: 0, avg: 0 };
      const pos = openPositions[asset];

      const cost = Math.abs(amount);

      const tot = pos.qty * pos.avg + cost;
      pos.qty += qty;
      pos.avg = tot / pos.qty;

      if (!firstBuyDate[asset]) firstBuyDate[asset] = date;

      updateSeries(date, netPNL);
      return;
    }

    /* === VENDITA === */
    if (tipo === "Vendita titoli") {
      const pos = openPositions[asset];

      if (!pos || pos.qty <= 0) {
        // vendita senza posizione (errore broker)
        netPNL += amount;
        pnlHistory.push({ date, value: amount });

        updateSeries(date, netPNL);
        return;
      }

      const sellTotal = amount;
      const buyTotal = pos.avg * qty;
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

      pos.qty -= qty;
      if (pos.qty <= 0) {
        pos.qty = 0;
        pos.avg = 0;
        firstBuyDate[asset] = null;
      }

      updateSeries(date, netPNL);
      return;
    }

    updateSeries(date, netPNL);
  });

  /* Posizioni aperte finali */
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

    <h3>🔵 PNL Storico</h3>
    <canvas id="pnlChart" height="200"></canvas>

    <h3>📈 Equity / Invested / Pool</h3>
    <canvas id="equityChart" height="230"></canvas>
  `;

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
    <tr><th>Asset</th><th>Qta</th><th>Tot. Acquisti</th><th>Tot. Vendite</th><th>PNL</th><th>Holding (gg)</th></tr>`;
  list.forEach((p) => {
    h += `<tr>
      <td>${p.asset}</td>
      <td>${p.qty}</td>
      <td>${p.buyTotal.toFixed(2)} €</td>
      <td>${p.sellTotal.toFixed(2)} €</td>
      <td style="color:${p.pnl >= 0 ? "#22c55e" : "#ef4444"}">${p.pnl.toFixed(
        2
      )} €</td>
      <td>${p.holdingDays ?? "-"}</td>
    </tr>`;
  });
  return h + "</table>";
}

/* =========================
   GRAFICI
   ========================= */

function renderPNLChart(hist) {
  if (!hist.length) return;
  new Chart(document.getElementById("pnlChart"), {
    type: "bar",
    data: {
      labels: hist.map((e) => e.date),
      datasets: [
        {
          label: "PNL (assoluto)",
          data: hist.map((e) => Math.abs(e.value)),
          backgroundColor: hist.map((e) =>
            e.value >= 0 ? "#22c55e" : "#ef4444"
          )
        }
      ]
    }
  });
}

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
          label: "Pool (equity - invested)",
          data: hist.map((e) => e.pool),
          borderColor: "#facc15",
          borderWidth: 2,
          tension: 0.25
        }
      ]
    }
  });
}
