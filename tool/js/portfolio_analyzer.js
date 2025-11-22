/* ==========================
   PORTFOLIO ANALYZER v5.0
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

/* ======================
   LOGICA DI ANALISI
   ====================== */

function analyzeTrades(trades) {
  const openPositions = {};
  const firstBuyDateByAsset = {};

  let pnlRealized = 0;
  let divReceived = 0;
  let commissions = 0;
  let taxes = 0;

  const pnlHistory = [];
  const equityHistory = [];

  let equity = 0;
  const closedPositions = [];

  trades.forEach(t => {
    const asset = cleanAsset(t["DESCRIZIONE"]);
    const tipo = (t["TIPOLOGIA"] || "").trim();
    const qty = parseNum(t["QTA'"]);
    const amount = parseNum(t["IMPORTO"]);
    const date = t["DATA"];

    /* === COMPETENZE === */
    if (tipo === "Competenze") {
      commissions += Math.abs(amount);
      equity += amount;  // negativo → scende
      equityHistory.push({ date, value: equity });
      return;
    }

    /* === IMPOSTE === */
    if (tipo === "Imposta") {
      taxes += Math.abs(amount);
      equity += amount;  // negativo → scende
      equityHistory.push({ date, value: equity });
      return;
    }

    /* === DIVIDENDI === */
    if (tipo === "Accredito dividendi") {
      divReceived += amount;

      pnlHistory.push({ date, value: amount });

      equity += amount; // sale
      equityHistory.push({ date, value: equity });

      return;
    }

    /* === ACQUISTO === */
    if (tipo === "Acquisto titoli") {
      if (!openPositions[asset]) openPositions[asset] = { qty: 0, avg: 0 };

      const pos = openPositions[asset];
      const newCost = Math.abs(amount);

      const totalCost = pos.qty * pos.avg + newCost;
      pos.qty += qty;
      pos.avg = totalCost / pos.qty;

      if (!firstBuyDateByAsset[asset]) firstBuyDateByAsset[asset] = date;

      equity += amount;           // negativo → equity scende
      equityHistory.push({ date, value: equity });

      return;
    }

    /* === VENDITA === */
    if (tipo === "Vendita titoli") {
      if (!openPositions[asset] || openPositions[asset].qty <= 0) {
        // Edge case
        pnlHistory.push({ date, value: Math.abs(amount) });
        equity += amount;
        equityHistory.push({ date, value: equity });
        return;
      }

      const pos = openPositions[asset];
      const sellTotal = amount;          // amount positivo
      const buyTotal = pos.avg * qty;
      const realized = sellTotal - buyTotal;

      pnlHistory.push({
        date,
        value: realized >= 0 ? realized : Math.abs(realized),   // 🔥 valore assoluto
        negative: realized < 0
      });

      pnlRealized += realized;

      const holding = diffDays(firstBuyDateByAsset[asset], date);

      closedPositions.push({
        asset,
        qty,
        buyTotal,
        sellTotal,
        pnl: realized,
        holdingDays: holding
      });

      pos.qty -= qty;
      if (pos.qty <= 0) {
        pos.qty = 0;
        pos.avg = 0;
        firstBuyDateByAsset[asset] = null;
      }

      /*  
        🔥 EQUITY = saldo del conto
        → La vendita aggiunge TUTTI i soldi incassati (sellTotal)
      */
      equity += sellTotal;
      equityHistory.push({ date, value: equity });

      return;
    }
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
   RENDER
   ========================= */

function renderResults(d) {
  const card = document.getElementById("results");
  card.classList.add("visible");

  const fmt = (v) => (isFinite(v) ? v.toFixed(2) : "-");

  let html = `
    <h2>📊 Risultati Analisi</h2>

    <p><b>PNL realizzato:</b> ${fmt(d.pnlRealized)} €</p>
    <p><b>Dividendi ricevuti:</b> ${fmt(d.divReceived)} €</p>
    <p><b>Commissioni / competenze:</b> ${fmt(d.commissions)} €</p>
    <p><b>Imposte totali:</b> ${fmt(d.taxes)} €</p>

    <h3>📂 Posizioni aperte</h3>
    ${renderOpenPositions(d.openList)}

    <h3>📉 Posizioni chiuse</h3>
    ${renderClosedPositions(d.closedPositions)}

    <h3>🟣 Allocazione portafoglio</h3>
    <canvas id="pieChart" height="200"></canvas>

    <h3>🔵 PNL Storico</h3>
    <canvas id="pnlChart" height="200"></canvas>

    <h3>🟢 Equity del conto nel tempo</h3>
    <canvas id="equityChart" height="200"></canvas>
  `;

  card.innerHTML = html;

  renderPieChart(d.openList);
  renderPNLChart(d.pnlHistory);
  renderEquityChart(d.equityHistory);
}

/* === TABELLE === */

function renderOpenPositions(list) {
  if (!list.length) return "<p>Nessuna posizione aperta.</p>";

  let html = `
    <table>
      <tr>
        <th>Asset</th>
        <th>Qta</th>
        <th>PM</th>
        <th>Investito</th>
      </tr>
  `;

  list.forEach((p) => {
    html += `
      <tr>
        <td>${p.asset}</td>
        <td>${p.qty}</td>
        <td>${p.avg.toFixed(2)}</td>
        <td>${p.invested.toFixed(2)} €</td>
      </tr>`;
  });

  return html + "</table>";
}

function renderClosedPositions(list) {
  if (!list.length) return "<p>Nessuna posizione chiusa.</p>";

  let html = `
    <table>
      <tr>
        <th>Asset</th>
        <th>Qta</th>
        <th>Tot. Acquisti</th>
        <th>Tot. Vendite</th>
        <th>PNL</th>
        <th>Holding (gg)</th>
      </tr>
  `;

  list.forEach((p) => {
    html += `
      <tr>
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

  return html + "</table>";
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
      datasets: [{ data: list.map((p) => p.invested) }],
    },
  });
}

/* === PNL BAR VERDE/ROSSA IN ALTO === */
function renderPNLChart(history) {
  if (!history.length) return;

  new Chart(document.getElementById("pnlChart"), {
    type: "bar",
    data: {
      labels: history.map((h) => h.date),
      datasets: [
        {
          data: history.map((h) => h.value), // always positive height
          backgroundColor: history.map((h) =>
            h.negative ? "#ef4444" : "#22c55e"
          ),
        },
      ],
    },
    options: {
      scales: {
        y: {
          beginAtZero: true,
        },
      },
    },
  });
}

/* === EQUITY LINE === */
function renderEquityChart(history) {
  if (!history.length) return;

  new Chart(document.getElementById("equityChart"), {
    type: "line",
    data: {
      labels: history.map((e) => e.date),
      datasets: [
        {
          label: "Equity del conto",
          data: history.map((e) => e.value),
          borderColor: "#38bdf8",
          borderWidth: 2,
        },
      ],
    },
  });
}
