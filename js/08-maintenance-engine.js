        // ================================================================================
        // BITÁCORA DE MANTENIMIENTO PREVENTIVO (Fase 1 — uso interno)
        // Vehículos de clientes inscritos a un plan de mantenimiento. Cada servicio vence
        // por kilometraje O por tiempo, lo que llegue primero. Los vehículos se ligan a las
        // órdenes de trabajo por PLACAS (normalizadas), sin tocar la tabla ordenes_trabajo.
        // Tablas: mant_catalogo, mant_clientes, mant_vehiculos, mant_planes, mant_historial
        // (ver sql/008_bitacora_mantenimiento.sql).
        // ================================================================================
        const Maintenance_Engine = {
            catalogo: [],
            clientes: [],
            vehiculos: [],
            planes: [],
            historial: [],
            _loadedAt: 0,
            _loadingPromise: null,
            STALE_MS: 60000,
            DIAS_AVISO: 15,          // "por vencer" si faltan 15 días o menos
            PCT_AVISO_KM: 0.10,      // "por vencer" si falta 10% del periodo en km...
            MIN_AVISO_KM: 500,       // ...o 500 km, lo que sea mayor
            _ordenPendiente: null,   // orden recién cerrada esperando confirmar mantenimientos

            // ------------------------------------------------------------------
            // Utilidades puras (probadas en el auto-diagnóstico)
            // ------------------------------------------------------------------
            normPlacas(p) {
                return String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            },

            toISODate(d) {
                const pad = n => String(n).padStart(2, '0');
                return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
            },

            addMonths(fechaStr, meses) {
                const d = Utils.parseFechaLocal(fechaStr);
                const dia = d.getDate();
                const r = new Date(d.getFullYear(), d.getMonth() + meses, 1, 12, 0, 0);
                const ultimoDia = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
                r.setDate(Math.min(dia, ultimoDia));
                return this.toISODate(r);
            },

            diasEntre(desdeStr, hastaStr) {
                const a = Utils.parseFechaLocal(desdeStr), b = Utils.parseFechaLocal(hastaStr);
                const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
                const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
                return Math.round((ub - ua) / 86400000);
            },

            getIntervalos(plan, catItem) {
                return {
                    km: (plan && plan.intervalo_km) || (catItem && catItem.intervalo_km) || null,
                    meses: (plan && plan.intervalo_meses) || (catItem && catItem.intervalo_meses) || null
                };
            },

            // Estado de UN servicio de UN vehículo. Vence por km o por tiempo, lo que llegue primero.
            computeItemStatus({ plan, catItem, vehiculo, ultimo, hoy }) {
                const { km: intKm, meses: intMeses } = this.getIntervalos(plan, catItem);
                const res = {
                    estado: 'sin_historial', intKm, intMeses,
                    proximoKm: null, kmRestantes: null, proximaFecha: null, diasRestantes: null,
                    ultimoFecha: ultimo ? ultimo.fecha : null, ultimoKm: ultimo ? Number(ultimo.kilometraje) || 0 : null
                };
                if (!ultimo) return res;

                let vencido = false, porVencer = false;
                const kmActual = Number(vehiculo && vehiculo.km_actual) || 0;

                if (intKm) {
                    res.proximoKm = (Number(ultimo.kilometraje) || 0) + intKm;
                    if (kmActual > 0) {
                        res.kmRestantes = res.proximoKm - kmActual;
                        const umbral = Math.max(this.MIN_AVISO_KM, intKm * this.PCT_AVISO_KM);
                        if (res.kmRestantes <= 0) vencido = true;
                        else if (res.kmRestantes <= umbral) porVencer = true;
                    }
                }
                if (intMeses) {
                    res.proximaFecha = this.addMonths(ultimo.fecha, intMeses);
                    res.diasRestantes = this.diasEntre(hoy, res.proximaFecha);
                    if (res.diasRestantes <= 0) vencido = true;
                    else if (res.diasRestantes <= this.DIAS_AVISO) porVencer = true;
                }
                res.estado = vencido ? 'vencido' : (porVencer ? 'por_vencer' : 'al_dia');
                return res;
            },

            ESTADO_PRIORIDAD: { vencido: 0, por_vencer: 1, sin_historial: 2, al_dia: 3 },
            ESTADO_UI: {
                vencido:       { label: 'Vencido',       dot: '🔴', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
                por_vencer:    { label: 'Por vencer',    dot: '🟡', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
                al_dia:        { label: 'Al día',        dot: '🟢', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                sin_historial: { label: 'Sin historial', dot: '⚪', cls: 'bg-slate-100 text-slate-600 border-slate-200' }
            },

            // ------------------------------------------------------------------
            // Datos
            // ------------------------------------------------------------------
            puedeGestionar() {
                return ['Administrador', 'Contabilidad/Finanzas', 'Recepcionista'].includes(State.currentRole);
            },

            async fetchAll(force = false) {
                if (!supabaseClient) return;
                if (!force && (Date.now() - this._loadedAt) < this.STALE_MS) return;
                if (this._loadingPromise) return this._loadingPromise;

                this._loadingPromise = (async () => {
                    try {
                        const [cat, cli, veh, pla, his] = await Promise.all([
                            supabaseClient.from('mant_catalogo').select('*').order('nombre', { ascending: true }),
                            supabaseClient.from('mant_clientes').select('*').order('nombre', { ascending: true }),
                            supabaseClient.from('mant_vehiculos').select('*').order('placas', { ascending: true }),
                            supabaseClient.from('mant_planes').select('*'),
                            supabaseClient.from('mant_historial').select('*').order('fecha', { ascending: false })
                        ]);
                        const err = cat.error || cli.error || veh.error || pla.error || his.error;
                        if (err) throw err;
                        this.catalogo = cat.data || [];
                        this.clientes = cli.data || [];
                        this.vehiculos = veh.data || [];
                        this.planes = pla.data || [];
                        this.historial = his.data || [];
                        this._loadedAt = Date.now();
                    } catch (error) {
                        console.error('Error al cargar bitácora de mantenimiento:', error);
                        showToast(`No se pudo cargar la bitácora de mantenimiento: ${error.message}`, true);
                    } finally {
                        this._loadingPromise = null;
                    }
                })();
                return this._loadingPromise;
            },

            async load(force = false) {
                await this.fetchAll(force);
                this.render();
            },

            getCatItem(id) { return this.catalogo.find(c => Number(c.id) === Number(id)); },
            getCliente(id) { return this.clientes.find(c => Number(c.id) === Number(id)); },
            getVehiculo(id) { return this.vehiculos.find(v => Number(v.id) === Number(id)); },
            getVehiculoPorPlacas(placas) {
                const n = this.normPlacas(placas);
                if (!n) return null;
                return this.vehiculos.find(v => v.activo !== false && this.normPlacas(v.placas) === n) || null;
            },
            getPlanesActivos(vehiculoId) {
                return this.planes.filter(p => Number(p.vehiculo_id) === Number(vehiculoId) && p.activo !== false && this.getCatItem(p.catalogo_id));
            },
            getUltimo(vehiculoId, catalogoId) {
                // historial viene ordenado por fecha DESC; a igual fecha gana el de mayor km
                let best = null;
                this.historial.forEach(h => {
                    if (Number(h.vehiculo_id) !== Number(vehiculoId) || Number(h.catalogo_id) !== Number(catalogoId)) return;
                    if (!best || h.fecha > best.fecha || (h.fecha === best.fecha && (Number(h.kilometraje) || 0) > (Number(best.kilometraje) || 0))) best = h;
                });
                return best;
            },

            // Estado de todos los servicios de un vehículo, ordenados del más urgente al menos urgente
            getVehiculoItems(vehiculo, hoy) {
                return this.getPlanesActivos(vehiculo.id).map(plan => {
                    const catItem = this.getCatItem(plan.catalogo_id);
                    const st = this.computeItemStatus({ plan, catItem, vehiculo, ultimo: this.getUltimo(vehiculo.id, plan.catalogo_id), hoy });
                    return { plan, catItem, ...st };
                }).sort((a, b) => this.ESTADO_PRIORIDAD[a.estado] - this.ESTADO_PRIORIDAD[b.estado]);
            },

            peorEstado(items) {
                if (!items.length) return null;
                return items.reduce((w, i) => this.ESTADO_PRIORIDAD[i.estado] < this.ESTADO_PRIORIDAD[w] ? i.estado : w, 'al_dia');
            },

            // ------------------------------------------------------------------
            // Render principal de la pestaña
            // ------------------------------------------------------------------
            render() {
                const section = document.getElementById('tab-mantenimiento');
                if (!section) return;

                const hoy = this.toISODate(new Date());
                const vehActivos = this.vehiculos.filter(v => v.activo !== false);
                const conItems = vehActivos.map(v => ({ v, items: this.getVehiculoItems(v, hoy) }));

                let nVenc = 0, nPorV = 0, nSinH = 0;
                conItems.forEach(({ items }) => items.forEach(i => {
                    if (i.estado === 'vencido') nVenc++;
                    else if (i.estado === 'por_vencer') nPorV++;
                    else if (i.estado === 'sin_historial') nSinH++;
                }));
                const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
                setText('mant-kpi-vehiculos', vehActivos.length);
                setText('mant-kpi-vencidos', nVenc);
                setText('mant-kpi-porvencer', nPorV);
                setText('mant-kpi-sinhist', nSinH);

                document.querySelectorAll('.mant-gestion-only').forEach(el => el.classList.toggle('hidden', !this.puedeGestionar()));

                // Filtro de clientes
                const selCli = document.getElementById('mant-filtro-cliente');
                if (selCli) {
                    const actual = selCli.value;
                    selCli.innerHTML = `<option value="">Todos los clientes</option>` +
                        this.clientes.filter(c => c.activo !== false).map(c => `<option value="${c.id}">${Utils.escapeHtml(c.nombre)}</option>`).join('');
                    selCli.value = actual;
                }

                this.renderTablero(conItems);
                this.renderClientes();
            },

            renderTablero(conItems) {
                const body = document.getElementById('mant-tablero-body');
                if (!body) return;
                const filtroEstado = document.getElementById('mant-filtro-estado')?.value || 'pendientes';
                const filtroCliente = document.getElementById('mant-filtro-cliente')?.value || '';
                const q = (document.getElementById('mant-filtro-buscar')?.value || '').trim().toLowerCase();

                const pasaEstado = (e) => {
                    if (filtroEstado === 'todos') return true;
                    if (filtroEstado === 'pendientes') return e === 'vencido' || e === 'por_vencer';
                    return e === filtroEstado;
                };

                const filas = conItems
                    .filter(({ v }) => !filtroCliente || Number(v.cliente_id) === Number(filtroCliente))
                    .filter(({ v }) => {
                        if (!q) return true;
                        const cli = this.getCliente(v.cliente_id);
                        return [v.placas, v.marca, v.modelo, v.numero_economico, cli && cli.nombre]
                            .some(x => String(x || '').toLowerCase().includes(q));
                    })
                    .map(({ v, items }) => ({ v, items: items.filter(i => pasaEstado(i.estado)), todos: items }))
                    .filter(({ items }) => items.length > 0)
                    .sort((a, b) => this.ESTADO_PRIORIDAD[this.peorEstado(a.items)] - this.ESTADO_PRIORIDAD[this.peorEstado(b.items)]);

                if (filas.length === 0) {
                    const msg = this.vehiculos.length === 0
                        ? 'Aún no hay vehículos en el programa. Da de alta un cliente y sus vehículos abajo.'
                        : (filtroEstado === 'pendientes' ? '🎉 Nada vencido ni por vencer con estos filtros.' : 'Sin resultados con estos filtros.');
                    body.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-slate-400 text-xs">${msg}</td></tr>`;
                    return;
                }

                body.innerHTML = filas.map(({ v, items, todos }) => {
                    const cli = this.getCliente(v.cliente_id);
                    const chips = items.map(i => this.chipHtml(i)).join('');
                    const tieneAviso = todos.some(i => i.estado === 'vencido' || i.estado === 'por_vencer');
                    const tel = cli && cli.telefono;
                    const waBtn = (tieneAviso && tel)
                        ? `<a href="${this.whatsappLink(v.id)}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 rounded-lg text-[11px] font-bold"><span class="material-icons text-sm">chat</span>WhatsApp</a>`
                        : (tieneAviso ? `<span class="text-[10px] text-slate-400">Sin teléfono</span>` : '');
                    return `
                        <tr class="hover:bg-slate-50 border-b border-slate-100 align-top">
                            <td class="py-3 px-4">
                                <span class="font-bold text-slate-900 block">${Utils.escapeHtml(v.placas)}${v.numero_economico ? ` <span class="text-[10px] text-slate-400 font-semibold">#${Utils.escapeHtml(v.numero_economico)}</span>` : ''}</span>
                                <span class="text-[11px] text-slate-500 block">${Utils.escapeHtml([v.marca, v.modelo, v.anio].filter(Boolean).join(' '))}</span>
                                <span class="text-[10px] text-slate-400 block">${(Number(v.km_actual) || 0).toLocaleString('es-MX')} km${v.km_actual_fecha ? ` · lectura ${this.fmtFecha(v.km_actual_fecha)}` : ''}</span>
                            </td>
                            <td class="py-3 px-4 text-xs">
                                <span class="font-semibold text-slate-700 block">${Utils.escapeHtml(cli ? cli.nombre : '—')}</span>
                                ${cli && cli.contacto_nombre ? `<span class="text-[10px] text-slate-400 block">${Utils.escapeHtml(cli.contacto_nombre)}</span>` : ''}
                            </td>
                            <td class="py-3 px-4"><div class="flex flex-col gap-1.5">${chips}</div></td>
                            <td class="py-3 px-4 text-right">
                                <div class="flex flex-col items-end gap-1.5">
                                    ${waBtn}
                                    <button onclick="Maintenance_Engine.openVehiculoDetalle(${v.id})" class="text-blue-600 hover:underline text-[11px] font-semibold">Ver bitácora</button>
                                </div>
                            </td>
                        </tr>`;
                }).join('');
            },

            fmtFecha(f) {
                if (!f) return '—';
                return Utils.parseFechaLocal(f).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
            },

            detalleVencimiento(i) {
                if (i.estado === 'sin_historial') return 'Sin registro previo — captura el último servicio conocido';
                const partes = [];
                if (i.kmRestantes !== null) {
                    partes.push(i.kmRestantes > 0
                        ? `faltan ${i.kmRestantes.toLocaleString('es-MX')} km`
                        : `pasado por ${Math.abs(i.kmRestantes).toLocaleString('es-MX')} km`);
                } else if (i.proximoKm !== null) {
                    partes.push(`a los ${i.proximoKm.toLocaleString('es-MX')} km`);
                }
                if (i.diasRestantes !== null) {
                    partes.push(i.diasRestantes > 0
                        ? `vence ${this.fmtFecha(i.proximaFecha)} (${i.diasRestantes} días)`
                        : `venció ${this.fmtFecha(i.proximaFecha)} (hace ${Math.abs(i.diasRestantes)} días)`);
                }
                return partes.join(' · ');
            },

            chipHtml(i) {
                const ui = this.ESTADO_UI[i.estado];
                return `
                    <div class="border rounded-lg px-2.5 py-1.5 text-[11px] ${ui.cls}">
                        <span class="font-bold">${ui.dot} ${Utils.escapeHtml(i.catItem.nombre)}</span>
                        <span class="block opacity-80">${this.detalleVencimiento(i)}</span>
                    </div>`;
            },

            renderClientes() {
                const cont = document.getElementById('mant-clientes-list');
                if (!cont) return;
                if (this.clientes.length === 0) {
                    cont.innerHTML = `<p class="text-xs text-slate-400 text-center py-4">Sin clientes en el programa todavía.</p>`;
                    return;
                }
                const hoy = this.toISODate(new Date());
                const gestion = this.puedeGestionar();
                cont.innerHTML = this.clientes.map(c => {
                    const vehs = this.vehiculos.filter(v => Number(v.cliente_id) === Number(c.id));
                    const vehHtml = vehs.length === 0
                        ? `<p class="text-[11px] text-slate-400 px-1">Sin vehículos.</p>`
                        : vehs.map(v => {
                            const peor = v.activo === false ? null : this.peorEstado(this.getVehiculoItems(v, hoy));
                            const dot = v.activo === false ? '⏸️' : (peor ? this.ESTADO_UI[peor].dot : '⚪');
                            return `
                                <button onclick="Maintenance_Engine.openVehiculoDetalle(${v.id})" class="flex items-center justify-between text-left text-xs px-3 py-2 rounded-lg hover:bg-slate-50 border border-slate-100 ${v.activo === false ? 'opacity-50' : ''}">
                                    <span><span class="mr-1">${dot}</span><strong>${Utils.escapeHtml(v.placas)}</strong> <span class="text-slate-500">${Utils.escapeHtml([v.marca, v.modelo].filter(Boolean).join(' '))}</span>${v.numero_economico ? ` <span class="text-slate-400">#${Utils.escapeHtml(v.numero_economico)}</span>` : ''}</span>
                                    <span class="material-icons text-sm text-slate-300">chevron_right</span>
                                </button>`;
                        }).join('');
                    return `
                        <div class="border border-slate-200 rounded-2xl p-3 flex flex-col gap-2 ${c.activo === false ? 'opacity-60' : ''}">
                            <div class="flex items-start justify-between gap-2">
                                <div>
                                    <span class="font-bold text-slate-900 text-sm">${Utils.escapeHtml(c.nombre)}</span>${c.activo === false ? ' <span class="text-[10px] text-slate-400">(inactivo)</span>' : ''}
                                    <span class="block text-[11px] text-slate-500">${Utils.escapeHtml([c.contacto_nombre, c.telefono].filter(Boolean).join(' · ') || 'Sin contacto')}</span>
                                </div>
                                ${gestion ? `
                                <div class="flex gap-1 shrink-0">
                                    <button onclick="Maintenance_Engine.openVehiculoForm(null, ${c.id})" class="text-[11px] font-semibold text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg">+ Vehículo</button>
                                    <button onclick="Maintenance_Engine.openClienteForm(${c.id})" class="text-slate-400 hover:text-slate-700 px-1"><span class="material-icons text-base">edit</span></button>
                                </div>` : ''}
                            </div>
                            <div class="flex flex-col gap-1">${vehHtml}</div>
                        </div>`;
                }).join('');
            },

            // ------------------------------------------------------------------
            // WhatsApp
            // ------------------------------------------------------------------
            normTelefono(tel) {
                let d = String(tel || '').replace(/\D/g, '');
                if (d.length === 10) d = '52' + d;
                return d;
            },

            whatsappLink(vehiculoId) {
                const v = this.getVehiculo(vehiculoId);
                if (!v) return '#';
                const cli = this.getCliente(v.cliente_id);
                const hoy = this.toISODate(new Date());
                const items = this.getVehiculoItems(v, hoy).filter(i => i.estado === 'vencido' || i.estado === 'por_vencer');
                const saludo = cli && cli.contacto_nombre ? `Hola ${cli.contacto_nombre}` : 'Hola';
                const auto = [v.marca, v.modelo].filter(Boolean).join(' ');
                const lista = items.map(i => `• ${i.catItem.nombre}${i.estado === 'vencido' ? ' (vencido)' : ' (próximo)'}`).join('\n');
                const texto = `${saludo}, le escribimos de BEFIX GARAGE. 🔧\n\nSegún la bitácora de mantenimiento de su vehículo ${auto} placas ${v.placas}${v.numero_economico ? ` (económico #${v.numero_economico})` : ''}, le corresponde:\n${lista}\n\n¿Le agendamos una cita?`;
                return `https://wa.me/${this.normTelefono(cli && cli.telefono)}?text=${encodeURIComponent(texto)}`;
            },

            // ------------------------------------------------------------------
            // Modal genérico (#modal-mant)
            // ------------------------------------------------------------------
            openModal(html) {
                const m = document.getElementById('modal-mant');
                document.getElementById('modal-mant-content').innerHTML = html;
                m.classList.remove('hidden');
            },
            closeModal() {
                document.getElementById('modal-mant')?.classList.add('hidden');
                this._ordenPendiente = null;
            },

            inputCls: 'w-full border rounded-xl px-3 py-2 text-sm focus:outline-none bg-slate-50',
            labelCls: 'text-[11px] font-semibold text-slate-500 uppercase',

            modalHeader(titulo, sub = '') {
                return `
                    <div class="px-6 py-4 border-b flex justify-between items-center bg-slate-50">
                        <div>
                            <h3 class="font-bold text-slate-900 text-lg">${titulo}</h3>
                            ${sub ? `<p class="text-xs text-slate-400">${sub}</p>` : ''}
                        </div>
                        <button type="button" onclick="Maintenance_Engine.closeModal()" class="text-slate-400 hover:text-slate-700"><span class="material-icons">close</span></button>
                    </div>`;
            },

            // ------------------------------------------------------------------
            // Clientes
            // ------------------------------------------------------------------
            openClienteForm(id = null) {
                const c = id ? this.getCliente(id) : {};
                const e = (x) => Utils.escapeHtml(x ?? '');
                this.openModal(`
                    ${this.modalHeader(id ? 'Editar cliente' : 'Nuevo cliente del programa', 'Empresa o persona con vehículos en plan de mantenimiento')}
                    <form onsubmit="Maintenance_Engine.saveCliente(event, ${id || 'null'})" class="p-6 flex flex-col gap-4 overflow-y-auto min-h-0">
                        <div class="flex flex-col gap-1.5"><label class="${this.labelCls}">Nombre / Empresa *</label><input id="mant-cli-nombre" required value="${e(c.nombre)}" class="${this.inputCls}"></div>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div class="flex flex-col gap-1.5"><label class="${this.labelCls}">Responsable de flotilla</label><input id="mant-cli-contacto" value="${e(c.contacto_nombre)}" class="${this.inputCls}"></div>
                            <div class="flex flex-col gap-1.5"><label class="${this.labelCls}">Teléfono (WhatsApp)</label><input id="mant-cli-telefono" value="${e(c.telefono)}" placeholder="656 123 4567" class="${this.inputCls}"></div>
                        </div>
                        <div class="flex flex-col gap-1.5"><label class="${this.labelCls}">Correo</label><input id="mant-cli-email" type="email" value="${e(c.email)}" class="${this.inputCls}"></div>
                        <div class="flex flex-col gap-1.5"><label class="${this.labelCls}">Notas</label><textarea id="mant-cli-notas" rows="2" class="${this.inputCls}">${e(c.notas)}</textarea></div>
                        ${id ? `<label class="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" id="mant-cli-activo" ${c.activo !== false ? 'checked' : ''}> Cliente activo en el programa</label>` : ''}
                        <div class="flex justify-end gap-2 pt-2 border-t">
                            <button type="button" onclick="Maintenance_Engine.closeModal()" class="px-3 py-2 text-sm text-slate-500">Cancelar</button>
                            <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold">Guardar</button>
                        </div>
                    </form>`);
            },

            async saveCliente(ev, id) {
                ev.preventDefault();
                const val = (i) => document.getElementById(i)?.value.trim() || null;
                const row = {
                    nombre: val('mant-cli-nombre'),
                    contacto_nombre: val('mant-cli-contacto'),
                    telefono: val('mant-cli-telefono'),
                    email: val('mant-cli-email'),
                    notas: val('mant-cli-notas')
                };
                if (id) row.activo = document.getElementById('mant-cli-activo')?.checked !== false;
                const q = id
                    ? supabaseClient.from('mant_clientes').update(row).eq('id', id)
                    : supabaseClient.from('mant_clientes').insert([row]);
                const { error } = await q;
                if (error) { showToast('No se pudo guardar el cliente: ' + error.message, true); return; }
                showToast(id ? 'Cliente actualizado.' : 'Cliente agregado al programa.');
                this.closeModal();
                await this.load(true);
            },

            // ------------------------------------------------------------------
            // Vehículos
            // ------------------------------------------------------------------
            openVehiculoForm(id = null, clienteIdPre = null) {
                const clientesActivos = this.clientes.filter(c => c.activo !== false || (id && Number(c.id) === Number(this.getVehiculo(id)?.cliente_id)));
                if (clientesActivos.length === 0) {
                    showToast('Primero da de alta un cliente del programa.', true);
                    return;
                }
                const v = id ? this.getVehiculo(id) : { cliente_id: clienteIdPre };
                const e = (x) => Utils.escapeHtml(x ?? '');
                const catActivo = this.catalogo.filter(c => c.activo !== false);
                this.openModal(`
                    ${this.modalHeader(id ? 'Editar vehículo' : 'Agregar vehículo al programa', 'Se liga a las órdenes de trabajo por las placas')}
                    <form onsubmit="Maintenance_Engine.saveVehiculo(event, ${id || 'null'})" class="p-6 flex flex-col gap-4 overflow-y-auto min-h-0">
                        <div class="flex flex-col gap-1.5"><label class="${this.labelCls}">Cliente *</label>
                            <select id="mant-veh-cliente" required class="${this.inputCls}">
                                ${clientesActivos.map(c => `<option value="${c.id}" ${Number(c.id) === Number(v.cliente_id) ? 'selected' : ''}>${e(c.nombre)}</option>`).join('')}
                            </select>
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div class="flex flex-col gap-1.5"><label class="${this.labelCls}">Placas *</label><input id="mant-veh-placas" required value="${e(v.placas)}" onblur="Maintenance_Engine.autofillDesdeOrdenes()" class="${this.inputCls} uppercase"></div>
                            <div class="flex flex-col gap-1.5"><label class="${this.labelCls}"># Económico</label><input id="mant-veh-eco" value="${e(v.numero_economico)}" class="${this.inputCls}"></div>
                        </div>
                        <div class="grid grid-cols-3 gap-4">
                            <div class="flex flex-col gap-1.5"><label class="${this.labelCls}">Marca</label><input id="mant-veh-marca" value="${e(v.marca)}" class="${this.inputCls}"></div>
                            <div class="flex flex-col gap-1.5"><label class="${this.labelCls}">Modelo</label><input id="mant-veh-modelo" value="${e(v.modelo)}" class="${this.inputCls}"></div>
                            <div class="flex flex-col gap-1.5"><label class="${this.labelCls}">Año</label><input id="mant-veh-anio" type="number" value="${e(v.anio)}" class="${this.inputCls}"></div>
                        </div>
                        <div class="flex flex-col gap-1.5"><label class="${this.labelCls}">Kilometraje actual</label><input id="mant-veh-km" type="number" min="0" value="${e(v.km_actual ?? 0)}" class="${this.inputCls}"></div>
                        <div class="flex flex-col gap-1.5"><label class="${this.labelCls}">Notas</label><textarea id="mant-veh-notas" rows="2" class="${this.inputCls}">${e(v.notas)}</textarea></div>
                        ${id
                            ? `<label class="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" id="mant-veh-activo" ${v.activo !== false ? 'checked' : ''}> Vehículo activo en el programa</label>`
                            : `<label class="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" id="mant-veh-plan-base" checked> Aplicarle todo el catálogo base (${catActivo.length} servicios). Después puedes quitar o ajustar.</label>`}
                        <p id="mant-veh-autofill-msg" class="hidden text-[11px] text-blue-600"></p>
                        <div class="flex justify-end gap-2 pt-2 border-t">
                            <button type="button" onclick="Maintenance_Engine.closeModal()" class="px-3 py-2 text-sm text-slate-500">Cancelar</button>
                            <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold">Guardar</button>
                        </div>
                    </form>`);
            },

            // Si esas placas ya tienen órdenes en el ERP, rellena marca/modelo/km con la más reciente
            autofillDesdeOrdenes() {
                const n = this.normPlacas(document.getElementById('mant-veh-placas')?.value);
                if (!n) return;
                const orden = (State.orders || [])
                    .filter(o => this.normPlacas(o.auto_placas) === n && o.estado !== 'Cancelada')
                    .sort((a, b) => Utils.parseFechaLocal(b.fecha_ingreso) - Utils.parseFechaLocal(a.fecha_ingreso))[0];
                if (!orden) return;
                const setIfEmpty = (id, val) => { const el = document.getElementById(id); if (el && !el.value && val) el.value = val; };
                setIfEmpty('mant-veh-marca', orden.auto_marca);
                setIfEmpty('mant-veh-modelo', orden.auto_modelo);
                const kmEl = document.getElementById('mant-veh-km');
                if (kmEl && (!kmEl.value || kmEl.value === '0') && orden.kilometraje) kmEl.value = orden.kilometraje;
                const msg = document.getElementById('mant-veh-autofill-msg');
                if (msg) { msg.textContent = `Datos tomados de la orden #${orden.id} (${orden.cliente_nombre || ''}).`; msg.classList.remove('hidden'); }
            },

            async saveVehiculo(ev, id) {
                ev.preventDefault();
                const val = (i) => document.getElementById(i)?.value.trim() || null;
                const placas = this.normPlacas(val('mant-veh-placas'));
                if (!placas) { showToast('Las placas son obligatorias.', true); return; }
                const dup = this.vehiculos.find(v => this.normPlacas(v.placas) === placas && Number(v.id) !== Number(id));
                if (dup) { showToast(`Las placas ${placas} ya están registradas en el programa.`, true); return; }

                const kmNuevo = parseInt(val('mant-veh-km')) || 0;
                const row = {
                    cliente_id: Number(val('mant-veh-cliente')),
                    placas,
                    numero_economico: val('mant-veh-eco'),
                    marca: val('mant-veh-marca'),
                    modelo: val('mant-veh-modelo'),
                    anio: parseInt(val('mant-veh-anio')) || null,
                    notas: val('mant-veh-notas')
                };
                const previo = id ? this.getVehiculo(id) : null;
                if (!previo || kmNuevo !== (Number(previo.km_actual) || 0)) {
                    row.km_actual = kmNuevo;
                    row.km_actual_fecha = this.toISODate(new Date());
                }
                if (id) row.activo = document.getElementById('mant-veh-activo')?.checked !== false;

                let vehiculoId = id;
                if (id) {
                    const { error } = await supabaseClient.from('mant_vehiculos').update(row).eq('id', id);
                    if (error) { showToast('No se pudo guardar el vehículo: ' + error.message, true); return; }
                } else {
                    const { data, error } = await supabaseClient.from('mant_vehiculos').insert([row]).select('id').single();
                    if (error) { showToast('No se pudo guardar el vehículo: ' + error.message, true); return; }
                    vehiculoId = data.id;
                    if (document.getElementById('mant-veh-plan-base')?.checked) {
                        const planRows = this.catalogo.filter(c => c.activo !== false).map(c => ({ vehiculo_id: vehiculoId, catalogo_id: c.id, activo: true }));
                        if (planRows.length) {
                            const { error: ePlan } = await supabaseClient.from('mant_planes').insert(planRows);
                            if (ePlan) showToast('Vehículo guardado, pero no se pudo aplicar el plan base: ' + ePlan.message, true);
                        }
                    }
                }
                showToast(id ? 'Vehículo actualizado.' : 'Vehículo agregado al programa.');
                await this.load(true);
                this.openVehiculoDetalle(vehiculoId);
            },

            // ------------------------------------------------------------------
            // Detalle de vehículo: estado, plan, historial, captura manual
            // ------------------------------------------------------------------
            openVehiculoDetalle(id) {
                const v = this.getVehiculo(id);
                if (!v) return;
                const cli = this.getCliente(v.cliente_id);
                const hoy = this.toISODate(new Date());
                const items = this.getVehiculoItems(v, hoy);
                const gestion = this.puedeGestionar();
                const e = (x) => Utils.escapeHtml(x ?? '');

                const estadoHtml = items.length === 0
                    ? `<p class="text-xs text-slate-400">Este vehículo no tiene servicios en su plan. ${gestion ? 'Agrégalos abajo.' : ''}</p>`
                    : `<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">${items.map(i => this.chipHtml(i)).join('')}</div>`;

                const tieneAviso = items.some(i => i.estado === 'vencido' || i.estado === 'por_vencer');
                const waHtml = (tieneAviso && cli && cli.telefono)
                    ? `<a href="${this.whatsappLink(v.id)}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold"><span class="material-icons text-sm">chat</span>Avisar por WhatsApp</a>` : '';

                // Editor de plan
                const planHtml = !gestion ? '' : `
                    <div class="flex flex-col gap-2">
                        <h4 class="text-xs font-black text-slate-400 uppercase tracking-wider">Plan de mantenimiento</h4>
                        <p class="text-[11px] text-slate-400">Deja el periodo vacío para usar el del catálogo. Vence por km o por tiempo, lo que llegue primero.</p>
                        <div class="border rounded-xl divide-y">
                            ${this.catalogo.filter(c => c.activo !== false || this.planes.some(p => Number(p.vehiculo_id) === Number(v.id) && Number(p.catalogo_id) === Number(c.id) && p.activo !== false)).map(c => {
                                const p = this.planes.find(p => Number(p.vehiculo_id) === Number(v.id) && Number(p.catalogo_id) === Number(c.id));
                                const on = p && p.activo !== false;
                                return `
                                    <div class="flex flex-wrap items-center gap-2 px-3 py-2 text-xs" data-plan-cat="${c.id}">
                                        <label class="flex items-center gap-2 flex-1 min-w-[180px]"><input type="checkbox" class="mant-plan-on" ${on ? 'checked' : ''}> <span class="font-semibold text-slate-700">${e(c.nombre)}</span></label>
                                        <input type="number" min="1" class="mant-plan-km w-24 border rounded-lg px-2 py-1" placeholder="${c.intervalo_km ? c.intervalo_km + ' km' : 'km'}" value="${p && p.intervalo_km ? p.intervalo_km : ''}">
                                        <input type="number" min="1" class="mant-plan-meses w-20 border rounded-lg px-2 py-1" placeholder="${c.intervalo_meses ? c.intervalo_meses + ' m' : 'meses'}" value="${p && p.intervalo_meses ? p.intervalo_meses : ''}">
                                    </div>`;
                            }).join('')}
                        </div>
                        <button onclick="Maintenance_Engine.savePlan(${v.id})" class="self-end bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-lg text-xs font-bold">Guardar plan</button>
                    </div>`;

                // Captura manual de servicio previo
                const planesActivos = this.getPlanesActivos(v.id);
                const manualHtml = (!gestion || planesActivos.length === 0) ? '' : `
                    <form onsubmit="Maintenance_Engine.saveHistorialManual(event, ${v.id})" class="flex flex-col gap-2 bg-slate-50 border rounded-xl p-3">
                        <h4 class="text-xs font-black text-slate-400 uppercase tracking-wider">Capturar servicio previo</h4>
                        <p class="text-[11px] text-slate-400">Para servicios hechos antes de usar la bitácora (o en otro taller). Los de aquí se registran solos al cerrar la orden.</p>
                        <div class="grid grid-cols-1 sm:grid-cols-4 gap-2">
                            <select id="mant-man-cat" required class="sm:col-span-2 border rounded-lg px-2 py-1.5 text-xs bg-white">
                                ${planesActivos.map(p => `<option value="${p.catalogo_id}">${e(this.getCatItem(p.catalogo_id).nombre)}</option>`).join('')}
                            </select>
                            <input id="mant-man-fecha" type="date" required value="${hoy}" class="border rounded-lg px-2 py-1.5 text-xs bg-white">
                            <input id="mant-man-km" type="number" min="0" required placeholder="Km" class="border rounded-lg px-2 py-1.5 text-xs bg-white">
                        </div>
                        <input id="mant-man-notas" placeholder="Notas (opcional)" class="border rounded-lg px-2 py-1.5 text-xs bg-white">
                        <button type="submit" class="self-end bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold">Registrar</button>
                    </form>`;

                // Historial
                const hist = this.historial.filter(h => Number(h.vehiculo_id) === Number(v.id));
                const histHtml = hist.length === 0
                    ? `<p class="text-xs text-slate-400 text-center py-3">Sin servicios registrados.</p>`
                    : `<div class="overflow-x-auto"><table class="w-full text-xs">
                        <thead><tr class="text-[10px] uppercase text-slate-400 border-b"><th class="py-2 px-2 text-left">Fecha</th><th class="py-2 px-2 text-left">Servicio</th><th class="py-2 px-2 text-right">Km</th><th class="py-2 px-2 text-left">Origen</th>${gestion ? '<th></th>' : ''}</tr></thead>
                        <tbody>${hist.map(h => `
                            <tr class="border-b border-slate-100">
                                <td class="py-2 px-2 text-slate-600">${this.fmtFecha(h.fecha)}</td>
                                <td class="py-2 px-2 font-semibold text-slate-800">${e(this.getCatItem(h.catalogo_id)?.nombre || '—')}${h.notas ? `<span class="block text-[10px] font-normal text-slate-400">${e(h.notas)}</span>` : ''}</td>
                                <td class="py-2 px-2 text-right">${(Number(h.kilometraje) || 0).toLocaleString('es-MX')}</td>
                                <td class="py-2 px-2 text-slate-500">${h.orden_id ? `Orden #${h.orden_id}` : 'Captura manual'}</td>
                                ${gestion ? `<td class="py-2 px-2 text-right"><button onclick="Maintenance_Engine.deleteHistorial(${h.id}, ${v.id})" class="text-rose-400 hover:text-rose-600"><span class="material-icons text-sm">delete</span></button></td>` : ''}
                            </tr>`).join('')}</tbody></table></div>`;

                this.openModal(`
                    ${this.modalHeader(`${e(v.placas)} ${v.numero_economico ? `<span class="text-slate-400 text-sm">#${e(v.numero_economico)}</span>` : ''}`,
                        `${e([v.marca, v.modelo, v.anio].filter(Boolean).join(' '))} · ${e(cli ? cli.nombre : '')} · ${(Number(v.km_actual) || 0).toLocaleString('es-MX')} km`)}
                    <div class="p-6 flex flex-col gap-5 overflow-y-auto min-h-0">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <h4 class="text-xs font-black text-slate-400 uppercase tracking-wider">Estado actual</h4>
                            <div class="flex gap-2">
                                ${waHtml}
                                ${gestion ? `<button onclick="Maintenance_Engine.openVehiculoForm(${v.id})" class="inline-flex items-center gap-1 border px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50"><span class="material-icons text-sm">edit</span>Editar datos</button>` : ''}
                            </div>
                        </div>
                        ${estadoHtml}
                        ${planHtml}
                        ${manualHtml}
                        <div class="flex flex-col gap-2">
                            <h4 class="text-xs font-black text-slate-400 uppercase tracking-wider">Historial de servicios</h4>
                            ${histHtml}
                        </div>
                    </div>`);
            },

            async savePlan(vehiculoId) {
                const rows = [];
                document.querySelectorAll('#modal-mant-content [data-plan-cat]').forEach(div => {
                    const catId = Number(div.getAttribute('data-plan-cat'));
                    const on = div.querySelector('.mant-plan-on').checked;
                    const existe = this.planes.find(p => Number(p.vehiculo_id) === Number(vehiculoId) && Number(p.catalogo_id) === catId);
                    if (!on && !existe) return;
                    rows.push({
                        vehiculo_id: vehiculoId,
                        catalogo_id: catId,
                        intervalo_km: parseInt(div.querySelector('.mant-plan-km').value) || null,
                        intervalo_meses: parseInt(div.querySelector('.mant-plan-meses').value) || null,
                        activo: on
                    });
                });
                if (rows.length === 0) { showToast('Marca al menos un servicio.', true); return; }
                const { error } = await supabaseClient.from('mant_planes').upsert(rows, { onConflict: 'vehiculo_id,catalogo_id' });
                if (error) { showToast('No se pudo guardar el plan: ' + error.message, true); return; }
                showToast('Plan de mantenimiento guardado.');
                await this.load(true);
                this.openVehiculoDetalle(vehiculoId);
            },

            async saveHistorialManual(ev, vehiculoId) {
                ev.preventDefault();
                const row = {
                    vehiculo_id: vehiculoId,
                    catalogo_id: Number(document.getElementById('mant-man-cat').value),
                    orden_id: null,
                    fecha: document.getElementById('mant-man-fecha').value,
                    kilometraje: parseInt(document.getElementById('mant-man-km').value) || 0,
                    notas: document.getElementById('mant-man-notas').value.trim() || null,
                    registrado_por: document.getElementById('user-display-name')?.innerText || null
                };
                const { error } = await supabaseClient.from('mant_historial').insert([row]);
                if (error) { showToast('No se pudo registrar el servicio: ' + error.message, true); return; }
                showToast('Servicio registrado en la bitácora.');
                await this.load(true);
                this.openVehiculoDetalle(vehiculoId);
            },

            deleteHistorial(histId, vehiculoId) {
                customConfirm('¿Borrar registro?', 'Se eliminará este servicio de la bitácora. El vencimiento se recalculará con el registro anterior.', async () => {
                    const { error } = await supabaseClient.from('mant_historial').delete().eq('id', histId);
                    if (error) { showToast('No se pudo borrar: ' + error.message, true); return; }
                    showToast('Registro eliminado.');
                    await Maintenance_Engine.load(true);
                    Maintenance_Engine.openVehiculoDetalle(vehiculoId);
                });
            },

            // ------------------------------------------------------------------
            // Catálogo base (tarjeta en Ajustes)
            // ------------------------------------------------------------------
            async loadCatalogoConfig() {
                await this.fetchAll();
                this.renderCatalogoConfig();
            },

            renderCatalogoConfig() {
                const cont = document.getElementById('mant-catalogo-list');
                if (!cont) return;
                const e = (x) => Utils.escapeHtml(x ?? '');
                const filas = this.catalogo.map(c => `
                    <div class="flex flex-wrap items-center gap-2 text-xs ${c.activo === false ? 'opacity-50' : ''}" data-cat-id="${c.id}">
                        <input class="mant-cat-nombre flex-1 min-w-[160px] border rounded-lg px-2 py-1.5" value="${e(c.nombre)}">
                        <input type="number" min="1" class="mant-cat-km w-24 border rounded-lg px-2 py-1.5" placeholder="km" value="${c.intervalo_km || ''}">
                        <input type="number" min="1" class="mant-cat-meses w-20 border rounded-lg px-2 py-1.5" placeholder="meses" value="${c.intervalo_meses || ''}">
                        <label class="flex items-center gap-1 text-slate-500"><input type="checkbox" class="mant-cat-activo" ${c.activo !== false ? 'checked' : ''}>Activo</label>
                        <button onclick="Maintenance_Engine.saveCatalogoItem(${c.id})" class="text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg font-semibold">Guardar</button>
                    </div>`).join('');
                cont.innerHTML = (filas || `<p class="text-xs text-slate-400">Catálogo vacío. ¿Ya corriste el script 008?</p>`) + `
                    <div class="flex flex-wrap items-center gap-2 text-xs pt-3 mt-1 border-t" data-cat-id="nuevo">
                        <input class="mant-cat-nombre flex-1 min-w-[160px] border rounded-lg px-2 py-1.5 bg-slate-50" placeholder="Nuevo servicio (ej. Bujías)">
                        <input type="number" min="1" class="mant-cat-km w-24 border rounded-lg px-2 py-1.5 bg-slate-50" placeholder="km">
                        <input type="number" min="1" class="mant-cat-meses w-20 border rounded-lg px-2 py-1.5 bg-slate-50" placeholder="meses">
                        <button onclick="Maintenance_Engine.saveCatalogoItem(null)" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-bold">Agregar</button>
                    </div>`;
            },

            async saveCatalogoItem(id) {
                const div = document.querySelector(`#mant-catalogo-list [data-cat-id="${id || 'nuevo'}"]`);
                if (!div) return;
                const row = {
                    nombre: div.querySelector('.mant-cat-nombre').value.trim(),
                    intervalo_km: parseInt(div.querySelector('.mant-cat-km').value) || null,
                    intervalo_meses: parseInt(div.querySelector('.mant-cat-meses').value) || null
                };
                if (!row.nombre) { showToast('Escribe el nombre del servicio.', true); return; }
                if (!row.intervalo_km && !row.intervalo_meses) { showToast('Indica al menos un periodo: km o meses.', true); return; }
                if (id) row.activo = div.querySelector('.mant-cat-activo').checked;
                const { error } = id
                    ? await supabaseClient.from('mant_catalogo').update(row).eq('id', id)
                    : await supabaseClient.from('mant_catalogo').insert([row]);
                if (error) { showToast('No se pudo guardar: ' + error.message, true); return; }
                showToast(id ? 'Servicio actualizado.' : 'Servicio agregado al catálogo.');
                await this.fetchAll(true);
                this.renderCatalogoConfig();
            },

            // ------------------------------------------------------------------
            // Enganche con Órdenes: al pasar una orden a Terminado/Entregado
            // ------------------------------------------------------------------
            async onOrderClosed(orden) {
                try {
                    await this.fetchAll();
                    const v = this.getVehiculoPorPlacas(orden.auto_placas);
                    if (!v) return;
                    const planes = this.getPlanesActivos(v.id);
                    if (planes.length === 0) return;

                    const yaRegistrados = new Set(this.historial.filter(h => Number(h.orden_id) === Number(orden.id)).map(h => Number(h.catalogo_id)));
                    const textoConceptos = (Array.isArray(orden.conceptos) ? orden.conceptos : [])
                        .map(c => (c.descripcion || '').toLowerCase()).join(' | ');
                    const e = (x) => Utils.escapeHtml(x ?? '');
                    const fecha = orden.fecha_egreso ? String(orden.fecha_egreso).split('T')[0] : this.toISODate(new Date());
                    const km = Number(orden.kilometraje) || 0;

                    this._ordenPendiente = { ordenId: orden.id, vehiculoId: v.id, fecha, km };
                    const hoy = this.toISODate(new Date());
                    const items = this.getVehiculoItems(v, hoy);

                    this.openModal(`
                        ${this.modalHeader('🔧 Vehículo en plan de mantenimiento', `Orden #${orden.id} · ${e(v.placas)} · ${e(this.getCliente(v.cliente_id)?.nombre || '')}`)}
                        <div class="p-6 flex flex-col gap-4 overflow-y-auto min-h-0">
                            <p class="text-sm text-slate-600">¿Qué mantenimientos del plan se hicieron en esta orden? Se registrarán con fecha <strong>${this.fmtFecha(fecha)}</strong> y <strong>${km.toLocaleString('es-MX')} km</strong>.</p>
                            ${km === 0 ? `<p class="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">⚠️ La orden no tiene kilometraje capturado. El vencimiento por km no será preciso; conviene capturarlo en la orden.</p>` : ''}
                            <div class="border rounded-xl divide-y">
                                ${items.map(i => {
                                    const catId = Number(i.catItem.id);
                                    const ya = yaRegistrados.has(catId);
                                    const nombre = i.catItem.nombre.toLowerCase();
                                    const sugerido = !ya && textoConceptos && nombre.split(/\s+/).filter(w => w.length > 4).some(w => textoConceptos.includes(w));
                                    const ui = this.ESTADO_UI[i.estado];
                                    return `
                                        <label class="flex items-center gap-3 px-3 py-2.5 text-sm ${ya ? 'opacity-50' : 'cursor-pointer hover:bg-slate-50'}">
                                            <input type="checkbox" class="mant-cierre-cat" value="${catId}" ${ya ? 'disabled checked' : (sugerido ? 'checked' : '')}>
                                            <span class="flex-1">
                                                <span class="font-semibold text-slate-800">${e(i.catItem.nombre)}</span>
                                                ${ya ? '<span class="text-[10px] text-emerald-600 ml-1">ya registrado</span>' : ''}
                                                ${sugerido ? '<span class="text-[10px] text-blue-600 ml-1">sugerido por los conceptos de la orden</span>' : ''}
                                            </span>
                                            <span class="text-[10px] border rounded-full px-2 py-0.5 ${ui.cls}">${ui.dot} ${ui.label}</span>
                                        </label>`;
                                }).join('')}
                            </div>
                            <div class="flex justify-end gap-2 pt-2 border-t">
                                <button type="button" onclick="Maintenance_Engine.closeModal()" class="px-3 py-2 text-sm text-slate-500">Ninguno / Omitir</button>
                                <button type="button" onclick="Maintenance_Engine.saveOrderMaintenance()" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold">Registrar en bitácora</button>
                            </div>
                        </div>`);
                } catch (err) {
                    console.error('Error al revisar plan de mantenimiento de la orden:', err);
                }
            },

            async saveOrderMaintenance() {
                const p = this._ordenPendiente;
                if (!p) return;
                const catIds = Array.from(document.querySelectorAll('#modal-mant-content .mant-cierre-cat:checked:not(:disabled)')).map(el => Number(el.value));
                if (catIds.length === 0) { this.closeModal(); return; }
                const rows = catIds.map(catalogo_id => ({
                    vehiculo_id: p.vehiculoId, catalogo_id, orden_id: p.ordenId,
                    fecha: p.fecha, kilometraje: p.km,
                    registrado_por: document.getElementById('user-display-name')?.innerText || null
                }));
                const { error } = await supabaseClient.from('mant_historial').insert(rows);
                if (error) { showToast('No se pudo registrar en la bitácora: ' + error.message, true); return; }
                showToast(`${rows.length} mantenimiento(s) registrados en la bitácora.`);
                this.closeModal();
                await this.fetchAll(true);
                if (!document.getElementById('tab-mantenimiento')?.classList.contains('hidden')) this.render();
            },

            // ------------------------------------------------------------------
            // Auto-diagnóstico de la lógica de vencimientos (sin tocar la base de datos)
            // ------------------------------------------------------------------
            runSelfTest() {
                const results = [];
                const check = (label, actual, expected) => {
                    results.push({ label, actual, expected, ok: actual === expected, raw: true });
                };
                const cat = { id: 1, nombre: 'Aceite', intervalo_km: 5000, intervalo_meses: 3 };
                const ult = { fecha: '2026-01-01', kilometraje: 10000 };
                const st = (kmActual, hoy, extra = {}) => this.computeItemStatus({
                    plan: extra.plan || { catalogo_id: 1 }, catItem: extra.cat || cat,
                    vehiculo: { km_actual: kmActual }, ultimo: extra.ultimo === undefined ? ult : extra.ultimo, hoy
                });

                check('Mant.: normaliza placas " abc-12 3 " → ABC123', this.normPlacas(' abc-12 3 '), 'ABC123');
                check('Mant.: 31 ene + 1 mes = 28 feb', this.addMonths('2026-01-31', 1), '2026-02-28');
                check('Mant.: 12,000 km / 1 feb → al día', st(12000, '2026-02-01').estado, 'al_dia');
                check('Mant.: próxima fecha = 1 abr', st(12000, '2026-02-01').proximaFecha, '2026-04-01');
                check('Mant.: faltan 3,000 km', st(12000, '2026-02-01').kmRestantes, 3000);
                check('Mant.: 14,700 km (faltan 300) → por vencer', st(14700, '2026-02-01').estado, 'por_vencer');
                check('Mant.: 15,200 km → vencido por km', st(15200, '2026-02-01').estado, 'vencido');
                check('Mant.: 20 mar (12 días) → por vencer por tiempo', st(11000, '2026-03-20').estado, 'por_vencer');
                check('Mant.: 5 abr → vencido por tiempo aunque tenga pocos km', st(11000, '2026-04-05').estado, 'vencido');
                check('Mant.: sin registro previo → sin historial', st(11000, '2026-02-01', { ultimo: null }).estado, 'sin_historial');
                check('Mant.: periodo propio del vehículo (10,000 km) → al día a 15,200 km', st(15200, '2026-02-01', { plan: { catalogo_id: 1, intervalo_km: 10000 } }).estado, 'al_dia');
                check('Mant.: sin lectura de km → decide solo por tiempo', st(0, '2026-04-05').estado, 'vencido');
                check('Mant.: servicio solo por meses (12) → al día a 6 meses', st(99999, '2026-07-01', { cat: { id: 2, nombre: 'Anticongelante', intervalo_km: null, intervalo_meses: 12 } }).estado, 'al_dia');
                return results;
            }
        };
