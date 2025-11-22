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
  return Math.round((parseDateIT(end) - parseDateIT(start)) / 86400000);
}

/* === FILE LOADER (bottone "Analizza") === */

document.getElementById("analyzeBtn").addEventListener("click", () => {
  const file = document.getElementById("csvFile").files[0];
  if (!file) return alert("Carica un CSV!");

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

  const openPositions = {};   // asset -> { qty, avg }
  const firstBuyDate = {};    // per holding period

  let pnlRealized = 0;
  let divReceived = 0;
  let commissions = 0;
  let taxes = 0;

  // pool = profitti/perdite realizzati + dividendi - spese/imposte
  // non ancora usati per nuovi acquisti
  let pool = 0;

  let invested = 0;           // SOLDI ESTERNI netti immessi nel sistema

  const pnlHistory = [];      // per grafico PNL eventi
  const equityHistory = [];   // {date, equity, invested, pool}
  const closedPositions = [];

  function computeEquity() {
    return Object.values(openPositions)
      .reduce((tot, p) => tot + p.qty * p.avg, 0);
  }

  /* === CICLO SULLE RIGHE === */

  trades.forEach(t => {
    const asset = cleanAsset(t["DESCRIZIONE"]);
    const tipo = (t["TIPOLOGIA"] || "").trim();
    const qty = parseNum(t["QTA'"]);
    const amount = parseNum(t["IMPORTO"]);   // nel CSV: negativo = uscita, positivo = entrata
    const date = t["DATA"];

    /* ============================
       COMPETENZE / IMPOSTE
       ============================ */
    if (tipo === "Competenze" || tipo === "Imposta") {
      let cost = Math.abs(amount);
      if (tipo === "Competenze") commissions += cost;
      if (tipo === "Imposta")    taxes       += cost;

      // prima si mangia la pool, poi – se non basta – soldi tuoi
      if (pool >= cost) {
        pool -= cost;
      } else {
        const extra = cost - pool;
        pool = 0;
        invested += extra;   // devi mettere soldi tuoi per coprire il costo
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
       DIVIDENDI
       ============================ */
    if (tipo === "Accredito dividendi") {
      divReceived += amount;  // positivo
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
       ACQUISTO TITOLI
       ============================ */
    if (tipo === "Acquisto titoli") {
      if (!openPositions[asset]) openPositions[asset] = { qty: 0, avg: 0 };
      const pos = openPositions[asset];

      const cashOut = Math.abs(amount);  // quanto spendi in totale

      // 1) usi prima la pool (profitti già fatti)
      const fromPool = Math.min(pool, cashOut);
      pool -= fromPool;

      // 2) se non basta, il resto sono soldi nuovi -> invested sale
      const fromExternal = cashOut - fromPool;
      invested += fromExternal;

      // aggiorna media di carico
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
       VENDITA TITOLI
       ============================ */
    if (tipo === "Vendita titoli") {

      // caso limite: vendo ma non ho posizione registrata
      if (!openPositions[asset] || openPositions[asset].qty <= 0) {
        pool += amount;               // lo trattiamo come PnL contante
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

      const sellTotal = amount;       // incasso (positivo)
      const buyTotal  = pos.avg * qty;
      const realized  = sellTotal - buyTotal;

      pnlRealized += realized;
      pool        += realized;
      pnlHistory.push({ date, value: realized });

      closedPositions.push({
        asset,
        qty,
        buyTotal,
        sellTotal,
        pnl: realized,
        holdingDays: diffDays(firstBuyDate[asset], date)
      });

      // aggiorna posizione residua
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

    // fallback per eventuali altre tipologie
    equityHistory.push({
      date,
      equity: computeEquity(),
      invested,
      pool
    });
  });

  /* === RICALIBRA LA CURVA "INVESTED" SUL RISULTATO FINALE ===
     NetProfit = PNL realizzato + dividendi - commissioni - imposte
     Identità teorica: Equity_finale = Invested_finale + NetProfit
     ⇒ Invested_finale = Equity_finale - NetProfit
     Spostiamo TUTTA la curva invested di una costante per rispettare questa
     identità (così, se NetProfit > 0, invested finisce sotto equity).
  */

  const netProfit = pnlRealized + divReceived - commissions - taxes;

  if (equityHistory.length > 0) {
    const last = equityHistory[equityHistory.length - 1];
    const targetInvestedEnd = last.equity - netProfit;
    const delta = targetInvestedEnd - last.invested;

    equityHistory.forEach(p => {
      p.invested += delta;
    });
    invested += delta; // riallineiamo anche la variabile finale (per coerenza)
  }

  // === POSIZIONI APERTE PER TABELLA ===
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
    <canvas id="pieChart" height="180"></canvas>

    <h3>🔵 PNL Storico</h3>
    <canvas id="pnlChart" height="180"></canvas>

    <h3>📈 Equity / Invested / Pool</h3>
    <p class="small-note">
      Equity = costo delle posizioni aperte (capitale a mercato).<br>
      Invested = soldi esterni netti immessi nel sistema.<br>
      Pool = profitti disponibili (PNL realizzati + dividendi − spese/imposte
      già pagate) non ancora usati per nuovi acquisti.
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
    <th>Asset</th><th>Qta</th><th>Acquisti</th><th>Vendite</th>
    <th>PNL</th><th>Holding (gg)</th>
  </tr>`;
  list.forEach(p => {
    h += `<tr>
      <td>${p.asset}</td>
      <td>${p.qty}</td>
      <td>${p.buyTotal.toFixed(2)} €</td>
      <td>${p.sellTotal.toFixed(2)} €</td>
      <td style="color:${p.pnl>=0?"#22c55e":"#ef4444"}">${p.pnl.toFixed(2)} €</td>
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
      labels: list.map(p => p.asset),
      datasets: [{ data: list.map(p => p.invested) }]
    }
  });
}

// PNL: barre verdi/rosse, valore assoluto
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

// Equity / Invested / Pool
function renderEquityChart(h) {
  if (!h.length) return;
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
          tension: 0.2
        },
        {
          label: "Invested (soldi tuoi)",
          data: h.map(e => e.invested),
          borderColor: "#22c55e",
          borderDash: [4,4],
          borderWidth: 2,
          tension: 0.2
        },
        {
          label: "Pool (profitti disponibili)",
          data: h.map(e => e.pool),
          borderColor: "#facc15",
          borderWidth: 2,
          tension: 0.2
        }
      ]
    }
  });
}
