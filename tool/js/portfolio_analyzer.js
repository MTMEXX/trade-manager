// === PORTFOLIO ANALYZER JS ===
// Si aspetta un CSV con intestazioni almeno:
// date, asset, side, quantity, price, commission
// side: BUY / SELL

/* === UTILS === */

// parsing numero con supporto a virgola e spazi
function parseNum(value) {
  if (value === undefined || value === null) return NaN;
  return parseFloat(
    value
      .toString()
      .trim()
      .replace(".", ".")  // per sicurezza, no-op
      .replace(",", ".")  // converte virgola in punto
  );
}

/* === HANDLER BOTTONE === */

document.getElementById("analyzeBtn").addEventListener("click", () => {
  const file = document.getElementById("csvFile").files[0];
  if (!file) {
    alert("Carica un file CSV prima.");
    return;
  }

  const reader = new FileReader();
  reader.onload = e => parseCSV(e.target.result);
  reader.readAsText(file);
});

/* === PARSING CSV === */
function parseCSV(text) {
  // Proviamo a capire se il separatore è , o ;
  const firstLine = text.split("\n")[0];
  const delimiter = firstLine.includes(";") ? ";" : ",";

  const rows = text
    .trim()
    .split("\n")
    .map(r => r.split(delimiter));

  if (rows.length < 2) {
    alert("CSV vuoto o con solo intestazioni.");
    return;
  }

  const headers = rows[0].map(h => h.trim());
  const trades = rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = (row[i] !== undefined ? row[i] : "").trim();
    });
    return obj;
  });

  analyzeTrades(trades);
}

/* === LOGICA DI ANALISI === */
function analyzeTrades(trades) {
  let closedPnL = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  let losses = 0;
  let totalCommission = 0;
  let numTrades = 0;

  const positions = {}; // asset -> { qty, avg }

  trades.forEach(t => {
    const asset = t.asset;
    const side = (t.side || "").toUpperCase();
    const q = parseNum(t.quantity);
    const p = parseNum(t.price);
    const c = parseNum(t.commission) || 0;

    if (!asset || !side || !isFinite(q) || !isFinite(p)) {
      return; // salta righe mal formate
    }

    totalCommission += c;
    numTrades++;

    if (!positions[asset]) {
      positions[asset] = { qty: 0, avg: 0 };
    }
    const pos = positions[asset];

    if (side === "BUY") {
      // nuovo costo totale = costo esistente + nuova spesa (prezzo*qty + commissione)
      const oldValue = pos.qty * pos.avg;
      const newValue = oldValue + q * p + c;
      pos.qty += q;
      pos.avg = pos.qty > 0 ? newValue / pos.qty : 0;
    } else if (side === "SELL") {
      if (pos.qty <= 0) {
        // se non abbiamo posizione, comunque calcoliamo PnL vs prezzo (edge case)
        const realized = -c; // di fatto perdita di sola commissione
        closedPnL += realized;
        if (realized >= 0) {
          wins++;
          grossProfit += realized;
        } else {
          losses++;
          grossLoss += realized;
        }
      } else {
        // realizzo: (prezzo vendita - prezzo medio) * quantità - commissione
        const sellQty = Math.min(q, pos.qty);
        const realized = (p - pos.avg) * sellQty - c;
        closedPnL += realized;

        if (realized >= 0) {
          wins++;
          grossProfit += realized;
        } else {
          losses++;
          grossLoss += realized;
        }

        pos.qty -= sellQty;
        if (pos.qty <= 0) {
          pos.qty = 0;
          pos.avg = 0;
        }
      }
    }
  });

  // Posizioni ancora aperte
  const openPositions = Object.entries(positions)
    .filter(([_, p]) => p.qty > 0)
    .map(([asset, p]) => ({
      asset,
      quantity: p.qty,
      avgPrice: p.avg
    }));

  // metriche derivate
  const totalTradesClosed = wins + losses;
  const winRate = totalTradesClosed > 0 ? (wins / totalTradesClosed) * 100 : 0;
  const avgWin = wins > 0 ? grossProfit / wins : 0;
  const avgLoss = losses > 0 ? grossLoss / losses : 0; // grossLoss è negativo
  const payoff = (avgWin > 0 && avgLoss < 0) ? (avgWin / Math.abs(avgLoss)) : 0;

  renderResults({
    closedPnL,
    grossProfit,
    grossLoss,
    wins,
    losses,
    winRate,
    avgWin,
    avgLoss,
    payoff,
    totalCommission,
    numTrades,
    openPositions
  });
}

/* === RENDER RISULTATI === */
function renderResults(data) {
  const card = document.getElementById("results");
  card.classList.add("visible");

  const fmt = (v, dec = 2) =>
    isFinite(v) ? v.toFixed(dec) : "-";

  let html = `
    <h2>📊 Risultati Analisi</h2>

    <p><b>Trades totali:</b> ${data.numTrades}</p>
    <p><b>PNL chiuso netto:</b> ${fmt(data.closedPnL)} </p>
    <p><b>Profitto lordo:</b> ${fmt(data.grossProfit)} | 
       <b>Perdita lorda:</b> ${fmt(data.grossLoss)}</p>
    <p><b>Win rate:</b> ${data.wins}/${data.wins + data.losses} 
       (${fmt(data.winRate, 1)}%)</p>
    <p><b>Commissioni totali:</b> ${fmt(data.totalCommission)}</p>
    <p><b>Average win:</b> ${fmt(data.avgWin)} | 
       <b>Average loss:</b> ${fmt(data.avgLoss)}</p>
    <p><b>Payoff ratio (avg win / avg loss):</b> ${fmt(data.payoff, 2)}</p>

    <h3>📂 Posizioni Aperte</h3>
  `;

  if (data.openPositions.length === 0) {
    html += `<p>Nessuna posizione aperta rilevata dal CSV.</p>`;
  } else {
    html += `
      <table>
        <tr>
          <th>Asset</th>
          <th>Quantità</th>
          <th>Prezzo medio</th>
        </tr>
    `;
    data.openPositions.forEach(p => {
      html += `
        <tr>
          <td>${p.asset}</td>
          <td>${fmt(p.quantity, 4)}</td>
          <td>${fmt(p.avgPrice, 4)}</td>
        </tr>
      `;
    });
    html += `</table>`;
  }

  card.innerHTML = html;
}
