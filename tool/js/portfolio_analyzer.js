// === PORTFOLIO ANALYZER JS ===
// Formato CSV atteso (intestazioni MAIUSCOLE):
// DESCRIZIONE, MOVIMENTO, QTA', IMPORTO, DATA, TIPOLOGIA
//
// MOVIMENTO: "Entrata" / "Uscita"
// TIPOLOGIA: "Acquisto titoli", "Vendita titoli",
//            "Accredito dividendi", "Competenze", "Imposta"
//
// IMPORTO: totale movimento sul conto (con virgola decimale, simbolo €, ecc.)
//          es. "-1.211,88 €"  oppure "349,91 €"
// QTA': quantità positiva

/* ================== UTILS ================== */

// parsing numero con supporto a virgola, punti migliaia, spazi e €
function parseNum(value) {
  if (value === undefined || value === null) return NaN;
  let s = value.toString().trim();

  // rimuovi euro e spazi (compresi non-breaking)
  s = s.replace(/€/g, "");
  s = s.replace(/\u00A0/g, ""); // NBSP
  s = s.replace(/\s/g, "");

  // rimuovi punti (migliaia) e converti virgola in punto
  s = s.replace(/\./g, "");
  s = s.replace(",", ".");

  if (!s) return NaN;
  const n = parseFloat(s);
  return isNaN(n) ? NaN : n;
}

/* ================== HANDLER BOTTONE ================== */

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

/* ================== PARSING CSV ================== */

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    alert("CSV vuoto o con solo intestazioni.");
    return;
  }

  // rileva delimitatore , oppure ;
  const firstLine = lines[0];
  const delimiter = firstLine.includes(";") ? ";" : ",";

  // intestazioni normalizzate in MAIUSCOLO, rimuovendo eventuale BOM
  const headers = firstLine.split(delimiter).map(h =>
    h.replace(/^\uFEFF/, "").trim().toUpperCase()
  );

  const trades = lines.slice(1).map(line => {
    const cols = line.split(delimiter);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = (cols[i] !== undefined ? cols[i] : "").trim();
    });
    return obj;
  });

  analyzeTrades(trades);
}

/* ================== LOGICA DI ANALISI ================== */

function analyzeTrades(trades) {
  // PnL trading (solo vendite titoli)
  let realizedPnL = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  let losses = 0;

  // altri flussi
  let totalDividends = 0;   // Accredito dividendi
  let totalTaxes = 0;       // Imposta
  let totalFees = 0;        // Competenze (spese gestione, bollo, ecc.)

  const positions = {}; // asset -> { qty, avg }

  trades.forEach(t => {
    const asset = (t["DESCRIZIONE"] || "").trim();
    const tipo = (t["TIPOLOGIA"] || "").toLowerCase();
    const movimento = (t["MOVIMENTO"] || "").toLowerCase(); // entrata/uscita

    const qty = parseNum(t["QTA'"]);
    const amount = parseNum(t["IMPORTO"]); // può essere + o -

    if (!asset && !tipo) return; // riga vuota

    // --- Acquisto titoli (BUY) ---
    if (tipo.includes("acquisto titoli")) {
      if (!isFinite(qty) || !isFinite(amount)) return;

      if (!positions[asset]) {
        positions[asset] = { qty: 0, avg: 0 };
      }
      const pos = positions[asset];

      // IMPORTO è negativo (uscita), quindi costo = valore assoluto
      const cost = Math.abs(amount);
      const oldCost = pos.qty * pos.avg;
      const newCost = oldCost + cost;
      const newQty = pos.qty + qty;

      pos.qty = newQty;
      pos.avg = newQty > 0 ? newCost / newQty : 0;
    }

    // --- Vendita titoli (SELL) ---
    else if (tipo.includes("vendita titoli")) {
      if (!isFinite(qty) || !isFinite(amount)) return;

      if (!positions[asset]) {
        positions[asset] = { qty: 0, avg: 0 };
      }
      const pos = positions[asset];

      const sellQty = qty;
      const proceeds = amount; // IMPORTO è positivo (entrata)

      // se non abbiamo posizione, consideriamo comunque il flusso (edge case)
      const effectiveQty = Math.min(sellQty, pos.qty > 0 ? pos.qty : sellQty);
      const costBasis = pos.avg * effectiveQty;
      const realized = proceeds - costBasis;

      realizedPnL += realized;
      if (realized >= 0) {
        wins++;
        grossProfit += realized;
      } else {
        losses++;
        grossLoss += realized;
      }

      pos.qty = pos.qty - sellQty;
      if (pos.qty < 0) pos.qty = 0;
      if (pos.qty === 0) pos.avg = 0;
    }

    // --- Accredito dividendi ---
    else if (tipo.includes("accredito dividendi")) {
      if (!isFinite(amount)) return;
      totalDividends += amount; // di solito positivo
    }

    // --- Imposta (capital gain, ritenute, ecc.) ---
    else if (tipo.includes("imposta")) {
      if (!isFinite(amount)) return;
      totalTaxes += amount; // tipicamente negativo
    }

    // --- Competenze (spese gestione, bollo, interessi, ecc.) ---
    else if (tipo.includes("competenze")) {
      if (!isFinite(amount)) return;
      totalFees += amount; // in genere negativo, ma lo teniamo col segno
    }

    // altri tipi ignorati per ora
  });

  // Posizioni aperte (solo dove qty > 0)
  const openPositions = Object.entries(positions)
    .filter(([_, p]) => p.qty > 0)
    .map(([asset, p]) => ({
      asset,
      quantity: p.qty,
      avgPrice: p.avg
    }));

  const closedTrades = wins + losses;
  const winRate = closedTrades > 0 ? (wins / closedTrades) * 100 : 0;
  const avgWin = wins > 0 ? grossProfit / wins : 0;
  const avgLoss = losses > 0 ? grossLoss / losses : 0; // grossLoss è negativo
  const payoff =
    avgWin > 0 && avgLoss < 0 ? avgWin / Math.abs(avgLoss) : 0;

  // PnL complessivo: trading + dividendi + imposte + spese
  // (imposte e spese sono numeri negativi, quindi riducono il totale)
  const netPnL = realizedPnL + totalDividends + totalTaxes + totalFees;

  renderResults({
    realizedPnL,
    grossProfit,
    grossLoss,
    wins,
    losses,
    winRate,
    avgWin,
    avgLoss,
    payoff,
    totalDividends,
    totalTaxes,
    totalFees,
    netPnL,
    openPositions
  });
}

/* ================== RENDER RISULTATI ================== */

function renderResults(data) {
  const card = document.getElementById("results");
  card.classList.add("visible");

  const fmt = (v, dec = 2) =>
    isFinite(v) ? v.toFixed(dec) : "-";

  let html = `
    <h2>📊 Risultati Analisi</h2>

    <p><b>PNL trading (vendite titoli):</b> ${fmt(data.realizedPnL)} €</p>
    <p><b>Dividendi totali:</b> ${fmt(data.totalDividends)} €</p>
    <p><b>Imposte totali:</b> ${fmt(data.totalTaxes)} €</p>
    <p><b>Costi di gestione / competenze:</b> ${fmt(data.totalFees)} €</p>
    <p><b>PNL netto complessivo:</b> ${fmt(data.netPnL)} €</p>

    <hr style="border-color:#1f2937; margin:16px 0;">

    <p><b>Trade chiusi:</b> ${data.wins + data.losses}</p>
    <p><b>Win rate:</b> ${data.wins}/${data.wins + data.losses} (${fmt(data.winRate, 1)}%)</p>
    <p><b>Average win:</b> ${fmt(data.avgWin)} € |
       <b>Average loss:</b> ${fmt(data.avgLoss)} €</p>
    <p><b>Payoff ratio (avg win / avg loss):</b> ${fmt(data.payoff, 2)}</p>

    <h3>📂 Posizioni aperte</h3>
  `;

  if (!data.openPositions.length) {
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
          <td>${fmt(p.avgPrice, 4)} €</td>
        </tr>
      `;
    });
    html += `</table>`;
  }

  card.innerHTML = html;
}
