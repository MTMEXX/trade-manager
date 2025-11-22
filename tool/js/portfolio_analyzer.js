/* ==========================
   PORTFOLIO ANALYZER v5.0
   ========================== */

/* === UTILS === */

// parsing numeri stile italiano: "-1.211,88 €" -> -1211.88
function parseNum(value) {
  if (!value) return 0;
  return parseFloat(
    value
      .toString()
      .replace(/\./g, "")   // toglie separatore migliaia
      .replace(",", ".")    // converte la virgola in punto
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
  if (!file) return alert("Carica un CSV!");

  const reader = new FileReader();
  reader.onload = e => parseCSV(e.target.result);
  // Excel italiano tipicamente -> ISO-8859-1 / Windows-1252
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
  const openPositions = {};         // asset -> { qty, avg }
  const firstBuyDateByAsset = {};   // asset -> prima data acquisto (per holding)

  let pnlRealized = 0;
  let divReceived = 0;
  let commissions = 0;
  let taxes = 0;

  const pnlHistory = [];            // eventi singoli (realized + dividendi)
  const equityHistory = [];         // {date, equity, invested}

  let equity = 0;                   // "ricchezza" cumulata
  let invested = 0;                 // capitale oggi investito nel mercato

  const closedPositions = [];

  trades.forEach(t => {
    const asset = cleanAsset(t["DESCRIZIONE"]);
    const tipo = (t["TIPOLOGIA"] || "").trim();   // Acquisto titoli / Vendita titoli / ...
    const qty = parseNum(t["QTA'"]);
    let amount = parseNum(t["IMPORTO"]);          // negativo per uscite, positivo per entrate
    const date = t["DATA"];

    /* === COMPETENZE (costi gestione, bolli, commissioni extra) === */
    if (tipo === "Competenze") {
      // forza il segno a negativo (costo) anche se nel CSV manca il "-"
      const cost = amount > 0 ? -amount : amount;
      commissions += Math.abs(cost);

      // costo riduce la ricchezza, non il capitale investito
      equity += cost;
      equityHistory.push({ date, equity, invested });

      return;
    }

    /* === IMPOSTA (capital gain, ritenute, ecc.) === */
    if (tipo === "Imposta") {
      const tax = amount > 0 ? -amount : amount;
      taxes += Math.abs(tax);

      equity += tax; // riduce equity
      equityHistory.push({ date, equity, invested });

      return;
    }

    /* === DIVIDENDI === */
    if (tipo === "Accredito dividendi") {
      // amount nel CSV è positivo (entrata)
      divReceived += amount;
      pnlHistory.push({ date, value: amount });

      equity += amount;  // la ricchezza sale
      equityHistory.push({ date, equity, invested });

      return;
    }

    /* === ACQUISTO TITOLI === */
    if (tipo === "Acquisto titoli") {
      if (!openPositions[asset]) openPositions[asset] = { qty: 0, avg: 0 };
      const pos = openPositions[asset];

      const cashOut = Math.abs(amount); // quanto hai effettivamente investito
      const totalCost = pos.qty * pos.avg + cashOut;
      pos.qty += qty;
      pos.avg = totalCost / pos.qty;

      if (!firstBuyDateByAsset[asset]) {
        firstBuyDateByAsset[asset] = date;
      }

      // Linea "investito": cresce della spesa
      invested += cashOut;

      // Linea "equity": cresce della spesa (nuova ricchezza impegnata)
      equity += cashOut;

      equityHistory.push({ date, equity, invested });
      return;
    }

    /* === VENDITA TITOLI === */
    if (tipo === "Vendita titoli") {
      // se non ho posizione, tratto come incasso senza base (edge-case)
      if (!openPositions[asset] || openPositions[asset].qty <= 0) {
        pnlHistory.push({ date, value: amount });
        // ricchezza cresce dell'incasso (che è tutto PnL "grezzo")
        equity += amount;
        equityHistory.push({ date, equity, invested });
        return;
      }

      const pos = openPositions[asset];
      const sellTotal = amount;          // incasso (positivo)
      const buyTotal = pos.avg * qty;    // capitale associato a questa quantità
      const realized = sellTotal - buyTotal;

      pnlRealized += realized;
      pnlHistory.push({ date, value: realized });

      const holding = diffDays(firstBuyDateByAsset[asset], date);

      closedPositions.push({
        asset,
        qty,
        buyTotal,
        sellTotal,
        pnl: realized,
        holdingDays: holding
      });

      // Aggiorna la posizione residua
      pos.qty -= qty;
      if (pos.qty <= 0) {
        pos.qty = 0;
        pos.avg = 0;
        firstBuyDateByAsset[asset] = null;
      }

      // Linea "investito": cala SOLO del capitale rientrato (buyTotal)
      invested = Math.max(0, invested - buyTotal);

      // Linea "equity": cresce del PnL realizzato
      equity += realized;

      equityHistory.push({ date, equity, invested });
      return;
    }

    // altre TIPOLOGIE vengono ignorate a livello posizioni/equity
  });

  // === COSTRUISCI LISTA POSIZIONI APERTE ===
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
   RENDER RISULTATI
   ========================= */

function renderResults(d) {
  const card = document.getElementById("results");
  card.classList.add("visible");

  const fmt = (v, dec = 2) =>
    (v !== null && v !== undefined && isFinite(v)) ? v.toFixed(dec) : "-";

  let html = `
    <h2>📊 Risultati Analisi</h2>

    <p><b>PNL realizzato (solo vendite):</b> ${fmt(d.pnlRealized)} €</p>
    <p><b>Dividendi ricevuti:</b> ${fmt(d.divReceived)} €</p>
    <p><b>Commissioni / competenze totali:</b> ${fmt(d.commissions)} €</p>
    <p><b>Imposte totali:</b> ${fmt(d.taxes)} €</p>

    <h3>📂 Posizioni aperte</h3>
    ${renderOpenPositions(d.openList)}

    <h3>📉 Posizioni chiuse</h3>
    ${renderClosedPositions(d.closedPositions)}

    <h3>🟣 Allocazione portafoglio (posizioni aperte)</h3>
    <canvas id="pieChart" height="200"></canvas>

    <h3>🔵 PNL Storico (per trade / evento)</h3>
    <canvas id="pnlChart" height="200"></canvas>

    <h3>🟢 Equity & Capitale investito nel tempo</h3>
    <p class="small-note">
      Equity = capitale investito + PnL realizzato + dividendi − costi − imposte.<br>
      Il capitale investito non tiene conto dei prezzi correnti delle posizioni aperte.
    </p>
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
  list.forEach(p => {
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

  list.forEach(p => {
    html += `
      <tr>
        <td>${p.asset}</td>
        <td>${p.qty}</td>
        <td>${p.buyTotal.toFixed(2)} €</td>
        <td>${p.sellTotal.toFixed(2)} €</td>
        <td style="color:${p.pnl >= 0 ? '#22c55e' : '#ef4444'}">
          ${p.pnl.toFixed(2)} €
        </td>
        <td>${p.holdingDays ?? '-'}</td>
      </tr>`;
  });

  return html + "</table>";
}

/* =========================
   GRAFICI
   ========================= */

function renderPieChart(list) {
  if (!list.length) return;
  const ctx = document.getElementById("pieChart");
  if (!ctx) return;

  new Chart(ctx, {
    type: "pie",
    data: {
      labels: list.map(p => p.asset),
      datasets: [{
        data: list.map(p => p.invested)
      }]
    }
  });
}

/* === PNL BAR GREEN/RED (VALORE ASSOLUTO) === */
function renderPNLChart(history) {
  if (!history.length) return;
  const ctx = document.getElementById("pnlChart");
  if (!ctx) return;

  new Chart(ctx, {
    type: "bar",
    data: {
      labels: history.map(h => h.date),
      datasets: [{
        label: "PNL per evento (assoluto)",
        data: history.map(h => Math.abs(h.value)),
        backgroundColor: history.map(h =>
          h.value >= 0 ? "#22c55e" : "#ef4444"
        )
      }]
    }
  });
}

/* === EQUITY & INVESTED LINE === */
function renderEquityChart(history) {
  if (!history.length) return;
  const ctx = document.getElementById("equityChart");
  if (!ctx) return;

  new Chart(ctx, {
    type: "line",
    data: {
      labels: history.map(e => e.date),
      datasets: [
        {
          label: "Equity del conto",
          data: history.map(e => e.equity),
          borderColor: "#38bdf8",
          borderWidth: 2,
          tension: 0.2
        },
        {
          label: "Capitale investito",
          data: history.map(e => e.invested),
          borderColor: "#22c55e",
          borderWidth: 2,
          borderDash: [4, 4],
          tension: 0.2
        }
      ]
    }
  });
}
