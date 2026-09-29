        // ================================================================================
        // CONTROL DE ASISTENCIA (por excepción)
        // Solo se registran las incidencias: faltas, retardos, permisos, vacaciones e
        // incapacidades. Jornada: lunes a sábado → 1 día de sueldo = sueldo semanal ÷ 6.
        // Si una incidencia lleva descuento, se crea un descuento de nómina (gasto negativo,
        // categoría "Nómina") que el motor financiero ya resta del costo de nómina, y el botón
        // "Nómina de la Semana" lo aplica al pago de ese colaborador.
        // Tabla: asistencia_incidencias (sql/010_asistencia.sql).
        // ================================================================================
        const Attendance_Engine = {
            incidencias: [],
            _loadedAt: 0,
            STALE_MS: 60000,
            DIAS_LABORALES_SEMANA: 6,   // lunes a sábado
            HORAS_JORNADA: 8,           // para convertir permisos por horas a fracción de día

            TIPOS: {
                falta_injustificada: { label: 'Falta injustificada', icon: '❌', rango: true,  descuentaDefault: true,  cls: 'bg-rose-50 text-rose-700 border-rose-200' },
                falta_justificada:   { label: 'Falta justificada',   icon: '📝', rango: true,  descuentaDefault: false, cls: 'bg-amber-50 text-amber-700 border-amber-200' },
                retardo:             { label: 'Retardo',             icon: '⏰', rango: false, descuentaDefault: false, cls: 'bg-orange-50 text-orange-700 border-orange-200' },
                permiso:             { label: 'Permiso / salida temprano', icon: '🚪', rango: false, descuentaDefault: false, cls: 'bg-blue-50 text-blue-700 border-blue-200' },
                vacaciones:          { label: 'Vacaciones',          icon: '🏖️', rango: true,  descuentaDefault: false, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                incapacidad:         { label: 'Incapacidad',         icon: '🩹', rango: true,  descuentaDefault: false, cls: 'bg-purple-50 text-purple-700 border-purple-200' }
            },

            // ------------------------------------------------------------------
            // Utilidades puras (probadas en el auto-diagnóstico)
            // ------------------------------------------------------------------
            iso(d) {
                const pad = n => String(n).padStart(2, '0');
                return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
            },

            // Días laborales (lunes a sábado) entre dos fechas, inclusive
            diasLaborales(desdeStr, hastaStr) {
                const out = [];
                const d = Utils.parseFechaLocal(desdeStr);
                const fin = Utils.parseFechaLocal(hastaStr || desdeStr);
                while (d <= fin && out.length < 60) {
                    if (d.getDay() !== 0) out.push(this.iso(d));
                    d.setDate(d.getDate() + 1);
                }
                return out;
            },

            sueldoDiario(personal) {
                const s = parseFloat(personal && personal.sueldo);
                return isNaN(s) ? null : Math.round((s / this.DIAS_LABORALES_SEMANA) * 100) / 100;
            },

            // Descuentos por colaborador de la semana TRABAJADA de lunes a sábado alrededor del viernes
            // dado. semanasAtras = 1 → la semana anterior (colaboradores con semana desfasada).
            descuentosSemana(viernesStr, semanasAtras = 0) {
                const base = this._sumar(viernesStr, -7 * semanasAtras);
                const lunes = this._sumar(base, -4), sabado = this._sumar(base, 1);
                const porPersona = {};
                this.incidencias.forEach(i => {
                    const f = String(i.fecha).split('T')[0];
                    if (f < lunes || f > sabado) return;
                    const d = parseFloat(i.descuento) || 0;
                    if (d <= 0) return;
                    const k = String(i.personal_id);
                    if (!porPersona[k]) porPersona[k] = { total: 0, detalle: [] };
                    porPersona[k].total = Math.round((porPersona[k].total + d) * 100) / 100;
                    porPersona[k].detalle.push(i);
                });
                return porPersona;
            },

            _sumar(fechaStr, dias) {
                const d = Utils.parseFechaLocal(fechaStr);
                d.setDate(d.getDate() + dias);
                return this.iso(d);
            },

            // ------------------------------------------------------------------
            // Datos
            // ------------------------------------------------------------------
            async fetchAll(force = false, silencioso = false) {
                if (!supabaseClient) return;
                if (!force && (Date.now() - this._loadedAt) < this.STALE_MS) return;
                try {
                    const { data, error } = await supabaseClient.from('asistencia_incidencias').select('*').order('fecha', { ascending: false });
                    if (error) throw error;
                    this.incidencias = data || [];
                    this._loadedAt = Date.now();
                } catch (error) {
                    console.error('Error al cargar asistencia:', error);
                    if (!silencioso) showToast(`No se pudo cargar la asistencia: ${error.message}`, true);
                }
            },

            async load(force = false) {
                await this.fetchAll(force);
                this.render();
            },

            personalActivo() {
                return (State.personal || []).filter(p => !p.fecha_egreso || Utils.parseFechaLocal(p.fecha_egreso) >= new Date(new Date().toDateString()));
            },

            getPersona(id) {
                return (State.personal || []).find(p => String(p.id) === String(id));
            },

            // ------------------------------------------------------------------
            // Formulario de registro
            // ------------------------------------------------------------------
            render() {
                const sel = document.getElementById('asis-personal');
                if (sel) {
                    const actual = sel.value;
                    sel.innerHTML = this.personalActivo().map(p => `<option value="${p.id}">${Utils.escapeHtml(p.nombre)}</option>`).join('');
                    if (actual) sel.value = actual;
                }
                const f = document.getElementById('asis-fecha');
                if (f && !f.value) f.value = this.iso(new Date());
                const mes = document.getElementById('asis-mes');
                if (mes && !mes.value) mes.value = this.iso(new Date()).slice(0, 7);
                this.onTipoChange(false);
                this.renderResumen();
                this.renderLista();
            },

            onTipoChange(resetDescuento = true) {
                const tipo = document.getElementById('asis-tipo')?.value;
                if (!tipo) return;
                const cfg = this.TIPOS[tipo];
                const show = (id, on) => document.getElementById(id)?.classList.toggle('hidden', !on);
                show('asis-hasta-wrap', cfg.rango);
                show('asis-minutos-wrap', tipo === 'retardo');
                show('asis-duracion-wrap', tipo === 'permiso');
                if (!cfg.rango) { const h = document.getElementById('asis-hasta'); if (h) h.value = ''; }
                if (resetDescuento) {
                    const chk = document.getElementById('asis-descontar');
                    if (chk) chk.checked = cfg.descuentaDefault;
                    const m = document.getElementById('asis-descuento');
                    if (m) m.dataset.manual = '';
                }
                this.onDuracionChange();
            },

            onDuracionChange() {
                const dur = document.getElementById('asis-duracion')?.value;
                document.getElementById('asis-horas-wrap')?.classList.toggle('hidden', dur !== 'horas');
                this.recalcDescuento();
            },

            fraccionActual() {
                const tipo = document.getElementById('asis-tipo')?.value;
                if (tipo === 'retardo') return 1; // fracción solo informativa; el descuento de retardo lo fijas tú
                if (tipo !== 'permiso') return 1;
                const dur = document.getElementById('asis-duracion')?.value;
                if (dur === 'medio') return 0.5;
                if (dur === 'horas') {
                    const h = parseFloat(document.getElementById('asis-horas')?.value) || 0;
                    return Math.min(1, Math.max(0.01, h / this.HORAS_JORNADA));
                }
                return 1;
            },

            recalcDescuento() {
                const tipo = document.getElementById('asis-tipo')?.value;
                const persona = this.getPersona(document.getElementById('asis-personal')?.value);
                const chk = document.getElementById('asis-descontar');
                const input = document.getElementById('asis-descuento');
                const wrap = document.getElementById('asis-descuento-wrap');
                if (!chk || !input) return;
                wrap?.classList.toggle('hidden', !chk.checked);

                const diario = this.sueldoDiario(persona);
                if (chk.checked && input.dataset.manual !== '1') {
                    if (tipo === 'retardo') input.value = '';
                    else input.value = diario !== null ? (Math.round(diario * this.fraccionActual() * 100) / 100) : '';
                }
                const ref = document.getElementById('asis-ref-diario');
                if (ref) ref.textContent = diario !== null ? `Día de sueldo: ${Utils.formatter.format(diario)} (sueldo semanal ÷ 6)` : 'Tu rol no puede ver sueldos: captura el monto del descuento a mano.';
                this.renderPreview();
            },

            renderPreview() {
                const el = document.getElementById('asis-preview');
                if (!el) return;
                const tipo = document.getElementById('asis-tipo')?.value;
                const desde = document.getElementById('asis-fecha')?.value;
                if (!desde) { el.textContent = ''; return; }
                const hasta = this.TIPOS[tipo]?.rango ? (document.getElementById('asis-hasta')?.value || desde) : desde;
                const dias = this.diasLaborales(desde, hasta);
                const descontar = document.getElementById('asis-descontar')?.checked;
                const porDia = parseFloat(document.getElementById('asis-descuento')?.value) || 0;
                const total = descontar ? porDia * dias.length : 0;
                if (dias.length === 0) { el.textContent = '⚠️ El rango no tiene días laborales (domingo no cuenta).'; return; }
                el.textContent = `Se registrará${dias.length > 1 ? 'n' : ''} ${dias.length} día${dias.length > 1 ? 's' : ''} laboral${dias.length > 1 ? 'es' : ''}` +
                    (descontar ? ` · descuento total ${Utils.formatter.format(total)}` : ' · sin descuento');
            },

            async save(ev) {
                ev.preventDefault();
                const personalId = document.getElementById('asis-personal').value;
                const persona = this.getPersona(personalId);
                if (!persona) { showToast('Selecciona un colaborador.', true); return; }
                const tipo = document.getElementById('asis-tipo').value;
                const cfg = this.TIPOS[tipo];
                const desde = document.getElementById('asis-fecha').value;
                const hasta = cfg.rango ? (document.getElementById('asis-hasta').value || desde) : desde;
                if (hasta < desde) { showToast('La fecha final no puede ser antes de la inicial.', true); return; }
                const dias = this.diasLaborales(desde, hasta);
                if (dias.length === 0) { showToast('Ese día es domingo (no laboral).', true); return; }

                const descontar = document.getElementById('asis-descontar').checked;
                const porDia = descontar ? Math.round((parseFloat(document.getElementById('asis-descuento').value) || 0) * 100) / 100 : 0;
                if (descontar && porDia <= 0) { showToast('Indica el monto del descuento o desmarca "Descontar".', true); return; }
                const minutos = tipo === 'retardo' ? (parseInt(document.getElementById('asis-minutos').value) || null) : null;
                const fraccion = this.fraccionActual();
                const notas = document.getElementById('asis-notas').value.trim() || null;
                const usuario = document.getElementById('user-display-name')?.innerText || 'Administrador';

                const choque = this.incidencias.find(i => String(i.personal_id) === String(personalId) && i.tipo === tipo && dias.includes(String(i.fecha).split('T')[0]));
                if (choque) { showToast(`Ya hay "${cfg.label}" registrada para ${persona.nombre} el ${choque.fecha}.`, true); return; }

                let ok = 0;
                for (const fecha of dias) {
                    let gastoId = null;
                    if (porDia > 0) {
                        const fStr = Utils.parseFechaLocal(fecha).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
                        const { data: g, error: eG } = await supabaseClient.from('gastos').insert([{
                            fecha, monto: -porDia, categoria: 'Nómina', metodo_pago: 'Efectivo',
                            concepto: `Descuento ${cfg.label.toLowerCase()} — ${persona.nombre} (${fStr})`,
                            description: 'Descuento generado por Control de Asistencia',
                            observaciones: notas || '', tiene_cfdi: false, iva: 0, registrado_por: usuario
                        }]).select('id').single();
                        if (eG) { showToast('No se pudo crear el descuento de nómina: ' + eG.message, true); break; }
                        gastoId = g.id;
                    }
                    const { error } = await supabaseClient.from('asistencia_incidencias').insert([{
                        personal_id: persona.id, personal_nombre: persona.nombre, fecha, tipo,
                        fraccion_dia: fraccion, minutos, descuento: porDia, gasto_id: gastoId, notas, registrado_por: usuario
                    }]);
                    if (error) {
                        if (gastoId) await supabaseClient.from('gastos').delete().eq('id', gastoId);
                        showToast('No se pudo registrar la incidencia: ' + error.message, true);
                        break;
                    }
                    ok++;
                }
                if (ok > 0) {
                    showToast(`${cfg.label} registrada: ${persona.nombre}, ${ok} día(s)${porDia > 0 ? ` · descuento ${Utils.formatter.format(porDia * ok)}` : ''}.`);
                    document.getElementById('asis-notas').value = '';
                    document.getElementById('asis-hasta').value = '';
                    const m = document.getElementById('asis-descuento'); if (m) m.dataset.manual = '';
                }
                await this.fetchAll(true);
                this.render();
                if (porDia > 0) await API_Service.fetchExpenses(true);
            },

            eliminar(id) {
                const inc = this.incidencias.find(i => String(i.id) === String(id));
                if (!inc) return;
                const extra = (parseFloat(inc.descuento) || 0) > 0 ? ` También se quitará el descuento de nómina de ${Utils.formatter.format(inc.descuento)}.` : '';
                customConfirm('¿Borrar incidencia?', `${this.TIPOS[inc.tipo]?.label || inc.tipo} de ${inc.personal_nombre || ''} el ${inc.fecha}.${extra}`, async () => {
                    if (inc.gasto_id) {
                        const { error: eG } = await supabaseClient.from('gastos').delete().eq('id', inc.gasto_id);
                        if (eG) { showToast('No se pudo quitar el descuento de nómina: ' + eG.message, true); return; }
                    }
                    const { error } = await supabaseClient.from('asistencia_incidencias').delete().eq('id', inc.id);
                    if (error) { showToast('No se pudo borrar: ' + error.message, true); return; }
                    showToast('Incidencia eliminada.');
                    await Attendance_Engine.fetchAll(true);
                    Attendance_Engine.render();
                    if (inc.gasto_id) await API_Service.fetchExpenses(true);
                });
            },

            // ------------------------------------------------------------------
            // Resumen del mes por colaborador + lista
            // ------------------------------------------------------------------
            delMes() {
                const mes = document.getElementById('asis-mes')?.value || this.iso(new Date()).slice(0, 7);
                return this.incidencias.filter(i => String(i.fecha).slice(0, 7) === mes);
            },

            renderResumen() {
                const cont = document.getElementById('asis-resumen');
                if (!cont) return;
                const delMes = this.delMes();
                const anio = (document.getElementById('asis-mes')?.value || this.iso(new Date())).slice(0, 4);
                const personas = this.personalActivo();
                if (personas.length === 0) { cont.innerHTML = `<p class="text-xs text-slate-400">Sin colaboradores activos.</p>`; return; }
                cont.innerHTML = personas.map(p => {
                    const suyas = delMes.filter(i => String(i.personal_id) === String(p.id));
                    const cuenta = t => suyas.filter(i => i.tipo === t).length;
                    const desc = suyas.reduce((a, i) => a + (parseFloat(i.descuento) || 0), 0);
                    const vacAnio = this.incidencias.filter(i => String(i.personal_id) === String(p.id) && i.tipo === 'vacaciones' && String(i.fecha).startsWith(anio)).length;
                    const chip = (t, n) => n > 0 ? `<span class="border rounded-full px-2 py-0.5 ${this.TIPOS[t].cls}">${this.TIPOS[t].icon} ${n} ${this.TIPOS[t].label.toLowerCase()}</span>` : '';
                    const chips = ['falta_injustificada', 'falta_justificada', 'retardo', 'permiso', 'vacaciones', 'incapacidad'].map(t => chip(t, cuenta(t))).join('');
                    return `
                        <div class="border border-slate-200 rounded-2xl p-3 flex flex-col gap-2">
                            <div class="flex items-center justify-between">
                                <span class="font-bold text-sm text-slate-900">${Utils.escapeHtml(p.nombre)}</span>
                                ${desc > 0 ? `<span class="text-[11px] font-bold text-rose-600">Descontado: ${Utils.formatter.format(desc)}</span>` : ''}
                            </div>
                            <div class="flex flex-wrap gap-1.5 text-[10px] font-semibold">${chips || '<span class="text-emerald-600">✓ Sin incidencias en el mes</span>'}</div>
                            <span class="text-[10px] text-slate-400">Vacaciones tomadas en ${anio}: ${vacAnio} día${vacAnio === 1 ? '' : 's'}</span>
                        </div>`;
                }).join('');
            },

            renderLista() {
                const body = document.getElementById('asis-lista');
                if (!body) return;
                const rows = this.delMes();
                if (rows.length === 0) { body.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-xs text-slate-400">Sin incidencias en este mes.</td></tr>`; return; }
                body.innerHTML = rows.map(i => {
                    const cfg = this.TIPOS[i.tipo] || { label: i.tipo, icon: '', cls: '' };
                    const fStr = Utils.parseFechaLocal(String(i.fecha).split('T')[0]).toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short' });
                    let detalle = '';
                    if (i.tipo === 'retardo' && i.minutos) detalle = `${i.minutos} min`;
                    else if (i.tipo === 'permiso') detalle = parseFloat(i.fraccion_dia) === 1 ? 'Día completo' : (parseFloat(i.fraccion_dia) === 0.5 ? 'Medio día' : `${Math.round(parseFloat(i.fraccion_dia) * this.HORAS_JORNADA * 10) / 10} h`);
                    return `
                        <tr class="border-b border-slate-100 text-xs">
                            <td class="py-2 px-2 capitalize text-slate-600">${fStr}</td>
                            <td class="py-2 px-2 font-semibold text-slate-800">${Utils.escapeHtml(i.personal_nombre || '')}</td>
                            <td class="py-2 px-2"><span class="border rounded-full px-2 py-0.5 text-[10px] font-semibold ${cfg.cls}">${cfg.icon} ${cfg.label}</span>${detalle ? ` <span class="text-[10px] text-slate-400">${detalle}</span>` : ''}${i.notas ? `<span class="block text-[10px] text-slate-400">${Utils.escapeHtml(i.notas)}</span>` : ''}</td>
                            <td class="py-2 px-2 text-right ${(parseFloat(i.descuento) || 0) > 0 ? 'text-rose-600 font-bold' : 'text-slate-400'}">${(parseFloat(i.descuento) || 0) > 0 ? '−' + Utils.formatter.format(i.descuento) : '—'}</td>
                            <td class="py-2 px-2 text-right"><button onclick="Attendance_Engine.eliminar(${i.id})" class="text-rose-300 hover:text-rose-600" title="Borrar"><span class="material-icons text-sm">delete</span></button></td>
                        </tr>`;
                }).join('');
            },

            // ------------------------------------------------------------------
            // Auto-diagnóstico
            // ------------------------------------------------------------------
            runSelfTest() {
                const results = [];
                const check = (label, actual, expected) => results.push({ label, actual, expected, ok: actual === expected, raw: true });
                check('Asistencia: día de sueldo de $6,086 = $1,014.33', this.sueldoDiario({ sueldo: 6086 }), 1014.33);
                check('Asistencia: lunes 28-sep a lunes 5-oct = 7 días laborales (sin domingo)', this.diasLaborales('2026-09-28', '2026-10-05').length, 7);
                check('Asistencia: domingo solo = 0 días laborales', this.diasLaborales('2026-10-04', '2026-10-04').length, 0);
                const backup = this.incidencias;
                try {
                    this.incidencias = [
                        { personal_id: 2, fecha: '2026-09-28', descuento: 1014.33 },
                        { personal_id: 2, fecha: '2026-10-03', descuento: 500 },
                        { personal_id: 2, fecha: '2026-10-05', descuento: 999 },   // semana siguiente
                        { personal_id: 1, fecha: '2026-09-29', descuento: 0 }      // sin descuento
                    ];
                    const d = this.descuentosSemana('2026-10-02');
                    check('Asistencia: descuentos de la semana del viernes 2-oct = $1,514.33', d['2'] ? d['2'].total : 0, 1514.33);
                    check('Asistencia: incidencias sin descuento no cuentan', d['1'] === undefined, true);
                    const dAnt = this.descuentosSemana('2026-10-09', 1);
                    check('Asistencia: semana desfasada — pago del 9-oct descuenta la semana del 28-sep ($1,514.33)', dAnt['2'] ? dAnt['2'].total : 0, 1514.33);
                } finally {
                    this.incidencias = backup;
                }
                return results;
            }
        };
