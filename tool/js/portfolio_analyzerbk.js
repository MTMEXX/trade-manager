/* ==========================
   PORTFOLIO ANALYZER v7.1
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
  // Excel IT → di solito ISO-8859-1
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

  let pnlRealized = 0;
  let divReceived = 0;
  let commissions = 0;
  let taxes = 0;

  // pool = profitti/perdite realizzati + dividendi − costi/imposte pagati dalla pool
  let pool = 0;

  // investedTot = soldi esterni NETTI immessi nel sistema (stipendio/risparmi)
  // cresce solo quando la pool NON basta a coprire acquisti o spese/imposte
  let investedTot = 0;

  const pnlHistory = [];      // per grafico PNL (barre)
  const equityHistory = [];   // timeline { date, equity, investedTot, pool }
  const closedPositions = [];

  function computeEquity() {
    return Object.values(openPositions)
      .reduce((tot, p) => tot + p.qty * p.avg, 0);
  }

  /* === CICLO SULLE RIGHE === */
  trades.forEach((t) => {
    const asset = cleanAsset(t["DESCRIZIONE"]);
    const tipo = (t["TIPOLOGIA"] || "").trim();
    const qty = parseNum(t["QTA'"]);
    const amount = parseNum(t["IMPORTO"]); // CSV: negativo per uscite, positivo per entrate
    const date = t["DATA"];

    /* ============================
       COMPETENZE / IMPOSTE
       ============================ */
    if (tipo === "Competenze" || tipo === "Imposta") {
      let cost = Math.abs(amount);
      if (tipo === "Competenze") commissions += cost;
      if (tipo === "Imposta") taxes += cost;

      // usiamo prima la pool
      if (pool >= cost) {
        pool -= cost;
      } else {
        const extra = cost - pool;
        pool = 0;
        // manca soldi nella pool → li metti tu da fuori
        investedTot += extra;
      }

      equityHistory.push({
        date,
        equity: computeEquity(),
        investedTot,
        pool
      });
      return;
    }

    /* ============================
       DIVIDENDI
       ============================ */
    if (tipo === "Accredito dividendi") {
      divReceived += amount;
      pool += amount;
      pnlHistory.push({ date, value: amount });

      equityHistory.push({
        date,
        equity: computeEquity(),
        investedTot,
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

      const cashOut = Math.abs(amount); // quanto costa l'acquisto

      // 1) pago usando prima la pool (profitti)
      const fromPool = Math.min(Math.max(pool, 0), cashOut);
      pool -= fromPool;

      // 2) se non basta, il resto è soldi tuoi nuovi → aumenta investedTot
      const fromExternal = cashOut - fromPool;
      investedTot += fromExternal;

      // aggiorno posizione (equity = costo totale delle posizioni aperte)
      const totalCost = pos.qty * pos.avg + cashOut;
      pos.qty += qty;
      pos.avg = totalCost / pos.qty;

      if (!firstBuyDate[asset]) firstBuyDate[asset] = date;

      equityHistory.push({
        date,
        equity: computeEquity(),
        investedTot,
        pool
      });
      return;
    }

    /* ============================
       VENDITA TITOLI
       ============================ */
    if (tipo === "Vendita titoli") {
      // caso limite: vendo senza posizione registrata
      if (!openPositions[asset] || openPositions[asset].qty <= 0) {
        pool += amount;
        pnlHistory.push({ date, value: amount });

        equityHistory.push({
          date,
          equity: computeEquity(),
          investedTot,
          pool
        });
        return;
      }

      const pos = openPositions[asset];

      const sellTotal = amount;        // incasso (positivo)
      const buyTotal = pos.avg * qty;  // costo storico
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
        investedTot,
        pool
      });
      return;
    }

    /* fallback: caso non classificato */
    equityHistory.push({
      date,
      equity: computeEquity(),
      investedTot,
      pool
    });
  });

  /* === POSIZIONI APERTE === */
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
   RENDER HTML
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
    <p><b>Imposte:</b> ${fmt(d.taxes)} €</p>

    <h3>📂 Posizioni aperte</h3>
    ${renderOpenPositions(d.openList)}

    <h3>📉 Posizioni chiuse</h3>
    ${renderClosedPositions(d.closedPositions)}

    <h3>🟣 Allocazione portafoglio</h3>
    <canvas id="pieChart" height="180"></canvas>

    <h3>🔵 PNL Storico (per evento)</h3>
    <canvas id="pnlChart" height="180"></canvas>

    <h3>📈 Equity / Invested / Pool</h3>
    <p class="small-note">
      Equity = capitale attualmente investito in posizioni (al costo).<br>
      Invested (soldi tuoi a rischio) = max(soldi esterni immessi − profitti netti disponibili, 0).<br>
      Pool = profitti netti disponibili per nuovi trade o per prelievi.
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
  let h = `<table><tr>
    <th>Asset</th><th>Qta</th><th>Tot. Acquisti</th><th>Tot. Vendite</th><th>PNL</th><th>Holding (gg)</th>
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

function renderPNLChart(h) {
  if (!h.length) return;
  new Chart(document.getElementById("pnlChart"), {
    type: "bar",
    data: {
      labels: h.map((e) => e.date),
      datasets: [{
        label: "PNL per evento (assoluto)",
        data: h.map((e) => Math.abs(e.value)),
        backgroundColor: h.map((e) => e.value >= 0 ? "#22c55e" : "#ef4444")
      }]
    }
  });
}

function renderEquityChart(h) {
  if (!h.length) return;

  const labels = h.map((e) => e.date);
  const equityData = h.map((e) => e.equity);
  const poolData = h.map((e) => e.pool);

  // linea verde: soldi tuoi ancora a rischio = investedTot - poolPositivo
  const investedRisk = h.map((e) => {
    const poolPos = Math.max(e.pool, 0);
    const risk = e.investedTot - poolPos;
    return risk > 0 ? risk : 0;
  });

  new Chart(document.getElementById("equityChart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Equity (capitale a mercato)",
          data: equityData,
          borderColor: "#38bdf8",
          borderWidth: 2,
          tension: 0.2
        },
        {
          label: "Invested (soldi tuoi a rischio)",
          data: investedRisk,
          borderColor: "#22c55e",
          borderWidth: 2,
          borderDash: [4, 4],
          tension: 0.2
        },
        {
          label: "Pool (profitti disponibili)",
          data: poolData,
          borderColor: "#facc15",
          borderWidth: 2,
          tension: 0.2
        }
      ]
    }
  });
}
