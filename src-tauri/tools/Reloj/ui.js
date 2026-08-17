// ui.js — Reloj (mobile): Pomodoro + reloj mundial + clima.
//
// Antes era solo "Pomodoro" (ver el historial de ese archivo) -- el
// usuario pidió sumarle reloj mundial y clima y renombrar la herramienta,
// así que pasa a tener 3 pestañas propias (mismo patrón de pestañas que
// usa el escritorio para familias de herramientas relacionadas) en vez de
// ser 3 tools sueltas.
//
// Persistente (ver tool.json) -- el Pomodoro necesita sobrevivir a que el
// usuario cambie de herramienta sin perder la cuenta (ver nota grande más
// abajo), y de paso el reloj mundial/clima no tienen que recargar su
// configuración cada vez que se vuelve a esta pantalla.
//
// Reloj mundial: 100% cliente (Intl.DateTimeFormat con timeZone convierte
// a cualquier huso horario sin pedirle nada a Rust) -- solo se persiste
// QUÉ ciudades eligió el usuario. Clima: sí pasa por Rust (clock.rs, pega
// contra Open-Meteo) porque hace falta una llamada HTTPS real; a propósito
// NO se pide la ubicación real del dispositivo -- el usuario elige una
// ciudad de la misma lista curada que usa el reloj mundial (evita pedir
// permiso de localización solo para esto).
registerRenderer("reloj", {
    render(tool, area) {
        const root = el("div", { className: "rj-root" });
        area.appendChild(root);

        // Lista curada de ciudades (id, nombre, país, huso IANA, lat/lon
        // para el clima) -- con foco en Latinoamérica dado el idioma de la
        // app, más las plazas más consultadas del resto del mundo.
        const CITIES = [
            { id: "buenos-aires", name: "Buenos Aires", country: "Argentina", tz: "America/Argentina/Buenos_Aires", lat: -34.6037, lon: -58.3816 },
            { id: "mexico-city", name: "Ciudad de México", country: "México", tz: "America/Mexico_City", lat: 19.4326, lon: -99.1332 },
            { id: "bogota", name: "Bogotá", country: "Colombia", tz: "America/Bogota", lat: 4.7110, lon: -74.0721 },
            { id: "lima", name: "Lima", country: "Perú", tz: "America/Lima", lat: -12.0464, lon: -77.0428 },
            { id: "santiago", name: "Santiago", country: "Chile", tz: "America/Santiago", lat: -33.4489, lon: -70.6693 },
            { id: "caracas", name: "Caracas", country: "Venezuela", tz: "America/Caracas", lat: 10.4806, lon: -66.9036 },
            { id: "quito", name: "Quito", country: "Ecuador", tz: "America/Guayaquil", lat: -0.1807, lon: -78.4678 },
            { id: "montevideo", name: "Montevideo", country: "Uruguay", tz: "America/Montevideo", lat: -34.9011, lon: -56.1645 },
            { id: "la-paz", name: "La Paz", country: "Bolivia", tz: "America/La_Paz", lat: -16.5000, lon: -68.1500 },
            { id: "asuncion", name: "Asunción", country: "Paraguay", tz: "America/Asuncion", lat: -25.2637, lon: -57.5759 },
            { id: "san-jose-cr", name: "San José", country: "Costa Rica", tz: "America/Costa_Rica", lat: 9.9281, lon: -84.0907 },
            { id: "panama", name: "Ciudad de Panamá", country: "Panamá", tz: "America/Panama", lat: 8.9824, lon: -79.5199 },
            { id: "havana", name: "La Habana", country: "Cuba", tz: "America/Havana", lat: 23.1136, lon: -82.3666 },
            { id: "santo-domingo", name: "Santo Domingo", country: "Rep. Dominicana", tz: "America/Santo_Domingo", lat: 18.4861, lon: -69.9312 },
            { id: "san-juan-pr", name: "San Juan", country: "Puerto Rico", tz: "America/Puerto_Rico", lat: 18.4655, lon: -66.1057 },
            { id: "new-york", name: "Nueva York", country: "Estados Unidos", tz: "America/New_York", lat: 40.7128, lon: -74.0060 },
            { id: "los-angeles", name: "Los Ángeles", country: "Estados Unidos", tz: "America/Los_Angeles", lat: 34.0522, lon: -118.2437 },
            { id: "chicago", name: "Chicago", country: "Estados Unidos", tz: "America/Chicago", lat: 41.8781, lon: -87.6298 },
            { id: "miami", name: "Miami", country: "Estados Unidos", tz: "America/New_York", lat: 25.7617, lon: -80.1918 },
            { id: "toronto", name: "Toronto", country: "Canadá", tz: "America/Toronto", lat: 43.6532, lon: -79.3832 },
            { id: "vancouver", name: "Vancouver", country: "Canadá", tz: "America/Vancouver", lat: 49.2827, lon: -123.1207 },
            { id: "sao-paulo", name: "São Paulo", country: "Brasil", tz: "America/Sao_Paulo", lat: -23.5505, lon: -46.6333 },
            { id: "rio-de-janeiro", name: "Río de Janeiro", country: "Brasil", tz: "America/Sao_Paulo", lat: -22.9068, lon: -43.1729 },
            { id: "madrid", name: "Madrid", country: "España", tz: "Europe/Madrid", lat: 40.4168, lon: -3.7038 },
            { id: "barcelona", name: "Barcelona", country: "España", tz: "Europe/Madrid", lat: 41.3874, lon: 2.1686 },
            { id: "london", name: "Londres", country: "Reino Unido", tz: "Europe/London", lat: 51.5074, lon: -0.1278 },
            { id: "paris", name: "París", country: "Francia", tz: "Europe/Paris", lat: 48.8566, lon: 2.3522 },
            { id: "berlin", name: "Berlín", country: "Alemania", tz: "Europe/Berlin", lat: 52.5200, lon: 13.4050 },
            { id: "rome", name: "Roma", country: "Italia", tz: "Europe/Rome", lat: 41.9028, lon: 12.4964 },
            { id: "lisbon", name: "Lisboa", country: "Portugal", tz: "Europe/Lisbon", lat: 38.7223, lon: -9.1393 },
            { id: "amsterdam", name: "Ámsterdam", country: "Países Bajos", tz: "Europe/Amsterdam", lat: 52.3676, lon: 4.9041 },
            { id: "moscow", name: "Moscú", country: "Rusia", tz: "Europe/Moscow", lat: 55.7558, lon: 37.6173 },
            { id: "istanbul", name: "Estambul", country: "Turquía", tz: "Europe/Istanbul", lat: 41.0082, lon: 28.9784 },
            { id: "cairo", name: "El Cairo", country: "Egipto", tz: "Africa/Cairo", lat: 30.0444, lon: 31.2357 },
            { id: "johannesburg", name: "Johannesburgo", country: "Sudáfrica", tz: "Africa/Johannesburg", lat: -26.2041, lon: 28.0473 },
            { id: "dubai", name: "Dubái", country: "Emiratos Árabes Unidos", tz: "Asia/Dubai", lat: 25.2048, lon: 55.2708 },
            { id: "new-delhi", name: "Nueva Delhi", country: "India", tz: "Asia/Kolkata", lat: 28.6139, lon: 77.2090 },
            { id: "bangkok", name: "Bangkok", country: "Tailandia", tz: "Asia/Bangkok", lat: 13.7563, lon: 100.5018 },
            { id: "singapore", name: "Singapur", country: "Singapur", tz: "Asia/Singapore", lat: 1.3521, lon: 103.8198 },
            { id: "hong-kong", name: "Hong Kong", country: "Hong Kong", tz: "Asia/Hong_Kong", lat: 22.3193, lon: 114.1694 },
            { id: "beijing", name: "Pekín", country: "China", tz: "Asia/Shanghai", lat: 39.9042, lon: 116.4074 },
            { id: "shanghai", name: "Shanghái", country: "China", tz: "Asia/Shanghai", lat: 31.2304, lon: 121.4737 },
            { id: "tokyo", name: "Tokio", country: "Japón", tz: "Asia/Tokyo", lat: 35.6762, lon: 139.6503 },
            { id: "seoul", name: "Seúl", country: "Corea del Sur", tz: "Asia/Seoul", lat: 37.5665, lon: 126.9780 },
            { id: "sydney", name: "Sídney", country: "Australia", tz: "Australia/Sydney", lat: -33.8688, lon: 151.2093 },
            { id: "melbourne", name: "Melbourne", country: "Australia", tz: "Australia/Melbourne", lat: -37.8136, lon: 144.9631 },
            { id: "auckland", name: "Auckland", country: "Nueva Zelanda", tz: "Pacific/Auckland", lat: -36.8485, lon: 174.7633 },
            { id: "honolulu", name: "Honolulu", country: "Estados Unidos", tz: "Pacific/Honolulu", lat: 21.3069, lon: -157.8583 },
        ];
        const CITY_BY_ID = Object.fromEntries(CITIES.map((c) => [c.id, c]));

        const S = {
            tab: "pomodoro", // pomodoro | mundial | clima
            pomodoro: {
                config: { workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakInterval: 4, autoStart: true, soundEnabled: true },
                phase: "work", // work | short_break | long_break
                cyclesCompleted: 0,
                running: false,
                phaseEndAt: null,
                remainingMsPaused: null,
                showSettings: false,
                tickHandle: null,
            },
            world: { cityIds: [], showPicker: false, query: "", tickHandle: null },
            weather: { cityId: null, info: null, loading: false, error: "", showPicker: false, query: "" },
        };

        // ── Pomodoro (sin cambios de fondo respecto de la versión anterior,
        // solo pasa a vivir bajo S.pomodoro y a devolver un nodo en vez de
        // pintarse directo en root -- ver render() al final del archivo) ──
        const PHASE_LABEL = { work: "Trabajo", short_break: "Descanso corto", long_break: "Descanso largo" };

        function phaseDurationMs(phase) {
            const p = S.pomodoro;
            const mins = phase === "work" ? p.config.workMinutes
                : phase === "short_break" ? p.config.shortBreakMinutes
                : p.config.longBreakMinutes;
            return Math.max(1, mins) * 60 * 1000;
        }

        function remainingMs() {
            const p = S.pomodoro;
            if (p.running && p.phaseEndAt != null) return Math.max(0, p.phaseEndAt - Date.now());
            if (p.remainingMsPaused != null) return p.remainingMsPaused;
            return phaseDurationMs(p.phase);
        }

        function fmtTime(ms) {
            const total = Math.ceil(ms / 1000);
            const m = Math.floor(total / 60), s = total % 60;
            return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
        }

        function playBeep() {
            if (!S.pomodoro.config.soundEnabled) return;
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
            const p = S.pomodoro;
            if (p.phase === "work") {
                p.cyclesCompleted += 1;
                p.phase = (p.cyclesCompleted % p.config.longBreakInterval === 0) ? "long_break" : "short_break";
            } else {
                p.phase = "work";
            }
        }

        function onPhaseComplete() {
            const p = S.pomodoro;
            playBeep();
            nextPhase();
            p.phaseEndAt = null;
            p.remainingMsPaused = null;
            if (p.config.autoStart) {
                startPomodoro();
            } else {
                p.running = false;
                render();
            }
        }

        function pmTick() {
            if (!S.pomodoro.running) return;
            if (remainingMs() <= 0) { onPhaseComplete(); return; }
            if (S.tab === "pomodoro") render();
        }

        function startPomodoro() {
            const p = S.pomodoro;
            const dur = p.remainingMsPaused != null ? p.remainingMsPaused : phaseDurationMs(p.phase);
            p.phaseEndAt = Date.now() + dur;
            p.remainingMsPaused = null;
            p.running = true;
            if (p.tickHandle) clearInterval(p.tickHandle);
            p.tickHandle = setInterval(pmTick, 250);
            render();
        }

        function pausePomodoro() {
            const p = S.pomodoro;
            p.remainingMsPaused = remainingMs();
            p.phaseEndAt = null;
            p.running = false;
            if (p.tickHandle) { clearInterval(p.tickHandle); p.tickHandle = null; }
            render();
        }

        function resetPomodoro() {
            const p = S.pomodoro;
            if (p.tickHandle) { clearInterval(p.tickHandle); p.tickHandle = null; }
            p.phase = "work";
            p.cyclesCompleted = 0;
            p.running = false;
            p.phaseEndAt = null;
            p.remainingMsPaused = null;
            render();
        }

        function skipPomodoro() {
            const p = S.pomodoro;
            if (p.tickHandle) { clearInterval(p.tickHandle); p.tickHandle = null; }
            nextPhase();
            p.phaseEndAt = null;
            p.remainingMsPaused = null;
            p.running = false;
            render();
        }

        async function savePomodoroConfig(patch) {
            S.pomodoro.config = { ...S.pomodoro.config, ...patch };
            try { await invoke("pomodoro_set_config", { config: S.pomodoro.config }); } catch (e) { /* best effort */ }
        }

        function renderPomodoroSettings() {
            const wrap = el("div", { className: "pm-settings" });
            const rows = [
                ["Trabajo (min)", "workMinutes"],
                ["Descanso corto (min)", "shortBreakMinutes"],
                ["Descanso largo (min)", "longBreakMinutes"],
                ["Ciclos hasta descanso largo", "longBreakInterval"],
            ];
            rows.forEach(([label, key]) => {
                const row = el("div", { className: "input-row" });
                const inp = el("input", { type: "number", min: "1", value: S.pomodoro.config[key] });
                inp.onchange = (e) => {
                    const v = Math.max(1, parseInt(e.target.value, 10) || 1);
                    savePomodoroConfig({ [key]: v });
                };
                row.append(lbl(label), inp);
                wrap.appendChild(row);
            });

            const autoRow = el("label", { className: "pm-switch-row" });
            const autoChk = el("input", { type: "checkbox", checked: S.pomodoro.config.autoStart });
            autoChk.onchange = (e) => savePomodoroConfig({ autoStart: e.target.checked });
            autoRow.append(el("span", { textContent: "Empezar la siguiente fase sola" }), autoChk);
            wrap.appendChild(autoRow);

            const soundRow = el("label", { className: "pm-switch-row" });
            const soundChk = el("input", { type: "checkbox", checked: S.pomodoro.config.soundEnabled });
            soundChk.onchange = (e) => savePomodoroConfig({ soundEnabled: e.target.checked });
            soundRow.append(el("span", { textContent: "Sonido al terminar cada fase" }), soundChk);
            wrap.appendChild(soundRow);

            return wrap;
        }

        function renderPomodoro() {
            const p = S.pomodoro;
            const wrap = el("div", { className: "pm-root" });

            wrap.appendChild(el("div", { className: `pm-phase pm-phase--${p.phase}`, textContent: PHASE_LABEL[p.phase] }));
            wrap.appendChild(el("div", { className: "pm-time", textContent: fmtTime(remainingMs()) }));

            const pct = 100 - (remainingMs() / phaseDurationMs(p.phase)) * 100;
            const barWrap = el("div", { className: "pm-bar" });
            const bar = el("div", { className: "pm-bar-fill" });
            bar.style.width = `${Math.min(100, Math.max(0, pct)).toFixed(1)}%`;
            barWrap.appendChild(bar);
            wrap.appendChild(barWrap);

            wrap.appendChild(el("p", { className: "pm-cycles", textContent: `Ciclos completados: ${p.cyclesCompleted}` }));

            const actions = el("div", { className: "pm-actions" });
            const toggleBtn = el("button", { className: "primary", textContent: p.running ? "Pausar" : "Empezar" });
            toggleBtn.onclick = () => p.running ? pausePomodoro() : startPomodoro();
            const skipBtn = el("button", { textContent: "Saltar fase" });
            skipBtn.onclick = skipPomodoro;
            const resetBtn = el("button", { textContent: "Reiniciar" });
            resetBtn.onclick = resetPomodoro;
            actions.append(toggleBtn, skipBtn, resetBtn);
            wrap.appendChild(actions);

            const settingsToggle = el("button", { className: "pm-settings-toggle", textContent: p.showSettings ? "Ocultar ajustes" : "Ajustes" });
            settingsToggle.onclick = () => { p.showSettings = !p.showSettings; render(); };
            wrap.appendChild(settingsToggle);
            if (p.showSettings) wrap.appendChild(renderPomodoroSettings());

            return wrap;
        }

        // ── Reloj mundial ──
        function fmtCityTime(tz) {
            try {
                return new Intl.DateTimeFormat("es-AR", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());
            } catch (e) { return "--:--:--"; }
        }
        function fmtCityDate(tz) {
            try {
                return new Intl.DateTimeFormat("es-AR", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(new Date());
            } catch (e) { return ""; }
        }

        async function saveWorldConfig() {
            try { await invoke("clock_set_worldclock_config", { config: { cityIds: S.world.cityIds } }); } catch (e) { /* best effort */ }
        }

        function startWorldTick() {
            if (S.world.tickHandle) clearInterval(S.world.tickHandle);
            S.world.tickHandle = setInterval(() => {
                if (S.tab === "mundial" && !S.world.showPicker) render();
            }, 1000);
        }

        // Buscador reusado por reloj mundial y clima -- a propósito el
        // <input> de búsqueda queda AFUERA del re-render en cada tecla
        // (solo se reconstruye la lista de resultados, un div aparte): un
        // render() completo en cada oninput destruiría el propio <input>
        // que el usuario está tocando y le tiraría el foco, el mismo tipo
        // de bug que ya se encontró y arregló en los sliders de otras
        // herramientas (ver CreadorTexturas/ui.js).
        function buildCityPicker(opts) {
            const wrap = el("div", { className: "rj-picker" });
            const header = el("div", { className: "rj-picker-header" });
            header.appendChild(el("div", { className: "rj-picker-title", textContent: opts.title }));
            const closeBtn = el("button", { className: "rj-picker-close", innerHTML: window.AlejoIcons.glyph("close", 18) });
            closeBtn.onclick = opts.onClose;
            header.appendChild(closeBtn);
            wrap.appendChild(header);

            const searchInp = el("input", { type: "text", className: "rj-picker-search", placeholder: "Buscar ciudad o país...", value: opts.getQuery() });
            const resultsDiv = el("div", { className: "rj-picker-results" });

            function renderResults() {
                resultsDiv.innerHTML = "";
                const q = opts.getQuery().trim().toLowerCase();
                const matches = CITIES.filter((c) => !q || c.name.toLowerCase().includes(q) || c.country.toLowerCase().includes(q));
                if (matches.length === 0) {
                    resultsDiv.appendChild(el("p", { className: "rj-picker-empty", textContent: "Sin resultados." }));
                    return;
                }
                matches.forEach((c) => {
                    const already = !opts.isSelectable(c);
                    const row = el("button", { className: "rj-picker-row", disabled: already });
                    row.innerHTML = `<span class="rj-picker-city">${c.name}${already ? ' <em class="rj-picker-added">agregada</em>' : ""}</span><span class="rj-picker-country">${c.country}</span>`;
                    row.onclick = () => opts.onPick(c);
                    resultsDiv.appendChild(row);
                });
            }

            searchInp.oninput = (e) => { opts.setQuery(e.target.value); renderResults(); };
            wrap.append(searchInp, resultsDiv);
            renderResults();
            return wrap;
        }

        function renderWorld() {
            const wrap = el("div", { className: "rj-world" });

            if (S.world.showPicker) {
                wrap.appendChild(buildCityPicker({
                    title: "Agregar ciudad",
                    getQuery: () => S.world.query,
                    setQuery: (v) => { S.world.query = v; },
                    isSelectable: (c) => !S.world.cityIds.includes(c.id),
                    onPick: (c) => {
                        if (!S.world.cityIds.includes(c.id)) S.world.cityIds.push(c.id);
                        S.world.showPicker = false;
                        saveWorldConfig();
                        render();
                    },
                    onClose: () => { S.world.showPicker = false; render(); },
                }));
                return wrap;
            }

            const addBtn = el("button", { className: "primary rj-add-btn", textContent: "Agregar ciudad" });
            addBtn.onclick = () => { S.world.showPicker = true; S.world.query = ""; render(); };
            wrap.appendChild(addBtn);

            if (S.world.cityIds.length === 0) {
                wrap.appendChild(el("p", { className: "rj-empty", textContent: "Todavía no agregaste ninguna ciudad." }));
                return wrap;
            }

            const list = el("div", { className: "rj-world-list" });
            S.world.cityIds.forEach((id) => {
                const c = CITY_BY_ID[id];
                if (!c) return;
                const row = el("div", { className: "rj-world-row" });
                const info = el("div", { className: "rj-world-info" });
                info.innerHTML = `<div class="rj-world-city">${c.name}</div><div class="rj-world-sub">${c.country} · ${fmtCityDate(c.tz)}</div>`;
                const time = el("div", { className: "rj-world-time", textContent: fmtCityTime(c.tz) });
                const rmBtn = el("button", { className: "rj-world-remove", innerHTML: window.AlejoIcons.glyph("trash", 16) });
                rmBtn.onclick = () => {
                    S.world.cityIds = S.world.cityIds.filter((x) => x !== id);
                    saveWorldConfig();
                    render();
                };
                row.append(info, time, rmBtn);
                list.appendChild(row);
            });
            wrap.appendChild(list);
            return wrap;
        }

        // ── Clima ──
        function weatherMeta(code) {
            if (code === 0) return { label: "Despejado", g: "wxSun" };
            if (code === 1 || code === 2) return { label: "Parcialmente nublado", g: "wxCloudSun" };
            if (code === 3) return { label: "Nublado", g: "wxCloud" };
            if (code === 45 || code === 48) return { label: "Niebla", g: "wxFog" };
            if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { label: "Lluvia", g: "wxRain" };
            if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: "Nieve", g: "wxSnow" };
            if ([95, 96, 99].includes(code)) return { label: "Tormenta", g: "wxStorm" };
            return { label: "Sin datos", g: "wxCloud" };
        }

        async function saveWeatherConfig() {
            try { await invoke("clock_set_weather_config", { config: { cityId: S.weather.cityId } }); } catch (e) { /* best effort */ }
        }

        async function fetchWeather() {
            const c = CITY_BY_ID[S.weather.cityId];
            if (!c) return;
            S.weather.loading = true;
            S.weather.error = "";
            render();
            try {
                S.weather.info = await invoke("clock_get_weather", { lat: c.lat, lon: c.lon });
            } catch (e) {
                S.weather.error = String(e);
                S.weather.info = null;
            } finally {
                S.weather.loading = false;
            }
            render();
        }

        function renderWeather() {
            const wrap = el("div", { className: "rj-weather" });

            if (S.weather.showPicker) {
                wrap.appendChild(buildCityPicker({
                    title: "Elegir ciudad",
                    getQuery: () => S.weather.query,
                    setQuery: (v) => { S.weather.query = v; },
                    isSelectable: () => true,
                    onPick: (c) => {
                        S.weather.cityId = c.id;
                        S.weather.showPicker = false;
                        saveWeatherConfig();
                        fetchWeather();
                    },
                    onClose: () => { S.weather.showPicker = false; render(); },
                }));
                return wrap;
            }

            if (!S.weather.cityId) {
                wrap.appendChild(el("p", { className: "rj-empty", textContent: "Elegí una ciudad para ver el clima." }));
                const btn = el("button", { className: "primary", textContent: "Elegir ciudad" });
                btn.onclick = () => { S.weather.showPicker = true; S.weather.query = ""; render(); };
                wrap.appendChild(btn);
                return wrap;
            }

            const c = CITY_BY_ID[S.weather.cityId];
            const header = el("div", { className: "rj-weather-header" });
            const cityInfo = el("div", { className: "rj-weather-cityinfo" });
            cityInfo.innerHTML = `<div class="rj-weather-city">${c ? c.name : "?"}</div><div class="rj-weather-country">${c ? c.country : ""}</div>`;
            const changeBtn = el("button", { className: "rj-weather-change", textContent: "Cambiar ciudad" });
            changeBtn.onclick = () => { S.weather.showPicker = true; S.weather.query = ""; render(); };
            header.append(cityInfo, changeBtn);
            wrap.appendChild(header);

            if (S.weather.loading) {
                wrap.appendChild(el("p", { className: "rj-weather-status", textContent: "Consultando el clima..." }));
                return wrap;
            }
            if (S.weather.error) {
                wrap.appendChild(el("p", { className: "rj-error", textContent: S.weather.error }));
                const retryBtn = el("button", { textContent: "Reintentar" });
                retryBtn.onclick = fetchWeather;
                wrap.appendChild(retryBtn);
                return wrap;
            }
            if (S.weather.info) {
                const meta = weatherMeta(S.weather.info.weatherCode);
                const card = el("div", { className: "rj-weather-card" });
                card.innerHTML = `
                    <div class="rj-weather-icon">${window.AlejoIcons.glyph(meta.g, 52)}</div>
                    <div class="rj-weather-temp">${Math.round(S.weather.info.temperatureC)}°</div>
                    <div class="rj-weather-label">${meta.label}</div>
                    <div class="rj-weather-details">
                        <span>Sensación ${Math.round(S.weather.info.apparentC)}°</span>
                        <span>Humedad ${Math.round(S.weather.info.humidity)}%</span>
                        <span>Viento ${Math.round(S.weather.info.windKmh)} km/h</span>
                    </div>
                `;
                wrap.appendChild(card);
                const refreshBtn = el("button", { className: "primary", textContent: "Actualizar" });
                refreshBtn.onclick = fetchWeather;
                wrap.appendChild(refreshBtn);
            }
            return wrap;
        }

        // ── Shell de pestañas ──
        function render() {
            root.innerHTML = "";

            const tabs = el("div", { className: "rj-tabs" });
            [["pomodoro", "Pomodoro"], ["mundial", "Mundial"], ["clima", "Clima"]].forEach(([key, label]) => {
                const btn = el("button", { className: `rj-tab${S.tab === key ? " rj-tab--active" : ""}`, textContent: label });
                btn.onclick = () => { S.tab = key; render(); };
                tabs.appendChild(btn);
            });
            root.appendChild(tabs);

            const body = el("div", { className: "rj-body" });
            if (S.tab === "pomodoro") body.appendChild(renderPomodoro());
            else if (S.tab === "mundial") body.appendChild(renderWorld());
            else body.appendChild(renderWeather());
            root.appendChild(body);
        }

        render();
        (async () => {
            const [pmCfg, wcCfg, wxCfg] = await Promise.allSettled([
                invoke("pomodoro_get_config"),
                invoke("clock_get_worldclock_config"),
                invoke("clock_get_weather_config"),
            ]);
            if (pmCfg.status === "fulfilled") S.pomodoro.config = pmCfg.value;
            if (wcCfg.status === "fulfilled") S.world.cityIds = wcCfg.value.cityIds || [];
            if (wxCfg.status === "fulfilled") S.weather.cityId = wxCfg.value.cityId || null;
            render();
            startWorldTick();
            if (S.weather.cityId) fetchWeather();
        })();
    },
    onOutput() {},
    onDone() {},
});
