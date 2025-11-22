/* ==========================
   PORTFOLIO ANALYZER v6.0
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
  reader.onload = (e) => parseCSV(e.target.result);
  // Excel italiano -> ISO-8859-1 / Windows-1252
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
  const openPositions = {};         // asset -> { qty, avg }
  const firstBuyDateByAsset = {};   // asset -> prima data acquisto (per holding)

  let pnlRealized = 0;
  let divReceived = 0;
  let commissions = 0;
  let taxes = 0;

  // pool = profitti/perdite realizzati + dividendi - costi/imposte non ancora usati per finanziare nuovi trade
  let pool = 0;

  const pnlHistory = [];            // eventi singoli (realized + dividendi), con segno per colore
  const equityHistory = [];         // {date, equity, invested}

  let invested = 0;                 // SOLDI ESTERNI introdotti nel sistema (stipendio / risparmi), netti
  const closedPositions = [];

  // funzione d'appoggio per calcolare equity corrente = somma costi delle posizioni aperte
  function computeEquity() {
    let eq = 0;
    Object.values(openPositions).forEach((p) => {
      eq += p.qty * p.avg;
    });
    return eq;
  }

  trades.forEach((t) => {
    const asset = cleanAsset(t["DESCRIZIONE"]);
    const tipo = (t["TIPOLOGIA"] || "").trim();     // Acquisto titoli / Vendita titoli / Accredito dividendi / Competenze / Imposta
    const qty = parseNum(t["QTA'"]);
    let amount = parseNum(t["IMPORTO"]);            // nel CSV: negativo per uscite, positivo per entrate
    const date = t["DATA"];

    /* === COMPETENZE (costi gestione, commissioni, bolli) ===
       - NON devono toccare l'equity (capitale investito a mercato)
       - prima scalano dalla pool (guadagni)
       - se pool non basta, scalano dall'invested (soldi propri immessi)
    */
    if (tipo === "Competenze") {
      let cost = Math.abs(amount);
      commissions += cost;

      if (pool >= cost) {
        pool -= cost;
      } else {
        const restante = cost - Math.max(0, pool);
        pool = 0;
        invested -= restante;      // paghi il resto con soldi tuoi
      }

      const equityNow = computeEquity();
      equityHistory.push({ date, equity: equityNow, invested });
      return;
    }

    /* === IMPOSTA (capital gain, ritenute, ecc.) ===
       - stesso schema delle competenze: scalano pool, poi invested
    */
    if (tipo === "Imposta") {
      let cost = Math.abs(amount);
      taxes += cost;

      if (pool >= cost) {
        pool -= cost;
      } else {
        const restante = cost - Math.max(0, pool);
        pool = 0;
        invested -= restante;
      }

      const equityNow = computeEquity();
      equityHistory.push({ date, equity: equityNow, invested });
      return;
    }

    /* === DIVIDENDI ===
       - non cambiano le posizioni aperte
       - aumentano la pool (guadagno disponibile per futuri trade)
    */
    if (tipo === "Accredito dividendi") {
      divReceived += amount;  // amount > 0
      pool += amount;
      pnlHistory.push({ date, value: amount });

      const equityNow = computeEquity();
      equityHistory.push({ date, equity: equityNow, invested });
      return;
    }

    /* === ACQUISTO TITOLI ===
       - equity (capitale a mercato) aumenta sempre del costo
       - usiamo prima la pool, poi se non basta aumentiamo invested (soldi nuovi)
    */
    if (tipo === "Acquisto titoli") {
      if (!openPositions[asset]) openPositions[asset] = { qty: 0, avg: 0 };

      const pos = openPositions[asset];
      const cashOut = Math.abs(amount); // capitale usato per comprare

      // usa prima la pool
      const poolUsable = Math.max(0, pool);
      const fromPool = Math.min(poolUsable, cashOut);
      pool -= fromPool;

      // il resto viene da soldi nuovi (invested)
      const fromExternal = cashOut - fromPool;
      invested += fromExternal;

      // aggiorna posizione
      const totalCost = pos.qty * pos.avg + cashOut;
      pos.qty += qty;
      pos.avg = totalCost / pos.qty;

      if (!firstBuyDateByAsset[asset]) {
        firstBuyDateByAsset[asset] = date;
      }

      const equityNow = computeEquity();
      equityHistory.push({ date, equity: equityNow, invested });
      return;
    }

    /* === VENDITA TITOLI ===
       - equity scende perché hai meno capitale a mercato
       - realized PnL va in pool
       - invested NON cambia (nessun nuovo denaro esterno)
    */
    if (tipo === "Vendita titoli") {
      if (!openPositions[asset] || openPositions[asset].qty <= 0) {
        // Vendo senza posizione (edge-case), trattiamo tutto come evento di PnL nella pool
        pool += amount;
        pnlHistory.push({ date, value: amount });

        const equityNow = computeEquity();
        equityHistory.push({ date, equity: equityNow, invested });
        return;
      }

      const pos = openPositions[asset];
      const sellQty = qty;
      const sellTotal = amount;            // incasso (positivo)
      const buyTotal = pos.avg * sellQty;  // capitale "a costo" associato

      const realized = sellTotal - buyTotal;
      pnlRealized += realized;
      pool += realized;                    // profitto/perdita va nella pool
      pnlHistory.push({ date, value: realized });

      const holding = diffDays(firstBuyDateByAsset[asset], date);

      closedPositions.push({
        asset,
        qty: sellQty,
        buyTotal,
        sellTotal,
        pnl: realized,
        holdingDays: holding
      });

      // aggiorna posizione residua
      pos.qty -= sellQty;
      if (pos.qty <= 0) {
        pos.qty = 0;
        pos.avg = 0;
        firstBuyDateByAsset[asset] = null;
      }

      const equityNow = computeEquity();
      equityHistory.push({ date, equity: equityNow, invested });
      return;
    }

    // altre TIPOLOGIE le ignoriamo a livello di logica numerica
    const equityNow = computeEquity();
    equityHistory.push({ date, equity: equityNow, invested });
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

    <h3>🔵 PNL Storico (per evento)</h3>
    <canvas id="pnlChart" height="200"></canvas>

    <h3>🟢 Equity & Capitale investito nel tempo</h3>
    <p class="small-note">
      Equity = capitale attualmente investito in posizioni (costo).<br>
      Capitale investito = soldi esterni immessi nel sistema (stipendio / risparmi),
      utilizzati quando la pool di profitti non è sufficiente.
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
        <td style="color:${p.pnl >= 0 ? "#22c55e" : "#ef4444"}">
          ${p.pnl.toFixed(2)} €
        </td>
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
  const ctx = document.getElementById("pieChart");
  if (!ctx) return;

  new Chart(ctx, {
    type: "pie",
    data: {
      labels: list.map((p) => p.asset),
      datasets: [
        {
          data: list.map((p) => p.invested),
        },
      ],
    },
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
      labels: history.map((h) => h.date),
      datasets: [
        {
          label: "PNL per evento (assoluto)",
          data: history.map((h) => Math.abs(h.value)),
          backgroundColor: history.map((h) =>
            h.value >= 0 ? "#22c55e" : "#ef4444"
          ),
        },
      ],
    },
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
      labels: history.map((e) => e.date),
      datasets: [
        {
          label: "Equity (capitale a mercato)",
          data: history.map((e) => e.equity),
          borderColor: "#38bdf8",
          borderWidth: 2,
          tension: 0.2,
        },
        {
          label: "Capitale investito (soldi tuoi)",
          data: history.map((e) => e.invested),
          borderColor: "#22c55e",
          borderWidth: 2,
          borderDash: [4, 4],
          tension: 0.2,
        },
      ],
    },
  });
}
