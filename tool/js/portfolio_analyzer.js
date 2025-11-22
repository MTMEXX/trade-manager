// === PORTFOLIO ANALYZER JS ===
// Attende CSV con colonne:
// DESCRIZIONE, MOVIMENTO, QTA', IMPORTO, DATA, TIPOLOGIA

/* === UTILS === */

function parseNum(value) {
  if (!value) return 0;
  return parseFloat(
    value.toString()
      .replace(/\./g, '')
      .replace(",", ".")
      .replace("€", "")
      .trim()
  );
}

function parseDate(d) {
  const [day, month, year] = d.split("/");
  return new Date(`${year}-${month}-${day}`);
}

/* === FILE HANDLER === */

document.getElementById("analyzeBtn").addEventListener("click", () => {
  const file = document.getElementById("csvFile").files[0];
  if (!file) return alert("Carica il CSV prima.");

  const reader = new FileReader();
  reader.onload = e => parseCSV(e.target.result);
  reader.readAsText(file);
});

/* === PARSE CSV === */

function parseCSV(text) {
  const delim = text.includes(";") ? ";" : ",";
  const rows = text.trim().split("\n").map(r => r.split(delim));

  const headers = rows[0].map(h => h.trim());
  const entries = rows.slice(1).map(row => {
    const o = {};
    headers.forEach((h, idx) => {
      o[h] = row[idx] ? row[idx].trim() : "";
    });
    return o;
  });

  analyze(entries);
}

/* === ANALISI === */

function analyze(rows) {

  let positions = {};
  let closedTrades = [];

  let dividends = 0;
  let taxes = 0;
  let fees = 0;

  rows.forEach(r => {
    const asset = r["DESCRIZIONE"];
    const tipo = r["TIPOLOGIA"];
    const movimento = r["MOVIMENTO"].toUpperCase();
    const qty = parseNum(r["QTA'"]);
    const amount = parseNum(r["IMPORTO"]);
    const date = parseDate(r["DATA"]);

    if (!asset || !tipo) return;

    // === DIVIDENDI ===
    if (tipo === "Accredito dividendi") {
      dividends += amount;
      return;
    }

    // === IMPOSTE ===
    if (tipo === "Imposta") {
      taxes += amount;
      return;
    }

    // === COMPETENZE (SPESE) ===
    if (tipo === "Competenze") {
      fees += amount;
      return;
    }

    // === OPERATIVITÀ SU ASSET ===
    if (!positions[asset]) {
      positions[asset] = {
        asset,
        qty: 0,
        avg: 0,
        history: [] // per analisi chiusure
      };
    }

    const pos = positions[asset];

    if (tipo === "Acquisto titoli") {
      const totalCost = pos.qty * pos.avg + Math.abs(amount);
      pos.qty += qty;
      pos.avg = totalCost / pos.qty;
      pos.history.push({ date, qty, price: Math.abs(amount) / qty, type: "BUY" });
    }

    if (tipo === "Vendita titoli") {
      const sellPrice = amount / qty;
      const realized = (sellPrice - pos.avg) * qty;

      pos.history.push({ date, qty, price: sellPrice, type: "SELL", realized });

      pos.qty -= qty;

      if (pos.qty <= 0) {
        // posizione chiusa completamente
        const details = buildClosedPositionReport(asset, pos.history);
        closedTrades.push(details);
        pos.qty = 0;
        pos.avg = 0;
        pos.history = [];
      }
    }
  });

  // POSIZIONI APERTE
  const open = Object.values(positions).filter(p => p.qty > 0);

  renderResults(open, closedTrades, dividends, taxes, fees);
}

/* === DETTAGLIO POSIZIONE CHIUSA === */

function buildClosedPositionReport(asset, hist) {

  const buys = hist.filter(h => h.type === "BUY");
  const sells = hist.filter(h => h.type === "SELL");

  const totalBuyQty = buys.reduce((s, b) => s + b.qty, 0);
  const totalSellQty = sells.reduce((s, b) => s + b.qty, 0);

  const avgPrice = buys.reduce((s, b) => s + b.qty * b.price, 0) / totalBuyQty;
  const sellValue = sells.reduce((s, b) => s + b.qty * b.price, 0);

  const pnl = sellValue - totalBuyQty * avgPrice;

  const firstBuy = buys[0].date;
  const lastSell = sells[sells.length - 1].date;

  const holdDays = Math.round((lastSell - firstBuy) / (1000 * 3600 * 24));

  return {
    asset,
    qty: totalBuyQty,
    sellQty: totalSellQty,
    avgPrice,
    sellValue,
    pnl,
    pnlPct: (pnl / (avgPrice * totalBuyQty)) * 100,
    holdDays
  };
}

/* === RENDER === */

function renderResults(openPositions, closed, dividends, taxes, fees) {
  const el = document.getElementById("results");
  el.classList.add("visible");

  const fmt = n => isFinite(n) ? n.toFixed(2) : "-";

  let html = `<h2>📊 Risultati Analisi</h2>`;

  // ==== RIEPILOGO ====
  const totalClosedPnL = closed.reduce((s, c) => s + c.pnl, 0);

  html += `
  <p><b>PNL chiuso:</b> ${fmt(totalClosedPnL)}</p>
  <p><b>Dividendi totali:</b> ${fmt(dividends)}</p>
  <p><b>Imposte totali:</b> ${fmt(taxes)}</p>
  <p><b>Spese/Competenze:</b> ${fmt(fees)}</p>
  <hr>
  `;

  // ==== POSIZIONI APERTE ====
  html += `<h3>📂 Posizioni Aperte</h3>`;
  if (openPositions.length === 0) {
    html += `<p>Nessuna posizione aperta.</p>`;
  } else {
    html += `<table>
      <tr><th>Asset</th><th>Quantità</th><th>Prezzo Medio</th></tr>`;

    openPositions.forEach(p => {
      html += `<tr>
        <td>${p.asset}</td>
        <td>${fmt(p.qty)}</td>
        <td>${fmt(p.avg)}</td>
      </tr>`;
    });

    html += `</table>`;
  }

  // ==== POSIZIONI CHIUSE ====
  html += `<h3>📁 Posizioni Chiuse (dettagliate)</h3>`;

  if (closed.length === 0) {
    html += `<p>Nessuna posizione chiusa.</p>`;
  } else {
    html += `<table>
      <tr>
        <th>Asset</th>
        <th>Qta Totale</th>
        <th>Prezzo Medio</th>
        <th>Incasso Vendite</th>
        <th>PNL</th>
        <th>Rendimento %</th>
        <th>Holding (giorni)</th>
      </tr>`;

    closed.forEach(c => {
      html += `<tr>
        <td>${c.asset}</td>
        <td>${fmt(c.qty)}</td>
        <td>${fmt(c.avgPrice)}</td>
        <td>${fmt(c.sellValue)}</td>
        <td>${fmt(c.pnl)}</td>
        <td>${fmt(c.pnlPct)}</td>
        <td>${c.holdDays}</td>
      </tr>`;
    });

    html += `</table>`;
  }

  el.innerHTML = html;
}
