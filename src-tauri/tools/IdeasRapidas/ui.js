// ui.js — Ideas rápidas (mobile).
//
// NO persistente (tool.json) -- la lista se vuelve a pedir a Rust cada vez
// que se entra, siempre desde el archivo guardado (ver notes.rs).
//
// NUEVO (pedido del usuario): categorías propias (nombre + color, creadas
// libremente por el usuario, ver notes_categories_* en notes.rs) y poder
// meter un dibujo simple en cualquier punto de una idea. Para esto último
// una nota deja de ser un textarea único y pasa a ser una secuencia de
// "bloques" (texto o dibujo) -- entre cada dos bloques hay un inserter
// (+) para agregar texto o un dibujo justo ahí, así el dibujo puede
// quedar intercalado entre dos párrafos y no solo pegado al final.
registerRenderer("ideasrapidas", {
    render(tool, area) {
        const root = el("div", { className: "nt-root" });
        area.appendChild(root);

        const CATEGORY_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899", "#64748b", "#78350f"];

        const S = {
            view: "list", // list | edit | draw | categories
            notes: [],
            categories: [],
            activeCategory: null, // filtro de la lista, null = todas
            loading: true,
            editingId: null,
            editingBlocks: [], // [{type:"text",value}|{type:"drawing",dataUrl}]
            editingCategoryId: null,
            insertAt: null, // índice del inserter (+) abierto, o null
            newCatName: "",
            newCatColor: CATEGORY_COLORS[0],
            catError: "",
            draw: null, // { targetIndex, insertNew, dataUrl } mientras S.view === "draw"
        };

        function fmtDate(ms) {
            const d = new Date(ms);
            const today = new Date();
            const sameDay = d.toDateString() === today.toDateString();
            const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            return sameDay ? time : d.toLocaleDateString() + " " + time;
        }

        function categoryById(id) { return S.categories.find(c => c.id === id) || null; }

        function previewText(note) {
            const t = (note.blocks || []).filter(b => b.type === "text").map(b => b.value).join(" ").trim();
            if (t) return t.length > 140 ? t.slice(0, 140) + "…" : t;
            return (note.blocks || []).some(b => b.type === "drawing") ? "(dibujo)" : "(idea vacía)";
        }

        async function loadAll() {
            S.loading = true;
            renderView();
            try {
                const [notes, cats] = await Promise.all([invoke("notes_list"), invoke("notes_categories_list")]);
                S.notes = notes;
                S.categories = cats;
            } catch (e) { S.notes = []; S.categories = []; }
            S.loading = false;
            renderView();
        }

        function openNew() {
            S.view = "edit";
            S.editingId = null;
            S.editingBlocks = [{ type: "text", value: "" }];
            S.editingCategoryId = S.activeCategory;
            S.insertAt = null;
            renderView();
        }

        function openEdit(note) {
            S.view = "edit";
            S.editingId = note.id;
            S.editingBlocks = (note.blocks && note.blocks.length) ? note.blocks.map(b => ({ ...b })) : [{ type: "text", value: "" }];
            S.editingCategoryId = note.categoryId || null;
            S.insertAt = null;
            renderView();
        }

        function hasContent() {
            return S.editingBlocks.some(b => (b.type === "text" && b.value.trim()) || b.type === "drawing");
        }

        async function saveNote() {
            if (!hasContent()) { S.view = "list"; renderView(); return; }
            // Bloques de texto vacíos entre dibujos no aportan nada -- se
            // sacan antes de guardar (pero se conserva al menos uno si todo
            // termina vacío, para no perder el orden si el usuario vuelve a
            // editar).
            const blocks = S.editingBlocks.filter(b => b.type === "drawing" || b.value.trim() !== "");
            try {
                await invoke("notes_save", { id: S.editingId, blocks, categoryId: S.editingCategoryId });
            } catch (e) { alert("Error: " + e); return; }
            S.view = "list";
            await loadAll();
        }

        async function deleteNote(id, ev) {
            ev.stopPropagation();
            if (!confirm("¿Borrar esta idea?")) return;
            try { await invoke("notes_delete", { id }); } catch (e) { alert("Error: " + e); return; }
            await loadAll();
        }

        // ── Categorías ──
        async function createCategory() {
            S.catError = "";
            try {
                await invoke("notes_categories_save", { name: S.newCatName, color: S.newCatColor });
            } catch (e) { S.catError = String(e); renderView(); return; }
            S.newCatName = "";
            const cats = await invoke("notes_categories_list").catch(() => S.categories);
            S.categories = cats;
            renderView();
        }

        async function deleteCategory(id) {
            if (!confirm("¿Borrar esta categoría? Las ideas que la tenían quedan sin categoría.")) return;
            try { await invoke("notes_categories_delete", { id }); } catch (e) { alert("Error: " + e); return; }
            if (S.activeCategory === id) S.activeCategory = null;
            await loadAll();
            S.view = "categories";
            renderView();
        }

        function renderCategoryChips(selectedId, onSelect, includeAll) {
            const wrap = el("div", { className: "nt-chip-row" });
            if (includeAll) {
                const allChip = el("button", { className: `nt-chip${selectedId == null ? " nt-chip--active" : ""}`, textContent: "Todas" });
                allChip.onclick = () => onSelect(null);
                wrap.appendChild(allChip);
            }
            S.categories.forEach(c => {
                const chip = el("button", { className: `nt-chip${selectedId === c.id ? " nt-chip--active" : ""}` });
                chip.innerHTML = `<span class="nt-chip-dot" style="background:${c.color}"></span>${c.name}`;
                chip.onclick = () => onSelect(c.id);
                wrap.appendChild(chip);
            });
            const addChip = el("button", { className: "nt-chip nt-chip--add", textContent: "+ Categoría" });
            addChip.onclick = () => { S.view = "categories"; renderView(); };
            wrap.appendChild(addChip);
            return wrap;
        }

        function renderCategoriesView() {
            root.appendChild(el("div", { className: "nt-cat-title", textContent: "Categorías" }));

            const list = el("div", { className: "nt-cat-list" });
            if (!S.categories.length) {
                list.appendChild(el("p", { className: "nt-empty", textContent: "Todavía no creaste ninguna categoría." }));
            }
            S.categories.forEach(c => {
                const row = el("div", { className: "nt-cat-row" });
                row.innerHTML = `<span class="nt-chip-dot" style="background:${c.color}"></span><span class="nt-cat-name">${c.name}</span>`;
                const delBtn = el("button", { className: "nt-cat-delete", innerHTML: window.AlejoIcons.glyph("trash", 16) });
                delBtn.onclick = () => deleteCategory(c.id);
                row.appendChild(delBtn);
                list.appendChild(row);
            });
            root.appendChild(list);

            const form = el("div", { className: "nt-cat-form" });
            const nameInp = el("input", { type: "text", placeholder: "Nombre de la categoría", value: S.newCatName, className: "nt-cat-name-inp" });
            nameInp.oninput = (e) => { S.newCatName = e.target.value; };
            form.appendChild(nameInp);

            const colorRow = el("div", { className: "nt-color-row" });
            CATEGORY_COLORS.forEach(color => {
                const dot = el("button", { className: `nt-color-dot${S.newCatColor === color ? " nt-color-dot--active" : ""}` });
                dot.style.background = color;
                dot.onclick = () => { S.newCatColor = color; renderView(); };
                colorRow.appendChild(dot);
            });
            form.appendChild(colorRow);

            if (S.catError) form.appendChild(el("p", { className: "nt-error", textContent: S.catError }));

            const createBtn = el("button", { className: "primary", textContent: "Crear categoría" });
            createBtn.onclick = createCategory;
            form.appendChild(createBtn);
            root.appendChild(form);

            const backBtn = el("button", { className: "nt-back-btn", textContent: "Volver a las ideas" });
            backBtn.onclick = () => { S.view = "list"; renderView(); };
            root.appendChild(backBtn);
        }

        // ── Lista ──
        function renderList() {
            const toolbar = el("div", { className: "nt-toolbar" });
            const newBtn = el("button", { className: "primary", textContent: "+ Nueva idea" });
            newBtn.onclick = openNew;
            toolbar.appendChild(newBtn);
            root.appendChild(toolbar);

            root.appendChild(renderCategoryChips(S.activeCategory, (id) => { S.activeCategory = id; renderView(); }, true));

            if (S.loading) {
                root.appendChild(el("p", { className: "nt-empty", textContent: "Cargando..." }));
                return;
            }
            const visible = S.activeCategory == null ? S.notes : S.notes.filter(n => n.categoryId === S.activeCategory);
            if (!visible.length) {
                root.appendChild(el("p", { className: "nt-empty", textContent: "Sin ideas guardadas todavía." }));
                return;
            }
            const list = el("div", { className: "nt-list" });
            visible.forEach(note => {
                const card = el("div", { className: "nt-card" });
                card.onclick = () => openEdit(note);
                const cat = categoryById(note.categoryId);
                card.innerHTML = `
                    <div class="nt-card-text"></div>
                    <div class="nt-card-footer">
                        <span class="nt-card-tags"></span>
                        <span class="nt-card-date"></span>
                        <button class="nt-delete-btn" title="Borrar">${window.AlejoIcons.glyph("trash", 16)}</button>
                    </div>`;
                card.querySelector(".nt-card-text").textContent = previewText(note);
                if (cat) {
                    const tag = card.querySelector(".nt-card-tags");
                    tag.innerHTML = `<span class="nt-chip-dot" style="background:${cat.color}"></span>${cat.name}`;
                }
                card.querySelector(".nt-card-date").textContent = fmtDate(note.updatedAt);
                card.querySelector(".nt-delete-btn").onclick = (ev) => deleteNote(note.id, ev);
                list.appendChild(card);
            });
            root.appendChild(list);
        }

        // ── Editor de bloques ──
        function autoGrow(ta) {
            ta.style.height = "auto";
            ta.style.height = ta.scrollHeight + "px";
        }

        function renderInserter(index) {
            const wrap = el("div", { className: "nt-inserter" });
            if (S.insertAt === index) {
                const textBtn = el("button", { textContent: "Texto" });
                textBtn.onclick = () => {
                    S.editingBlocks.splice(index, 0, { type: "text", value: "" });
                    S.insertAt = null;
                    renderView();
                };
                const drawBtn = el("button", { textContent: "Dibujo" });
                drawBtn.onclick = () => {
                    S.draw = { targetIndex: index, insertNew: true, dataUrl: null };
                    S.view = "draw";
                    renderView();
                };
                const cancelBtn = el("button", { className: "nt-inserter-cancel", innerHTML: window.AlejoIcons.glyph("close", 14) });
                cancelBtn.onclick = () => { S.insertAt = null; renderView(); };
                wrap.append(textBtn, drawBtn, cancelBtn);
            } else {
                const plusBtn = el("button", { className: "nt-inserter-plus", textContent: "+" });
                plusBtn.onclick = () => { S.insertAt = index; renderView(); };
                wrap.appendChild(plusBtn);
            }
            return wrap;
        }

        function renderEdit() {
            root.appendChild(el("div", { className: "nt-cat-title", textContent: "Categoría" }));
            root.appendChild(renderCategoryChips(S.editingCategoryId, (id) => { S.editingCategoryId = id; renderView(); }, true));

            const blocksWrap = el("div", { className: "nt-blocks" });
            blocksWrap.appendChild(renderInserter(0));
            S.editingBlocks.forEach((block, i) => {
                if (block.type === "text") {
                    const ta = el("textarea", { className: "nt-block-textarea", value: block.value, placeholder: "Escribí tu idea..." });
                    ta.oninput = (e) => { block.value = e.target.value; autoGrow(ta); };
                    blocksWrap.appendChild(ta);
                    setTimeout(() => autoGrow(ta), 0);
                    if (S.editingBlocks.length > 1) {
                        const rmRow = el("div", { className: "nt-block-remove-row" });
                        const rmBtn = el("button", { className: "nt-block-remove", textContent: "Quitar este bloque de texto" });
                        rmBtn.onclick = () => { S.editingBlocks.splice(i, 1); renderView(); };
                        rmRow.appendChild(rmBtn);
                        blocksWrap.appendChild(rmRow);
                    }
                } else {
                    const drawWrap = el("div", { className: "nt-block-drawing" });
                    drawWrap.appendChild(el("img", { className: "nt-block-drawing-img", src: block.dataUrl }));
                    const actions = el("div", { className: "nt-block-drawing-actions" });
                    const editBtn = el("button", { textContent: "Editar dibujo" });
                    editBtn.onclick = () => {
                        S.draw = { targetIndex: i, insertNew: false, dataUrl: block.dataUrl };
                        S.view = "draw";
                        renderView();
                    };
                    const rmBtn = el("button", { className: "nt-block-remove", innerHTML: window.AlejoIcons.glyph("trash", 16) });
                    rmBtn.onclick = () => { S.editingBlocks.splice(i, 1); renderView(); };
                    actions.append(editBtn, rmBtn);
                    drawWrap.appendChild(actions);
                    blocksWrap.appendChild(drawWrap);
                }
                blocksWrap.appendChild(renderInserter(i + 1));
            });
            root.appendChild(blocksWrap);

            const actions = el("div", { className: "sm-row-actions" });
            const saveBtn = el("button", { className: "primary", textContent: "Guardar" });
            saveBtn.onclick = saveNote;
            const cancelBtn = el("button", { textContent: "Cancelar" });
            cancelBtn.onclick = () => { S.view = "list"; renderView(); };
            actions.append(saveBtn, cancelBtn);
            root.appendChild(actions);
        }

        // ── Lienzo de dibujo simple ──
        function renderDraw() {
            const CANVAS_W = 640, CANVAS_H = 420;
            const DRAW_COLORS = ["#111111", "#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#ffffff"];
            const drawState = { color: DRAW_COLORS[0], size: 6, strokes: [], currentStroke: null };

            const wrap = el("div", { className: "nt-draw" });
            const canvas = el("canvas", { className: "nt-draw-canvas", width: CANVAS_W, height: CANVAS_H });
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

            function redraw() {
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
                for (const stroke of drawState.strokes) {
                    if (stroke.points.length < 2) continue;
                    ctx.strokeStyle = stroke.color;
                    ctx.lineWidth = stroke.size;
                    ctx.lineCap = "round";
                    ctx.lineJoin = "round";
                    ctx.beginPath();
                    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
                    for (let i = 1; i < stroke.points.length; i++) ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
                    ctx.stroke();
                }
            }

            if (S.draw.dataUrl) {
                const img = new Image();
                img.onload = () => { ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H); };
                img.src = S.draw.dataUrl;
            }

            function posFromEvent(e) {
                const rect = canvas.getBoundingClientRect();
                const scaleX = CANVAS_W / rect.width, scaleY = CANVAS_H / rect.height;
                return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
            }

            canvas.onpointerdown = (e) => {
                canvas.setPointerCapture(e.pointerId);
                drawState.currentStroke = { color: drawState.color, size: drawState.size, points: [posFromEvent(e)] };
                drawState.strokes.push(drawState.currentStroke);
            };
            canvas.onpointermove = (e) => {
                if (!drawState.currentStroke) return;
                drawState.currentStroke.points.push(posFromEvent(e));
                redraw();
            };
            const endStroke = () => { drawState.currentStroke = null; };
            canvas.onpointerup = endStroke;
            canvas.onpointercancel = endStroke;
            canvas.onpointerleave = endStroke;

            wrap.appendChild(canvas);

            const colorRow = el("div", { className: "nt-color-row" });
            DRAW_COLORS.forEach(color => {
                const dot = el("button", { className: "nt-color-dot" });
                dot.style.background = color;
                if (color === "#ffffff") dot.style.border = "1px solid var(--border)";
                dot.onclick = () => { drawState.color = color; renderPicked(); };
                colorRow.appendChild(dot);
            });
            function renderPicked() {
                colorRow.querySelectorAll(".nt-color-dot").forEach((d, i) => d.classList.toggle("nt-color-dot--active", DRAW_COLORS[i] === drawState.color));
                sizeRow.querySelectorAll(".nt-size-btn").forEach(b => b.classList.toggle("nt-size-btn--active", Number(b.dataset.size) === drawState.size));
            }
            wrap.appendChild(colorRow);

            const sizeRow = el("div", { className: "nt-size-row" });
            [["Fino", 3], ["Medio", 7], ["Grueso", 14]].forEach(([label, size]) => {
                const btn = el("button", { className: "nt-size-btn", textContent: label });
                btn.dataset.size = String(size);
                btn.onclick = () => { drawState.size = size; renderPicked(); };
                sizeRow.appendChild(btn);
            });
            wrap.appendChild(sizeRow);
            renderPicked();

            const toolActions = el("div", { className: "sm-row-actions" });
            const undoBtn = el("button", { textContent: "Deshacer trazo" });
            undoBtn.onclick = () => { drawState.strokes.pop(); redraw(); };
            const clearBtn = el("button", { textContent: "Borrar todo" });
            clearBtn.onclick = () => { drawState.strokes = []; redraw(); };
            toolActions.append(undoBtn, clearBtn);
            wrap.appendChild(toolActions);

            const finalActions = el("div", { className: "sm-row-actions" });
            const saveBtn = el("button", { className: "primary", textContent: "Usar este dibujo" });
            saveBtn.onclick = () => {
                const dataUrl = canvas.toDataURL("image/png");
                const block = { type: "drawing", dataUrl };
                if (S.draw.insertNew) S.editingBlocks.splice(S.draw.targetIndex, 0, block);
                else S.editingBlocks[S.draw.targetIndex] = block;
                S.draw = null;
                S.view = "edit";
                renderView();
            };
            const cancelBtn = el("button", { textContent: "Cancelar" });
            cancelBtn.onclick = () => { S.draw = null; S.view = "edit"; renderView(); };
            finalActions.append(saveBtn, cancelBtn);
            wrap.appendChild(finalActions);

            root.appendChild(wrap);
        }

        function renderView() {
            root.innerHTML = "";
            if (S.view === "list") renderList();
            else if (S.view === "edit") renderEdit();
            else if (S.view === "draw") renderDraw();
            else if (S.view === "categories") renderCategoriesView();
        }

        loadAll();
    },
    onOutput() {},
    onDone() {},
});
