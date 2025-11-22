/* ==========================
   PORTFOLIO ANALYZER v7.0
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
  return Math.round((parseDateIT(end) - parseDateIT(start)) / 86400000);
}

/* === FILE LOADER === */

document.getElementById("analyzeBtn").addEventListener("click", () => {
  const file = document.getElementById("csvFile").files[0];
  if (!file) return alert("Carica un CSV!");
  const reader = new FileReader();
  reader.onload = (e) => parseCSV(e.target.result);
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

  let pool = 0;       // 🔥 pool VISIBILE nel grafico (solo profitti-dividendi-spese)
  let invested = 0;   // 🔥 soldi esterni REALI immessi nel sistema

  const pnlHistory = [];
  const equityHistory = [];
  const closedPositions = [];

  function computeEquity() {
    return Object.values(openPositions)
      .reduce((tot, p) => tot + p.qty * p.avg, 0);
  }

  /* === CICLO PRINCIPALE === */

  trades.forEach(t => {
    const asset = cleanAsset(t["DESCRIZIONE"]);
    const tipo = t["TIPOLOGIA"].trim();
    const qty = parseNum(t["QTA'"]);
    const amount = parseNum(t["IMPORTO"]);
    const date = t["DATA"];

    /* ============================
       📌 COMPETENZE / IMPOSTE
       ============================ */
    if (tipo === "Competenze" || tipo === "Imposta") {
      let cost = Math.abs(amount);
      if (tipo === "Competenze") commissions += cost;
      if (tipo === "Imposta") taxes += cost;

      if (pool >= cost) {
        pool -= cost;
      } else {
        const extra = cost - pool;
        pool = 0;
        invested -= extra;   // paghi tu la parte eccedente
      }

      equityHistory.push({
        date,
        equity: computeEquity(),
        invested,
        pool
      });
      return;
    }

    /* ============================
       📌 DIVIDENDI
       ============================ */
    if (tipo === "Accredito dividendi") {
      divReceived += amount;
      pool += amount;

      pnlHistory.push({ date, value: amount });

      equityHistory.push({
        date,
        equity: computeEquity(),
        invested,
        pool
      });
      return;
    }

    /* ============================
       📌 ACQUISTO
       ============================ */
    if (tipo === "Acquisto titoli") {

      if (!openPositions[asset]) openPositions[asset] = { qty: 0, avg: 0 };
      const pos = openPositions[asset];

      const cashOut = Math.abs(amount);

      // usa prima la pool
      const fromPool = Math.min(pool, cashOut);
      pool -= fromPool;

      // differenza pagata con i TUOI soldi → aumenta invested
      const fromExternal = cashOut - fromPool;
      invested += fromExternal;

      // aggiorna media
      const totalCost = pos.qty * pos.avg + cashOut;
      pos.qty += qty;
      pos.avg = totalCost / pos.qty;

      if (!firstBuyDate[asset]) firstBuyDate[asset] = date;

      equityHistory.push({
        date,
        equity: computeEquity(),
        invested,
        pool
      });
      return;
    }

    /* ============================
       📌 VENDITA
       ============================ */
    if (tipo === "Vendita titoli") {

      // se non ho posizione → considero tutto PNL diretto
      if (!openPositions[asset] || openPositions[asset].qty <= 0) {
        pool += amount;
        pnlHistory.push({ date, value: amount });

        equityHistory.push({
          date,
          equity: computeEquity(),
          invested,
          pool
        });
        return;
      }

      const pos = openPositions[asset];

      const sellTotal = amount;          // incasso
      const buyTotal = pos.avg * qty;    // costo storico
      const realized = sellTotal - buyTotal;

      pnlRealized += realized;
      pool += realized;

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

      equityHistory.push({
        date,
        equity: computeEquity(),
        invested,
        pool
      });
      return;
    }

    /* === fallback === */
    equityHistory.push({
      date,
      equity: computeEquity(),
      invested,
      pool
    });
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

  const fmt = v => (isFinite(v) ? v.toFixed(2) : "-");

  card.innerHTML = `
    <h2>📊 Risultati Analisi</h2>

    <p><b>PNL realizzato:</b> ${fmt(d.pnlRealized)} €</p>
    <p><b>Dividendi:</b> ${fmt(d.divReceived)} €</p>
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

/* =========================
   TABELLE
   ========================= */

function renderOpenPositions(list) {
  if (!list.length) return "<p>Nessuna posizione aperta.</p>";
  let h = `<table><tr><th>Asset</th><th>Qta</th><th>PM</th><th>Investito</th></tr>`;
  list.forEach(p => {
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
  let h = `<table><tr>
    <th>Asset</th><th>Qta</th><th>Acquisti</th><th>Vendite</th><th>PNL</th><th>Holding (gg)</th>
  </tr>`;
  list.forEach(p => {
    h += `<tr>
      <td>${p.asset}</td>
      <td>${p.qty}</td>
      <td>${p.buyTotal.toFixed(2)} €</td>
      <td>${p.sellTotal.toFixed(2)} €</td>
      <td style="color:${p.pnl>=0?"#22c55e":"#ef4444"}">${p.pnl.toFixed(2)} €</td>
      <td>${p.holdingDays}</td>
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
      labels: list.map(p => p.asset),
      datasets: [{ data: list.map(p => p.invested) }]
    }
  });
}

function renderPNLChart(h) {
  if (!h.length) return;
  new Chart(document.getElementById("pnlChart"), {
    type: "bar",
    data: {
      labels: h.map(e => e.date),
      datasets: [{
        label: "PNL (assoluto)",
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
          borderColor: "#38bdf8",
          borderWidth: 2,
          tension: .2
        },
        {
          label: "Invested (soldi tuoi)",
          data: h.map(e => e.invested),
          borderColor: "#22c55e",
          borderDash: [4,4],
          borderWidth: 2,
          tension: .2
        },
        {
          label: "Pool (profitti disponibili)",
          data: h.map(e => e.pool),
          borderColor: "#facc15",
          borderWidth: 2,
          tension: .2
        }
      ]
    }
  });
}
