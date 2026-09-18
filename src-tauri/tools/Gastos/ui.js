// ui.js — Gastos (mobile).
//
// Sin herramienta equivalente en escritorio -- alcance de esta primera
// versión: cargar gastos (monto, categoría, nota, fecha), navegar mes a
// mes, ver el total y un desglose por categoría. NO persistente (tool.json)
// -- se vuelve a pedir la lista a Rust cada vez que se entra, mismo
// espíritu que Ideas rápidas.
registerRenderer("gastos", {
    render(tool, area) {
        const root = el("div", { className: "gs-root" });
        area.appendChild(root);

        const EXPENSE_CATEGORIES = ["Comida", "Transporte", "Vivienda", "Servicios", "Salud", "Entretenimiento", "Compras", "Educación", "Otros"];
        const EXPENSE_COLORS = {
            "Comida": "#e07a5f", "Transporte": "#3d5a80", "Vivienda": "#81b29a",
            "Servicios": "#f2cc8f", "Salud": "#e63946", "Entretenimiento": "#9b5de5",
            "Compras": "#f4a261", "Educación": "#457b9d", "Otros": "#6c757d",
        };
        // NUEVO (pedido del usuario -- también poder cargar ingresos):
        // lista de categorías propia (no tendría sentido reusar "Comida"/
        // "Transporte" para un ingreso) con sus propios colores, elegida
        // dinámicamente según S.form.kind al armar el formulario.
        const INCOME_CATEGORIES = ["Sueldo", "Freelance", "Ventas", "Regalo", "Reembolso", "Inversiones", "Otro"];
        const INCOME_COLORS = {
            "Sueldo": "#2a9d8f", "Freelance": "#219ebc", "Ventas": "#8ac926", "Regalo": "#ffb703",
            "Reembolso": "#06d6a0", "Inversiones": "#118ab2", "Otro": "#6c757d",
        };
        function categoriesFor(kind) { return kind === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES; }
        function colorsFor(kind) { return kind === "income" ? INCOME_COLORS : EXPENSE_COLORS; }
        function colorFor(item) { return colorsFor(item.kind)[item.category] || "#6c757d"; }

        function todayStr() {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        }
        function monthStr(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }

        const S = {
            view: "list", // list | edit
            data: { currencySymbol: "$", items: [] },
            month: monthStr(new Date()),
            editingId: null,
            form: { kind: "expense", amount: "", category: EXPENSE_CATEGORIES[0], note: "", date: todayStr() },
            loading: true,
            showCurrencyEdit: false,
        };

        function fmtMoney(n) {
            const rounded = Math.round(n * 100) / 100;
            return `${S.data.currencySymbol}${rounded.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
        }

        function monthLabel(m) {
            const [y, mo] = m.split("-").map(Number);
            const names = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
            return `${names[mo - 1]} ${y}`;
        }

        function shiftMonth(m, delta) {
            const [y, mo] = m.split("-").map(Number);
            const d = new Date(y, mo - 1 + delta, 1);
            return monthStr(d);
        }

        function itemsForMonth() {
            return S.data.items.filter(it => it.date.startsWith(S.month));
        }

        async function loadData() {
            S.loading = true;
            renderView();
            try { S.data = await invoke("expenses_list"); } catch (e) { /* mantiene lo que había */ }
            S.loading = false;
            renderView();
        }

        function openNew(kind) {
            S.view = "edit";
            S.editingId = null;
            const inCurrentMonth = S.month === monthStr(new Date());
            S.form = { kind: kind || "expense", amount: "", category: categoriesFor(kind || "expense")[0], note: "", date: inCurrentMonth ? todayStr() : `${S.month}-01` };
            renderView();
        }

        function openEdit(item) {
            S.view = "edit";
            S.editingId = item.id;
            S.form = { kind: item.kind || "expense", amount: String(item.amount), category: item.category, note: item.note, date: item.date };
            renderView();
        }

        async function saveForm() {
            const amount = parseFloat(S.form.amount.replace(",", "."));
            if (!isFinite(amount) || amount <= 0) { alert("Poné un monto válido."); return; }
            try {
                await invoke("expenses_save", {
                    id: S.editingId,
                    amount,
                    kind: S.form.kind,
                    category: S.form.category,
                    note: S.form.note.trim(),
                    date: S.form.date,
                });
            } catch (e) { alert("Error: " + e); return; }
            S.view = "list";
            await loadData();
        }

        async function deleteItem(id, ev) {
            ev.stopPropagation();
            if (!confirm("¿Borrar este gasto?")) return;
            try { await invoke("expenses_delete", { id }); } catch (e) { alert("Error: " + e); return; }
            await loadData();
        }

        async function setCurrency(symbol) {
            S.data.currencySymbol = symbol || "$";
            try { await invoke("expenses_set_currency", { symbol: S.data.currencySymbol }); } catch (e) { /* best effort */ }
            renderView();
        }

        // NUEVO (pedido del usuario -- ver estadísticas generales del mes,
        // no solo el total): separa ingresos de gastos con su propio total
        // cada uno + el balance (ingresos - gastos), y un desglose por
        // categoría PARA CADA UNO (antes solo había un desglose, que
        // mezclaba todo bajo las categorías de gasto).
        function renderBreakdown(title, items, colors) {
            const box = el("div", { className: "gs-breakdown-box" });
            box.appendChild(el("div", { className: "gs-breakdown-title", textContent: title }));
            const byCategory = {};
            items.forEach(it => { byCategory[it.category] = (byCategory[it.category] || 0) + it.amount; });
            const sorted = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
            const max = sorted[0][1];
            const breakdown = el("div", { className: "gs-breakdown" });
            sorted.forEach(([cat, amt]) => {
                const row = el("div", { className: "gs-cat-row" });
                const color = colors[cat] || "#6c757d";
                row.innerHTML = `
                    <div class="gs-cat-label"><span class="gs-cat-dot" style="background:${color}"></span>${cat}</div>
                    <div class="gs-cat-bar-wrap"><div class="gs-cat-bar" style="width:${(amt / max * 100).toFixed(1)}%;background:${color}"></div></div>
                    <div class="gs-cat-amount"></div>`;
                row.querySelector(".gs-cat-amount").textContent = fmtMoney(amt);
                breakdown.appendChild(row);
            });
            box.appendChild(breakdown);
            return box;
        }

        function renderSummary(items) {
            const wrap = el("div", { className: "gs-summary" });
            const incomes = items.filter(it => it.kind === "income");
            const expenses = items.filter(it => it.kind !== "income");
            const totalIncome = incomes.reduce((sum, it) => sum + it.amount, 0);
            const totalExpense = expenses.reduce((sum, it) => sum + it.amount, 0);
            const balance = totalIncome - totalExpense;

            const totalsRow = el("div", { className: "gs-totals-row" });
            const incomeBlock = el("div", { className: "gs-total-block gs-total-block--income" });
            incomeBlock.appendChild(el("div", { className: "gs-total-label", textContent: "Ingresos" }));
            incomeBlock.appendChild(el("div", { className: "gs-total-amount", textContent: fmtMoney(totalIncome) }));
            const expenseBlock = el("div", { className: "gs-total-block gs-total-block--expense" });
            expenseBlock.appendChild(el("div", { className: "gs-total-label", textContent: "Gastos" }));
            expenseBlock.appendChild(el("div", { className: "gs-total-amount", textContent: fmtMoney(totalExpense) }));
            totalsRow.append(incomeBlock, expenseBlock);
            wrap.appendChild(totalsRow);
            wrap.appendChild(el("div", {
                className: `gs-balance${balance < 0 ? " gs-balance--negative" : ""}`,
                textContent: `Balance del mes: ${fmtMoney(balance)}`,
            }));

            const currencyRow = el("div", { className: "gs-currency-row" });
            const currencyBtn = el("button", { className: "gs-currency-btn", textContent: `Moneda: ${S.data.currencySymbol}` });
            currencyBtn.onclick = () => { S.showCurrencyEdit = !S.showCurrencyEdit; renderView(); };
            currencyRow.appendChild(currencyBtn);
            wrap.appendChild(currencyRow);
            if (S.showCurrencyEdit) {
                const inp = el("input", { type: "text", value: S.data.currencySymbol, className: "gs-currency-inp" });
                inp.onchange = (e) => setCurrency(e.target.value.trim());
                wrap.appendChild(inp);
            }

            if (expenses.length) wrap.appendChild(renderBreakdown("Gastos por categoría", expenses, EXPENSE_COLORS));
            if (incomes.length) wrap.appendChild(renderBreakdown("Ingresos por categoría", incomes, INCOME_COLORS));
            return wrap;
        }

        // NUEVO (pedido del usuario -- "si un mes pasado/futuro no tiene
        // info, que diga eso, no que muestre la misma pestaña
        // predeterminada"): "YYYY-MM" compara bien como string (mismo
        // ancho, cero-padeado) sin necesidad de parsear fechas.
        function emptyMonthMessage() {
            const current = monthStr(new Date());
            if (S.month > current) return "Todavía no llegaste a este mes.";
            if (S.month < current) return "No hay gastos ni ingresos registrados en este mes.";
            return "Sin gastos ni ingresos cargados este mes.";
        }

        function renderList() {
            const monthBar = el("div", { className: "gs-month-bar" });
            const prevBtn = el("button", { className: "gs-month-nav", textContent: "‹" });
            prevBtn.onclick = () => { S.month = shiftMonth(S.month, -1); renderView(); };
            const nextBtn = el("button", { className: "gs-month-nav", textContent: "›" });
            nextBtn.onclick = () => { S.month = shiftMonth(S.month, 1); renderView(); };
            const label = el("div", { className: "gs-month-label", textContent: monthLabel(S.month) });
            monthBar.append(prevBtn, label, nextBtn);
            root.appendChild(monthBar);

            const newRow = el("div", { className: "gs-new-row" });
            const newExpenseBtn = el("button", { className: "primary gs-new-btn", textContent: "+ Gasto" });
            newExpenseBtn.onclick = () => openNew("expense");
            const newIncomeBtn = el("button", { className: "gs-new-btn gs-new-btn--income", textContent: "+ Ingreso" });
            newIncomeBtn.onclick = () => openNew("income");
            newRow.append(newExpenseBtn, newIncomeBtn);
            root.appendChild(newRow);

            if (S.loading) { root.appendChild(el("p", { className: "gs-empty", textContent: "Cargando..." })); return; }

            const items = itemsForMonth();
            root.appendChild(renderSummary(items));

            if (!items.length) {
                root.appendChild(el("p", { className: "gs-empty", textContent: emptyMonthMessage() }));
                return;
            }

            const list = el("div", { className: "gs-list" });
            items.forEach(item => {
                const row = el("div", { className: "gs-item" });
                row.onclick = () => openEdit(item);
                const color = colorFor(item);
                const day = item.date.slice(8, 10);
                const sign = item.kind === "income" ? "+" : "-";
                row.innerHTML = `
                    <div class="gs-item-day">${day}</div>
                    <div class="gs-item-main">
                        <div class="gs-item-cat"><span class="gs-cat-dot" style="background:${color}"></span>${item.category}</div>
                        <div class="gs-item-note"></div>
                    </div>
                    <div class="gs-item-amount${item.kind === "income" ? " gs-item-amount--income" : ""}"></div>
                    <button class="gs-item-delete" title="Borrar">${window.AlejoIcons ? window.AlejoIcons.glyph("trash", 18) : "×"}</button>`;
                row.querySelector(".gs-item-note").textContent = item.note || "";
                row.querySelector(".gs-item-amount").textContent = `${sign}${fmtMoney(item.amount)}`;
                row.querySelector(".gs-item-delete").onclick = (ev) => deleteItem(item.id, ev);
                list.appendChild(row);
            });
            root.appendChild(list);
        }

        function renderEdit() {
            const form = el("div", { className: "gs-form" });

            const kindRow = el("div", { className: "gs-kind-row" });
            [["expense", "Gasto"], ["income", "Ingreso"]].forEach(([k, label]) => {
                const btn = el("button", { className: `gs-kind-btn${S.form.kind === k ? " gs-kind-btn--active" : ""}`, textContent: label });
                // Cambiar de tipo reinicia la categoría a la primera de la
                // lista correspondiente -- las categorías de gasto no
                // tienen sentido para un ingreso y viceversa (ver
                // categoriesFor).
                btn.onclick = () => { S.form.kind = k; S.form.category = categoriesFor(k)[0]; renderView(); };
                kindRow.appendChild(btn);
            });
            form.appendChild(kindRow);

            const amountRow = el("div", { className: "input-row" });
            const amountInp = el("input", { id: "gs-amount-inp", type: "number", step: "0.01", min: "0", value: S.form.amount, placeholder: "0.00" });
            amountInp.oninput = (e) => { S.form.amount = e.target.value; };
            amountRow.append(lbl("Monto", "gs-amount-inp"), amountInp);
            form.appendChild(amountRow);

            const catRow = el("div", { className: "input-row" });
            const catSel = el("select", { id: "gs-cat-sel" });
            categoriesFor(S.form.kind).forEach(c => catSel.appendChild(el("option", { value: c, textContent: c, selected: c === S.form.category })));
            catSel.onchange = (e) => { S.form.category = e.target.value; };
            catRow.append(lbl("Categoría", "gs-cat-sel"), catSel);
            form.appendChild(catRow);

            const dateRow = el("div", { className: "input-row" });
            const dateInp = el("input", { id: "gs-date-inp", type: "date", value: S.form.date });
            dateInp.onchange = (e) => { S.form.date = e.target.value; };
            dateRow.append(lbl("Fecha", "gs-date-inp"), dateInp);
            form.appendChild(dateRow);

            const noteRow = el("div", { className: "input-row" });
            const noteInp = el("input", { id: "gs-note-inp", type: "text", value: S.form.note, placeholder: "Opcional" });
            noteInp.oninput = (e) => { S.form.note = e.target.value; };
            noteRow.append(lbl("Nota", "gs-note-inp"), noteInp);
            form.appendChild(noteRow);

            root.appendChild(form);

            const actions = el("div", { className: "sm-row-actions" });
            const saveBtn = el("button", { className: "primary", textContent: "Guardar" });
            saveBtn.onclick = saveForm;
            const cancelBtn = el("button", { textContent: "Cancelar" });
            cancelBtn.onclick = () => { S.view = "list"; renderView(); };
            actions.append(saveBtn, cancelBtn);
            root.appendChild(actions);
        }

        function renderView() {
            root.innerHTML = "";
            if (S.view === "list") renderList();
            else renderEdit();
        }

        loadData();
    },
    onOutput() {},
    onDone() {},
});
