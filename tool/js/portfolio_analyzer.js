document.getElementById("csvFile").addEventListener("change", handleFile);

function handleFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => parseCSV(e.target.result);
    reader.readAsText(file);
}

function parseCSV(csv) {
    const lines = csv.trim().split("\n").map(l => l.split(";"));

    const header = lines.shift();
    const idx = {
        descrizione: header.indexOf("DESCRIZIONE"),
        movimento: header.indexOf("MOVIMENTO"),
        qta: header.indexOf("QTA'"),
        importo: header.indexOf("IMPORTO"),
        data: header.indexOf("DATA"),
        tipologia: header.indexOf("TIPOLOGIA")
    };

    // CONTAINER DATI
    let positions = {};   // posizioni aperte
    let tradesClosed = []; // posizioni chiuse
    let equityHistory = [];
    let investedHistory = [];
    let poolHistory = [];
    let dates = [];

    let equity = 0;     // soldi investiti in posizioni aperte (al costo)
    let invested = 0;   // soldi ESTERNI immessi
    let pool = 0;       // profitti accumulati e reinvestibili

    // --- PARSING RIGHE ---
    for (const row of lines) {

        const descrizione = row[idx.descrizione];
        const movimento = row[idx.movimento];
        const tipologia = row[idx.tipologia];
        const qta = Number(row[idx.qta]);
        const importo = parseFloat(row[idx.importo].replace("€", "").replace(",", "."));
        const data = row[idx.data];

        let amount = importo;

        // LOGICA PRINCIPALE ---------------------------------------------------

        if (tipologia === "Acquisto titoli") {
            const costo = Math.abs(amount);

            // 1) Provo a pagare dalla pool
            if (pool >= costo) {
                pool -= costo;
            } else {
                const diff = costo - pool;
                pool = 0;
                invested += diff;  // soldi immessi
            }

            // 2) L'equity cresce del costo
            equity += costo;

            // 3) registro posizione
            if (!positions[descrizione]) positions[descrizione] = { q: 0, cost: 0 };
            positions[descrizione].cost += costo;
            positions[descrizione].q += qta;
        }


        else if (tipologia === "Vendita titoli") {

            if (!positions[descrizione]) continue;

            const pos = positions[descrizione];
            const qtaVenduta = qta;
            const ricavo = amount;

            const costo_medio = pos.cost / pos.q;
            const costoVenduto = costo_medio * qtaVenduta;

            const profitto = ricavo - costoVenduto;

            // aggiorno pool (solo profitti!)
            pool += profitto;

            // equity scende del COSTO, non del ricavo
            equity -= costoVenduto;

            // aggiorno posizione rimanente
            pos.q -= qtaVenduta;
            pos.cost -= costoVenduto;

            // se chiusa completamente:
            if (pos.q === 0) delete positions[descrizione];

        }


        else if (tipologia === "Accredito dividendi") {
            pool += amount;
        }


        else if (tipologia === "Competenze" || tipologia === "Imposta") {

            const costo = Math.abs(amount);

            if (pool >= costo) {
                pool -= costo;
            } else {
                const diff = costo - pool;
                pool = 0;
                invested += diff;
            }
        }

        // --------------------------------------------------------------

        dates.push(data);
        equityHistory.push(equity);
        investedHistory.push(invested);
        poolHistory.push(pool);
    }

    renderCharts(dates, equityHistory, investedHistory, poolHistory);
}

// GRAFICI -----------------------------------------------------------------

function renderCharts(dates, equity, invested, pool) {

    const ctx = document.getElementById("chartEquity").getContext("2d");

    if (window.equityChart) window.equityChart.destroy();

    window.equityChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: dates,
            datasets: [
                {
                    label: "Equity",
                    data: equity,
                    borderColor: "#3b82f6",
                    backgroundColor: "transparent",
                    borderWidth: 3,
                    tension: 0.3
                },
                {
                    label: "Invested (soldi tuoi)",
                    data: invested,
                    borderColor: "#22c55e",
                    backgroundColor: "transparent",
                    borderWidth: 3,
                    tension: 0.3
                },
                {
                    label: "Pool (profitti disponibili)",
                    data: pool,
                    borderColor: "yellow",
                    backgroundColor: "transparent",
                    borderDash: [5,5],
                    borderWidth: 3,
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            scales: {
                y: { beginAtZero: false }
            }
        }
    });
}
