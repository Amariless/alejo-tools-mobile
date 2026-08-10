// ui.js — Pomodoro (mobile).
//
// Persistente (ver tool.json) -- una fase de trabajo/descanso dura minutos,
// el usuario tiene que poder cambiar a otra herramienta sin que el conteo
// se pierda. El tiempo restante se calcula siempre a partir de un
// timestamp de fin de fase (Date.now() + duración) en vez de ir restando
// de a un segundo por tick -- así, si el WebView queda de fondo un rato y
// Android le atrasa los timers (throttling típico para ahorrar batería), el
// número mostrado se autocorrige solo al volver a primer plano en vez de
// quedar retrasado.
//
// A propósito NO portado del "Reloj" de escritorio (que además de Pomodoro
// tiene cronómetro, temporizador, alarmas con sonidos propios y un widget
// de clima): acá es específicamente lo que se pidió, el Pomodoro. El aviso
// de fin de fase es un beep generado con Web Audio (sin archivos de sonido
// que empaquetar) + vibración -- no hay notificación de sistema en esta
// primera versión, así que si el usuario sale de la app del todo (no solo
// cambia de pestaña) puede no enterarse cuando termina una fase.
registerRenderer("pomodoro", {
    render(tool, area) {
        const root = el("div", { className: "pm-root" });
        area.appendChild(root);

        const S = {
            config: { workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakInterval: 4, autoStart: true, soundEnabled: true },
            phase: "work", // work | short_break | long_break
            cyclesCompleted: 0,
            running: false,
            phaseEndAt: null,      // timestamp ms -- solo mientras running
            remainingMsPaused: null,
            showSettings: false,
            tickHandle: null,
        };

        const PHASE_LABEL = { work: "Trabajo", short_break: "Descanso corto", long_break: "Descanso largo" };

        function phaseDurationMs(phase) {
            const mins = phase === "work" ? S.config.workMinutes
                : phase === "short_break" ? S.config.shortBreakMinutes
                : S.config.longBreakMinutes;
            return Math.max(1, mins) * 60 * 1000;
        }

        function remainingMs() {
            if (S.running && S.phaseEndAt != null) return Math.max(0, S.phaseEndAt - Date.now());
            if (S.remainingMsPaused != null) return S.remainingMsPaused;
            return phaseDurationMs(S.phase);
        }

        function fmtTime(ms) {
            const total = Math.ceil(ms / 1000);
            const m = Math.floor(total / 60), s = total % 60;
            return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
        }

        // Beep de dos tonos con Web Audio -- no hace falta empaquetar mp3.
        function playBeep() {
            if (!S.config.soundEnabled) return;
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                [0, 0.18].forEach((delay, i) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = "sine";
                    osc.frequency.value = i === 0 ? 880 : 1046.5;
                    gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
                    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + delay + 0.02);
                    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.16);
                    osc.connect(gain).connect(ctx.destination);
                    osc.start(ctx.currentTime + delay);
                    osc.stop(ctx.currentTime + delay + 0.2);
                });
            } catch (e) { /* Web Audio no disponible -- no es crítico */ }
            if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        }

        function nextPhase() {
            if (S.phase === "work") {
                S.cyclesCompleted += 1;
                S.phase = (S.cyclesCompleted % S.config.longBreakInterval === 0) ? "long_break" : "short_break";
            } else {
                S.phase = "work";
            }
        }

        function onPhaseComplete() {
            playBeep();
            nextPhase();
            S.phaseEndAt = null;
            S.remainingMsPaused = null;
            if (S.config.autoStart) {
                start();
            } else {
                S.running = false;
                render();
            }
        }

        function tick() {
            if (!S.running) return;
            if (remainingMs() <= 0) { onPhaseComplete(); return; }
            render();
        }

        function start() {
            const dur = S.remainingMsPaused != null ? S.remainingMsPaused : phaseDurationMs(S.phase);
            S.phaseEndAt = Date.now() + dur;
            S.remainingMsPaused = null;
            S.running = true;
            if (S.tickHandle) clearInterval(S.tickHandle);
            S.tickHandle = setInterval(tick, 250);
            render();
        }

        function pause() {
            S.remainingMsPaused = remainingMs();
            S.phaseEndAt = null;
            S.running = false;
            if (S.tickHandle) { clearInterval(S.tickHandle); S.tickHandle = null; }
            render();
        }

        function reset() {
            if (S.tickHandle) { clearInterval(S.tickHandle); S.tickHandle = null; }
            S.phase = "work";
            S.cyclesCompleted = 0;
            S.running = false;
            S.phaseEndAt = null;
            S.remainingMsPaused = null;
            render();
        }

        function skip() {
            if (S.tickHandle) { clearInterval(S.tickHandle); S.tickHandle = null; }
            nextPhase();
            S.phaseEndAt = null;
            S.remainingMsPaused = null;
            S.running = false;
            render();
        }

        async function saveConfig(patch) {
            S.config = { ...S.config, ...patch };
            try { await invoke("pomodoro_set_config", { config: S.config }); } catch (e) { /* best effort */ }
        }

        function renderSettings() {
            const wrap = el("div", { className: "pm-settings" });
            const rows = [
                ["Trabajo (min)", "workMinutes"],
                ["Descanso corto (min)", "shortBreakMinutes"],
                ["Descanso largo (min)", "longBreakMinutes"],
                ["Ciclos hasta descanso largo", "longBreakInterval"],
            ];
            rows.forEach(([label, key]) => {
                const row = el("div", { className: "input-row" });
                const inp = el("input", { type: "number", min: "1", value: S.config[key] });
                inp.onchange = (e) => {
                    const v = Math.max(1, parseInt(e.target.value, 10) || 1);
                    saveConfig({ [key]: v });
                };
                row.append(lbl(label), inp);
                wrap.appendChild(row);
            });

            const autoRow = el("label", { className: "pm-switch-row" });
            const autoChk = el("input", { type: "checkbox", checked: S.config.autoStart });
            autoChk.onchange = (e) => saveConfig({ autoStart: e.target.checked });
            autoRow.append(el("span", { textContent: "Empezar la siguiente fase sola" }), autoChk);
            wrap.appendChild(autoRow);

            const soundRow = el("label", { className: "pm-switch-row" });
            const soundChk = el("input", { type: "checkbox", checked: S.config.soundEnabled });
            soundChk.onchange = (e) => saveConfig({ soundEnabled: e.target.checked });
            soundRow.append(el("span", { textContent: "Sonido al terminar cada fase" }), soundChk);
            wrap.appendChild(soundRow);

            return wrap;
        }

        function render() {
            root.innerHTML = "";

            const phaseLabel = el("div", { className: `pm-phase pm-phase--${S.phase}`, textContent: PHASE_LABEL[S.phase] });
            root.appendChild(phaseLabel);

            const time = el("div", { className: "pm-time", textContent: fmtTime(remainingMs()) });
            root.appendChild(time);

            const pct = 100 - (remainingMs() / phaseDurationMs(S.phase)) * 100;
            const barWrap = el("div", { className: "pm-bar" });
            const bar = el("div", { className: "pm-bar-fill" });
            bar.style.width = `${Math.min(100, Math.max(0, pct)).toFixed(1)}%`;
            barWrap.appendChild(bar);
            root.appendChild(barWrap);

            root.appendChild(el("p", { className: "pm-cycles", textContent: `Ciclos completados: ${S.cyclesCompleted}` }));

            const actions = el("div", { className: "pm-actions" });
            const toggleBtn = el("button", { className: "primary", textContent: S.running ? "Pausar" : "Empezar" });
            toggleBtn.onclick = () => S.running ? pause() : start();
            const skipBtn = el("button", { textContent: "Saltar fase" });
            skipBtn.onclick = skip;
            const resetBtn = el("button", { textContent: "Reiniciar" });
            resetBtn.onclick = reset;
            actions.append(toggleBtn, skipBtn, resetBtn);
            root.appendChild(actions);

            const settingsToggle = el("button", { className: "pm-settings-toggle", textContent: S.showSettings ? "Ocultar ajustes" : "Ajustes" });
            settingsToggle.onclick = () => { S.showSettings = !S.showSettings; render(); };
            root.appendChild(settingsToggle);
            if (S.showSettings) root.appendChild(renderSettings());
        }

        (async () => {
            try { S.config = await invoke("pomodoro_get_config"); } catch (e) { /* usa default */ }
            render();
        })();
    },
    onOutput() {},
    onDone() {},
});
