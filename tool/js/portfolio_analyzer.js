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
  // Excel italiano: di solito ISO-8859-1 / Windows-1252
  reader.readAsText(file, "ISO-8859-1");
});

function parseCSV(text) {
  const sep = text.includes(";") ? ";" : ",";
  const rows = text.trim().split("\n").map(r => r.split(sep));

  // normalizzo header (tolgo BOM, maiuscolo)
  const rawHeaders = rows[0];
  const headers = rawHeaders.map(h =>
    h.replace("\ufeff", "").trim().toUpperCase()
  );

  const idx = {
    descrizione: headers.indexOf("DESCRIZIONE"),
    movimento: headers.indexOf("MOVIMENTO"),
    qta: headers.indexOf("QTA'"),
    importo: headers.indexOf("IMPORTO"),
    data: headers.indexOf("DATA"),
    tipologia: headers.indexOf("TIPOLOGIA")
  };

  const trades = rows.slice(1).map(r => ({
    descrizione: r[idx.descrizione],
    movimento: r[idx.movimento],
    qta: r[idx.qta],
    importo: r[idx.importo],
    data: r[idx.data],
    tipologia: r[idx.tipologia]
  }));

  analyzeTrades(trades);
}

/* ======================
   LOGICA PRINCIPALE
   ====================== */

function analyzeTrades(trades) {

  const openPositions = {};     // asset -> { qty, cost }
  const firstBuyDate = {};      // asset -> prima data acquisto (per holding)

  let pnlRealized = 0;
  let divReceived = 0;
  let commissions = 0;
  let taxes = 0;

  // pool = profitti/perdite realizzati + dividendi − costi/imposte coperti dalla pool
  let pool = 0;

  // soldi ESTERNI immessi (stipendio/risparmi) netti
  let invested = 0;

  const pnlHistory = [];        // per grafico PNL (eventi, con segno)
  const equityHistory = [];     // { date, equity, invested, pool }
  const closedPositions = [];

  function computeEquity() {
    return Object.values(openPositions)
      .reduce((tot, p) => tot + p.qty * (p.cost / p.qty), 0);
  }

  /* === CICLO SU TUTTE LE RIGHE === */

  trades.forEach(t => {
    const asset = cleanAsset(t.descrizione);
    const tipo = (t.tipologia || "").trim();
    const qty = parseNum(t.qta);
    const amount = parseNum(t.importo);
    const date = t.data;

    /* ============================
       COMPETENZE / IMPOSTE
       ============================ */
    if (tipo === "Competenze" || tipo === "Imposta") {
      let cost = Math.abs(amount);
      if (tipo === "Competenze") commissions += cost;
      if (tipo === "Imposta") taxes += cost;

      // prima brucio la pool, poi (se serve) soldi tuoi
      if (pool >= cost) {
        pool -= cost;
      } else {
        const extra = cost - pool;
        pool = 0;
        invested -= extra;   // paghi con soldi esterni
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
      divReceived += amount;
      pool += amount;                     // dividendo va in pool
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

      if (!openPositions[asset]) openPositions[asset] = { qty: 0, cost: 0 };
      const pos = openPositions[asset];

      const cashOut = Math.abs(amount);   // capitale usato per comprare

      // 1) uso prima la pool
      const fromPool = Math.min(pool, cashOut);
      pool -= fromPool;

      // 2) se non basta, il resto è SOLDI TUOI → invested
      const fromExternal = cashOut - fromPool;
      invested += fromExternal;

      // 3) aggiorno posizione (costo totale e quantità)
      pos.cost += cashOut;
      pos.qty  += qty;

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

      // se non ho posizione, tratto tutto come PNL diretto (edge case)
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

      const ricavo = amount;                 // incasso (positivo)
      const costoMedio = pos.cost / pos.qty;
      const costoVenduto = costoMedio * qty; // quota di costo che esce
      const profitto = ricavo - costoVenduto;

      pnlRealized += profitto;
      pool += profitto;                      // profitto (o perdita) va in pool
      pnlHistory.push({ date, value: profitto });

      closedPositions.push({
        asset,
        qty,
        buyTotal: costoVenduto,
        sellTotal: ricavo,
        pnl: profitto,
        holdingDays: diffDays(firstBuyDate[asset], date)
      });

      // aggiorno posizione residua
      pos.qty  -= qty;
      pos.cost -= costoVenduto;

      if (pos.qty <= 0) {
        delete openPositions[asset];
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

    /* === fallback per righe non gestite === */
    equityHistory.push({
      date,
      equity: computeEquity(),
      invested,
      pool
    });
  });

  /* === POSIZIONI APERTE (per tabella + pie) === */

  const openList = Object.entries(openPositions)
    .filter(([_, p]) => p.qty > 0)
    .map(([asset, p]) => {
      const avg = p.cost / p.qty;
      return {
        asset,
        qty: p.qty,
        avg,
        invested: p.cost
      };
    });

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
          borderDash: [4, 4],
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
