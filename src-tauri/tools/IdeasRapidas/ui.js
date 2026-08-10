// ui.js — Ideas rápidas (mobile).
//
// A propósito simple: notas de texto sueltas, sin carpetas ni etiquetas
// (ver notes.rs). NO persistente (tool.json) -- a diferencia de Pomodoro,
// acá no hay nada "en curso" que perder al cambiar de pestaña: la lista se
// vuelve a pedir a Rust cada vez que se entra, siempre desde el archivo
// guardado.
registerRenderer("ideasrapidas", {
    render(tool, area) {
        const root = el("div", { className: "nt-root" });
        area.appendChild(root);

        const S = {
            view: "list", // list | edit
            notes: [],
            editingId: null,
            editingText: "",
            loading: true,
        };

        function fmtDate(ms) {
            const d = new Date(ms);
            const today = new Date();
            const sameDay = d.toDateString() === today.toDateString();
            const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            return sameDay ? time : d.toLocaleDateString() + " " + time;
        }

        async function loadNotes() {
            S.loading = true;
            renderView();
            try { S.notes = await invoke("notes_list"); } catch (e) { S.notes = []; }
            S.loading = false;
            renderView();
        }

        function openNew() {
            S.view = "edit";
            S.editingId = null;
            S.editingText = "";
            renderView();
        }

        function openEdit(note) {
            S.view = "edit";
            S.editingId = note.id;
            S.editingText = note.text;
            renderView();
        }

        async function saveNote() {
            const text = S.editingText.trim();
            if (!text) { S.view = "list"; renderView(); return; }
            try { await invoke("notes_save", { id: S.editingId, text }); } catch (e) { alert("Error: " + e); return; }
            S.view = "list";
            await loadNotes();
        }

        async function deleteNote(id, ev) {
            ev.stopPropagation();
            if (!confirm("¿Borrar esta nota?")) return;
            try { await invoke("notes_delete", { id }); } catch (e) { alert("Error: " + e); return; }
            await loadNotes();
        }

        function renderList() {
            const toolbar = el("div", { className: "nt-toolbar" });
            const newBtn = el("button", { className: "primary", textContent: "+ Nueva idea" });
            newBtn.onclick = openNew;
            toolbar.appendChild(newBtn);
            root.appendChild(toolbar);

            if (S.loading) {
                root.appendChild(el("p", { className: "nt-empty", textContent: "Cargando..." }));
                return;
            }
            if (!S.notes.length) {
                root.appendChild(el("p", { className: "nt-empty", textContent: "Sin ideas guardadas todavía." }));
                return;
            }
            const list = el("div", { className: "nt-list" });
            S.notes.forEach(note => {
                const card = el("div", { className: "nt-card" });
                card.onclick = () => openEdit(note);
                const textPreview = note.text.length > 140 ? note.text.slice(0, 140) + "…" : note.text;
                card.innerHTML = `
                    <div class="nt-card-text"></div>
                    <div class="nt-card-footer">
                        <span class="nt-card-date"></span>
                        <button class="nt-delete-btn" title="Borrar">🗑️</button>
                    </div>`;
                card.querySelector(".nt-card-text").textContent = textPreview;
                card.querySelector(".nt-card-date").textContent = fmtDate(note.updatedAt);
                card.querySelector(".nt-delete-btn").onclick = (ev) => deleteNote(note.id, ev);
                list.appendChild(card);
            });
            root.appendChild(list);
        }

        function renderEdit() {
            const textarea = el("textarea", { className: "nt-textarea", value: S.editingText, placeholder: "Escribí tu idea..." });
            textarea.oninput = (e) => { S.editingText = e.target.value; };
            root.appendChild(textarea);

            const actions = el("div", { className: "sm-row-actions" });
            const saveBtn = el("button", { className: "primary", textContent: "Guardar" });
            saveBtn.onclick = saveNote;
            const cancelBtn = el("button", { textContent: "Cancelar" });
            cancelBtn.onclick = () => { S.view = "list"; renderView(); };
            actions.append(saveBtn, cancelBtn);
            root.appendChild(actions);

            setTimeout(() => textarea.focus(), 0);
        }

        function renderView() {
            root.innerHTML = "";
            if (S.view === "list") renderList();
            else renderEdit();
        }

        loadNotes();
    },
    onOutput() {},
    onDone() {},
});
