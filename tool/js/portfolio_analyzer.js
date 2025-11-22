/* ==========================
   PORTFOLIO ANALYZER v3.0
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

// dd/mm/yyyy -> Date
function parseDateIT(str) {
  if (!str) return null;
  const [d, m, y] = str.split("/").map(Number);
  return new Date(y, m - 1, d);
}

// differenza in giorni tra due date dd/mm/yyyy
function diffDays(startStr, endStr) {
  const d1 = parseDateIT(startStr);
  const d2 = parseDateIT(endStr);
  if (!d1 || !d2) return null;
  const ms = d2 - d1;
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

/* === LOAD CSV === */
document.getElementById("analyzeBtn").addEventListener("click", () => {
  const file = document.getElementById("csvFile").files[0];
  if (!file) return alert("Carica un CSV!");

  const reader = new FileReader();
  reader.onload = (e) => parseCSV(e.target.result);
  // Excel italiano tipicamente -> ISO-8859-1 / Windows-1252
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
   LOGICA DI ANALISI
   ====================== */

function analyzeTrades(trades) {
  // Posizioni aperte per asset
  const openPositions = {}; // asset -> { qty, avg }

  // Per calcolare tempo di detenzione
  const firstBuyDateByAsset = {}; // asset -> "dd/mm/yyyy"

  // Risultati aggregati
  let pnlRealized = 0;
  let divReceived = 0;
  let commissions = 0;
  let taxes = 0;

  // Storici per grafici
  const pnlHistory = [];    // eventi singoli (realizzati + dividendi)
  const equityHistory = []; // equity cumulata nel tempo

  // Lista posizioni chiuse (per tabella)
  const closedPositions = [];

  // Equity complessiva (solo realizzato + flussi, no mark-to-market)
  let equity = 0;

  trades.forEach((t) => {
    const asset = cleanAsset(t["DESCRIZIONE"]);
    const movimento = (t["MOVIMENTO"] || "").toUpperCase(); // Entrata / Uscita (non la usiamo molto qui)
    const tipo = (t["TIPOLOGIA"] || "").trim();             // Acquisto titoli / Vendita titoli / Accredito dividendi / Competenze / Imposta
    const qty = parseNum(t["QTA'"]);
    const amount = parseNum(t["IMPORTO"]);                  // negativo per uscite, positivo per entrate
    const date = t["DATA"];

    // Inizializza struttura per asset solo quando serve
    if (tipo === "Acquisto titoli" || tipo === "Vendita titoli") {
      if (!openPositions[asset]) {
        openPositions[asset] = { qty: 0, avg: 0 };
      }
    }

    /* === COMPETENZE (costi gestione, commissioni, bolli) === */
    if (tipo === "Competenze") {
      // amount è negativo -> costo
      const cost = amount;
      commissions += Math.abs(cost);

      equity += cost; // riduce equity
      equityHistory.push({ date, value: equity });

      return;
    }

    /* === IMPOSTA (capital gain, ritenute, ecc.) === */
    if (tipo === "Imposta") {
      const tax = amount; // negativo
      taxes += Math.abs(tax);

      equity += tax; // riduce equity
      equityHistory.push({ date, value: equity });

      return;
    }

    /* === DIVIDENDI === */
    if (tipo === "Accredito dividendi") {
      divReceived += amount; // positivo
      pnlHistory.push({ date, value: amount });

      equity += amount;
      equityHistory.push({ date, value: equity });

      return;
    }

    /* === ACQUISTO TITOLI === */
    if (tipo === "Acquisto titoli") {
      const pos = openPositions[asset];

      // amount è il totale (negativo) scalato dal conto
      const costoTotale = pos.qty * pos.avg + Math.abs(amount);
      pos.qty += qty;
      pos.avg = pos.qty > 0 ? costoTotale / pos.qty : 0;

      // memorizza la prima data di acquisto per il calcolo del holding period
      if (!firstBuyDateByAsset[asset]) {
        firstBuyDateByAsset[asset] = date;
      }

      // per l'equity globale trattiamo l'acquisto come "nuovo capitale investito"
      equity += Math.abs(amount);
      equityHistory.push({ date, value: equity });

      return;
    }

    /* === VENDITA TITOLI === */
    if (tipo === "Vendita titoli") {
      const pos = openPositions[asset];
      if (!pos || pos.qty <= 0) {
        // caso limite: vendo senza avere posizione (lo trattiamo come evento solo di cassa)
        // in questo caso amount è positivo: flusso di cassa in entrata
        pnlHistory.push({ date, value: amount });

        equity += amount;
        equityHistory.push({ date, value: equity });
        return;
      }

      const sellQty = qty;
      const sellTotal = Math.abs(amount); // incassato
      const buyAvg = pos.avg;
      const buyTotal = sellQty * buyAvg;

      const realized = sellTotal - buyTotal;
      pnlRealized += realized;
      pnlHistory.push({ date, value: realized });

      // holding period (GG) dalla prima data di acquisto nota
      let holdingDays = null;
      if (firstBuyDateByAsset[asset]) {
        holdingDays = diffDays(firstBuyDateByAsset[asset], date);
      }

      closedPositions.push({
        asset,
        qty: sellQty,
        buyPrice: buyAvg,
        buyTotal,
        sellTotal,
        pnl: realized,
        holdingDays
      });

      // aggiorna posizione residua
      pos.qty -= sellQty;
      if (pos.qty <= 0) {
        pos.qty = 0;
        pos.avg = 0;
        // se la posizione è completamente chiusa, resettiamo la data iniziale
        firstBuyDateByAsset[asset] = null;
      }

      // sulla equity globale aggiungiamo SOLO il PNL (non il totale incassato)
      equity += realized;
      equityHistory.push({ date, value: equity });

      return;
    }

    // qualunque altra tipologia viene ignorata a livello posizioni,
    // ma se in futuro aggiungi altro, la possiamo gestire qui.
  });

  /* === COSTRUISCI LISTA POSIZIONI APERTE === */
  const openList = Object.entries(openPositions)
    .filter(([_, p]) => p.qty > 0)
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
  `;

  /* === POSIZIONI APERTE === */
  if (d.openList.length === 0) {
    html += `<p>Nessuna posizione aperta rilevata.</p>`;
  } else {
    html += `
      <table>
        <tr>
          <th>Asset</th>
          <th>Qta</th>
          <th>Prezzo medio</th>
          <th>Valore investito</th>
        </tr>
    `;
    d.openList.forEach((p) => {
      html += `
        <tr>
          <td>${p.asset}</td>
          <td>${fmt(p.qty, 4)}</td>
          <td>${fmt(p.avg, 4)}</td>
          <td>${fmt(p.invested)} €</td>
        </tr>
      `;
    });
    html += `</table>`;
  }

  /* === POSIZIONI CHIUSE === */
  html += `
    <h3>📉 Posizioni chiuse</h3>
  `;

  if (d.closedPositions.length === 0) {
    html += `<p>Nessuna posizione chiusa.</p>`;
  } else {
    html += `
      <table>
        <tr>
          <th>Asset</th>
          <th>Qta</th>
          <th>Totale acquisti</th>
          <th>Totale vendite</th>
          <th>PNL</th>
          <th>Holding (gg)</th>
        </tr>
    `;
    d.closedPositions.forEach((p) => {
      html += `
        <tr>
          <td>${p.asset}</td>
          <td>${fmt(p.qty, 4)}</td>
          <td>${fmt(p.buyTotal)} €</td>
          <td>${fmt(p.sellTotal)} €</td>
          <td style="color:${p.pnl >= 0 ? "#22c55e" : "#ef4444"}">
            ${fmt(p.pnl)} €
          </td>
          <td>${p.holdingDays !== null ? p.holdingDays : "-"}</td>
        </tr>
      `;
    });
    html += `</table>`;
  }

  /* === GRAFICI === */
  html += `
    <h3>🟣 Allocazione portafoglio (posizioni aperte)</h3>
    <canvas id="pieChart" height="200"></canvas>

    <h3>🔵 PNL storico (eventi)</h3>
    <canvas id="pnlChart" height="200"></canvas>

    <h3>🟢 Equity complessiva nel tempo</h3>
    <p class="small-note">
      Include: capitale investito (acquisti), PNL delle vendite, dividendi, costi e imposte.
      Non tiene conto delle variazioni di prezzo delle posizioni ancora aperte.
    </p>
    <canvas id="equityChart" height="200"></canvas>
  `;

  card.innerHTML = html;

  renderPieChart(d.openList);
  renderPNLChart(d.pnlHistory);
  renderEquityChart(d.equityHistory);
}

/* =========================
   GRAFICO - PORTAFOGLIO
   ========================= */

function renderPieChart(openList) {
  if (!openList || openList.length === 0) return;
  const ctx = document.getElementById("pieChart");
  if (!ctx) return;

  new Chart(ctx, {
    type: "pie",
    data: {
      labels: openList.map((p) => p.asset),
      datasets: [
        {
          data: openList.map((p) => p.invested),
        },
      ],
    },
  });
}

/* =========================
   GRAFICO - PNL STORICO
   ========================= */

function renderPNLChart(history) {
  if (!history || history.length === 0) return;
  const ctx = document.getElementById("pnlChart");
  if (!ctx) return;

  new Chart(ctx, {
    type: "bar",
    data: {
      labels: history.map((h) => h.date),
      datasets: [
        {
          label: "PNL giornaliero (vendite + dividendi)",
          data: history.map((h) => h.value),
          borderWidth: 1,
        },
      ],
    },
  });
}

/* =========================
   GRAFICO - EQUITY GLOBALE
   ========================= */

function renderEquityChart(equityHistory) {
  if (!equityHistory || equityHistory.length === 0) return;
  const ctx = document.getElementById("equityChart");
  if (!ctx) return;

  new Chart(ctx, {
    type: "line",
    data: {
      labels: equityHistory.map((e) => e.date),
      datasets: [
        {
          label: "Equity cumulata",
          data: equityHistory.map((e) => e.value),
          borderWidth: 2,
        },
      ],
    },
  });
}
