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

        const CATEGORIES = ["Comida", "Transporte", "Vivienda", "Servicios", "Salud", "Entretenimiento", "Compras", "Educación", "Otros"];
        const CATEGORY_COLORS = {
            "Comida": "#e07a5f", "Transporte": "#3d5a80", "Vivienda": "#81b29a",
            "Servicios": "#f2cc8f", "Salud": "#e63946", "Entretenimiento": "#9b5de5",
            "Compras": "#f4a261", "Educación": "#457b9d", "Otros": "#6c757d",
        };

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
            form: { amount: "", category: CATEGORIES[0], note: "", date: todayStr() },
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

        function openNew() {
            S.view = "edit";
            S.editingId = null;
            const inCurrentMonth = S.month === monthStr(new Date());
            S.form = { amount: "", category: CATEGORIES[0], note: "", date: inCurrentMonth ? todayStr() : `${S.month}-01` };
            renderView();
        }

        function openEdit(item) {
            S.view = "edit";
            S.editingId = item.id;
            S.form = { amount: String(item.amount), category: item.category, note: item.note, date: item.date };
            renderView();
        }

        async function saveForm() {
            const amount = parseFloat(S.form.amount.replace(",", "."));
            if (!isFinite(amount) || amount <= 0) { alert("Poné un monto válido."); return; }
            try {
                await invoke("expenses_save", {
                    id: S.editingId,
                    amount,
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

        function renderSummary(items) {
            const wrap = el("div", { className: "gs-summary" });
            const total = items.reduce((sum, it) => sum + it.amount, 0);
            wrap.appendChild(el("div", { className: "gs-total-label", textContent: "Total del mes" }));
            wrap.appendChild(el("div", { className: "gs-total-amount", textContent: fmtMoney(total) }));

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

            if (items.length) {
                const byCategory = {};
                items.forEach(it => { byCategory[it.category] = (byCategory[it.category] || 0) + it.amount; });
                const sorted = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
                const max = sorted[0][1];
                const breakdown = el("div", { className: "gs-breakdown" });
                sorted.forEach(([cat, amt]) => {
                    const row = el("div", { className: "gs-cat-row" });
                    const color = CATEGORY_COLORS[cat] || "#6c757d";
                    row.innerHTML = `
                        <div class="gs-cat-label"><span class="gs-cat-dot" style="background:${color}"></span>${cat}</div>
                        <div class="gs-cat-bar-wrap"><div class="gs-cat-bar" style="width:${(amt / max * 100).toFixed(1)}%;background:${color}"></div></div>
                        <div class="gs-cat-amount"></div>`;
                    row.querySelector(".gs-cat-amount").textContent = fmtMoney(amt);
                    breakdown.appendChild(row);
                });
                wrap.appendChild(breakdown);
            }
            return wrap;
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

            const newBtn = el("button", { className: "primary gs-new-btn", textContent: "+ Nuevo gasto" });
            newBtn.onclick = openNew;
            root.appendChild(newBtn);

            if (S.loading) { root.appendChild(el("p", { className: "gs-empty", textContent: "Cargando..." })); return; }

            const items = itemsForMonth();
            root.appendChild(renderSummary(items));

            if (!items.length) {
                root.appendChild(el("p", { className: "gs-empty", textContent: "Sin gastos cargados este mes." }));
                return;
            }

            const list = el("div", { className: "gs-list" });
            items.forEach(item => {
                const row = el("div", { className: "gs-item" });
                row.onclick = () => openEdit(item);
                const color = CATEGORY_COLORS[item.category] || "#6c757d";
                const day = item.date.slice(8, 10);
                row.innerHTML = `
                    <div class="gs-item-day">${day}</div>
                    <div class="gs-item-main">
                        <div class="gs-item-cat"><span class="gs-cat-dot" style="background:${color}"></span>${item.category}</div>
                        <div class="gs-item-note"></div>
                    </div>
                    <div class="gs-item-amount"></div>
                    <button class="gs-item-delete" title="Borrar">🗑️</button>`;
                row.querySelector(".gs-item-note").textContent = item.note || "";
                row.querySelector(".gs-item-amount").textContent = fmtMoney(item.amount);
                row.querySelector(".gs-item-delete").onclick = (ev) => deleteItem(item.id, ev);
                list.appendChild(row);
            });
            root.appendChild(list);
        }

        function renderEdit() {
            const form = el("div", { className: "gs-form" });

            const amountRow = el("div", { className: "input-row" });
            const amountInp = el("input", { type: "number", step: "0.01", min: "0", value: S.form.amount, placeholder: "0.00" });
            amountInp.oninput = (e) => { S.form.amount = e.target.value; };
            amountRow.append(lbl("Monto"), amountInp);
            form.appendChild(amountRow);

            const catRow = el("div", { className: "input-row" });
            const catSel = el("select", {});
            CATEGORIES.forEach(c => catSel.appendChild(el("option", { value: c, textContent: c, selected: c === S.form.category })));
            catSel.onchange = (e) => { S.form.category = e.target.value; };
            catRow.append(lbl("Categoría"), catSel);
            form.appendChild(catRow);

            const dateRow = el("div", { className: "input-row" });
            const dateInp = el("input", { type: "date", value: S.form.date });
            dateInp.onchange = (e) => { S.form.date = e.target.value; };
            dateRow.append(lbl("Fecha"), dateInp);
            form.appendChild(dateRow);

            const noteRow = el("div", { className: "input-row" });
            const noteInp = el("input", { type: "text", value: S.form.note, placeholder: "Opcional" });
            noteInp.oninput = (e) => { S.form.note = e.target.value; };
            noteRow.append(lbl("Nota"), noteInp);
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
