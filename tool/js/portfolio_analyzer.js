/* ==========================
   PORTFOLIO ANALYZER v2.0
   ========================== */

/* === UTILS === */
function parseNum(value) {
  if (!value) return 0;
  return parseFloat(
    value.replace(/\./g, "").replace(",", ".").replace("€", "").trim()
  );
}

function cleanAsset(a) {
  return a.trim().toUpperCase();
}

/* === LOAD CSV === */
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

  let closedPositions = [];
  let openPositions = {};

  let pnlRealized = 0;
  let divReceived = 0;
  let commissions = 0;
  let taxes = 0;

  let pnlHistory = []; // per grafico

  trades.forEach(t => {
    const asset = cleanAsset(t["DESCRIZIONE"]);
    const mov = t["MOVIMENTO"].toUpperCase();      // Entrata/Uscita
    const type = t["TIPOLOGIA"];                   // Acquisto/Vendita/Dividendi/etc
    const qty = parseNum(t["QTA'"]);
    const amount = parseNum(t["IMPORTO"]);
    const date = t["DATA"];

    // Inizializza asset
    if (!openPositions[asset]) {
      openPositions[asset] = { qty: 0, avg: 0 };
    }

    /* === COMPETENZE / IMPOSTE === */
    if (type === "Competenze") {
      commissions += Math.abs(amount);
      return;
    }

    if (type === "Imposta") {
      taxes += Math.abs(amount);
      return;
    }

    /* === DIVIDENDI === */
    if (type === "Accredito dividendi") {
      divReceived += amount;
      pnlHistory.push({ date, value: amount });
      return;
    }

    /* === ACQUISTO TITOLI === */
    if (type === "Acquisto titoli") {
      const pos = openPositions[asset];
      const totalCost = pos.qty * pos.avg + Math.abs(amount);
      pos.qty += qty;
      pos.avg = totalCost / pos.qty;
      return;
    }

    /* === VENDITA TITOLI === */
    if (type === "Vendita titoli") {
      const pos = openPositions[asset];

      const sellQty = qty;
      const realized = (Math.abs(amount) - sellQty * pos.avg);

      pnlRealized += realized;
      pnlHistory.push({ date, value: realized });

      closedPositions.push({
        asset,
        qty: sellQty,
        buyPrice: pos.avg,
        sellTotal: Math.abs(amount),
        pnl: realized,
        date
      });

      pos.qty -= sellQty;
      if (pos.qty <= 0) pos.avg = 0;

      return;
    }
  });

  /* === COSTRUISCI LISTA POSIZIONI APERTE === */
  const openList = Object.entries(openPositions)
    .filter(([a, p]) => p.qty > 0)
    .map(([a, p]) => ({
      asset: a,
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
    pnlHistory
  });
}

/* =========================
   RENDER RISULTATI
   ========================= */
function renderResults(d) {
  const card = document.getElementById("results");
  card.classList.add("visible");

  let html = `
    <h2>📊 Risultati Analisi</h2>

    <p><b>PNL Realizzato:</b> ${d.pnlRealized.toFixed(2)} €</p>
    <p><b>Dividendi ricevuti:</b> ${d.divReceived.toFixed(2)} €</p>
    <p><b>Commissioni totali:</b> ${d.commissions.toFixed(2)} €</p>
    <p><b>Imposte:</b> ${d.taxes.toFixed(2)} €</p>

    <h3>📂 Posizioni Aperte</h3>
  `;

  /* === TABELLA POSIZIONI APERTE === */
  html += `
    <table>
      <tr>
        <th>Asset</th>
        <th>Qta</th>
        <th>Prezzo Medio</th>
        <th>Valore Investito</th>
      </tr>
  `;
  d.openList.forEach(p => {
    html += `
      <tr>
        <td>${p.asset}</td>
        <td>${p.qty}</td>
        <td>${p.avg.toFixed(2)}</td>
        <td>${p.invested.toFixed(2)} €</td>
      </tr>
    `;
  });
  html += `</table>`;

  /* === POSIZIONI CHIUSE === */
  html += `
    <h3>📉 Posizioni Chiuse</h3>
  `;
  if (d.closedPositions.length === 0) {
    html += "<p>Nessuna posizione chiusa.</p>";
  } else {
    html += `
      <table>
        <tr>
          <th>Asset</th>
          <th>Qta</th>
          <th>Prezzo Medio Acquisto</th>
          <th>Totale Vendita</th>
          <th>PNL</th>
          <th>Data</th>
        </tr>
    `;

    d.closedPositions.forEach(p => {
      html += `
        <tr>
          <td>${p.asset}</td>
          <td>${p.qty}</td>
          <td>${p.buyPrice.toFixed(2)}</td>
          <td>${p.sellTotal.toFixed(2)}</td>
          <td style="color:${p.pnl >= 0 ? "#22c55e" : "#ef4444"}">${p.pnl.toFixed(2)}</td>
          <td>${p.date}</td>
        </tr>
      `;
    });

    html += `</table>`;
  }

  /* === GRAFICI === */
  html += `
    <h3>📊 Allocazione Portafoglio</h3>
    <canvas id="pieChart" height="200"></canvas>

    <h3>📈 PNL Storico</h3>
    <canvas id="pnlChart" height="200"></canvas>
  `;

  card.innerHTML = html;

  renderPieChart(d.openList);
  renderPNLChart(d.pnlHistory);
}

/* =========================
   GRAFICO - PORTAFOGLIO
   ========================= */
function renderPieChart(openList) {
  if (openList.length === 0) return;

  const ctx = document.getElementById("pieChart");
  new Chart(ctx, {
    type: "pie",
    data: {
      labels: openList.map(p => p.asset),
      datasets: [{
        data: openList.map(p => p.invested),
      }]
    }
  });
}

/* =========================
   GRAFICO - PNL STORICO
   ========================= */
function renderPNLChart(history) {
  if (history.length === 0) return;

  const ctx = document.getElementById("pnlChart");
  new Chart(ctx, {
    type: "line",
    data: {
      labels: history.map(h => h.date),
      datasets: [{
        label: "PNL Giornaliero",
        data: history.map(h => h.value),
        borderWidth: 2
      }]
    }
  });
}
